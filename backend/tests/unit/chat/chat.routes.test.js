process.env.JWT_SECRET = 'test-secret';

const express = require('express');
const jwt = require('jsonwebtoken');
const { createChatRouter } = require('../../../routes/chat.routes');
const { errorMiddleware } = require('../../../middleware/error.middleware');
const { ChatService } = require('../../../services/chat/chat.service');
const { FakeChatRepository } = require('../../helpers/fake-chat-repository');
const { FakeAnthropic } = require('../../helpers/fake-anthropic');
const { UNAVAILABLE_MESSAGE } = require('../../../utils/unavailable');
const { CRISIS_RESOURCES } = require('../../../services/safeguards/messages');
const logger = require('../../../utils/logger');
const { ServiceUnavailableError } = require('../../../utils/errors');

// The Claude-failure wording, unchanged since before spec 017 (NFR3, R2.7)
const COMPANION_MESSAGE = 'The companion is unavailable right now. Please try again in a moment.';

describe('chat routes', () => {
  let server;
  let baseUrl;
  let client;
  const token = jwt.sign({ id: 'u1', tier: 'free' }, 'test-secret');
  const otherToken = jwt.sign({ id: 'u2', tier: 'free' }, 'test-secret');

  async function call(method, path, body, auth = token) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
      body: body && JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }

  beforeEach(async () => {
    client = new FakeAnthropic();
    const chatService = new ChatService({
      chats: new FakeChatRepository(),
      client,
      moods: { getSummary: async () => ({ tone: 'balanced' }) }
    });
    const app = express();
    app.use(express.json());
    app.use('/api/chat', createChatRouter({ chatService, rateLimit: (req, res, next) => next() }));
    app.use(errorMiddleware);
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(() => new Promise((resolve) => server.close(resolve)));

  test('conversation lifecycle', async () => {
    const created = await call('POST', '/api/chat/conversations', { personality: 'coach' });
    expect(created.status).toBe(201);
    const id = created.body.conversation.id;

    client.queue(FakeAnthropic.reply('Focus on last-hitting.'));
    const sent = await call('POST', `/api/chat/conversations/${id}/messages`, { content: 'How do I CS better?' });
    expect(sent.status).toBe(200);
    expect(sent.body.messages[1].text).toBe('Focus on last-hitting.');

    const patched = await call('PATCH', `/api/chat/conversations/${id}`, { personality: 'analyst' });
    expect(patched.body.conversation.personality).toBe('analyst');

    const fetched = await call('GET', `/api/chat/conversations/${id}`);
    expect(fetched.body.messages.map((m) => m.role)).toEqual(['user', 'assistant']);

    const listed = await call('GET', '/api/chat/conversations');
    expect(listed.body.conversations[0]).toMatchObject({ id, title: 'How do I CS better?' });
  });

  test('errors map to status codes', async () => {
    const { body } = await call('POST', '/api/chat/conversations', {});
    const id = body.conversation.id;

    expect((await call('GET', `/api/chat/conversations/${id}`, undefined, otherToken)).status).toBe(404);
    expect((await call('POST', `/api/chat/conversations/${id}/messages`, { content: '' })).status).toBe(400);
    expect((await call('PATCH', `/api/chat/conversations/${id}`, { personality: 'nope' })).status).toBe(400);

    client.queue(new Error('network down'));
    const failed = await call('POST', `/api/chat/conversations/${id}/messages`, { content: 'hi' });
    expect(failed.status).toBe(503);
    expect(failed.body).toEqual({ error: COMPANION_MESSAGE, resources: CRISIS_RESOURCES });
  });

  async function stream(path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    const type = response.headers.get('content-type') || '';
    const text = await response.text();
    if (!type.includes('text/event-stream')) {
      return { status: response.status, type, body: JSON.parse(text), events: [] };
    }
    const events = text.trim().split('\n\n').filter(Boolean).map((chunk) => {
      const [eventLine, dataLine] = chunk.split('\n');
      return { event: eventLine.replace('event: ', ''), data: JSON.parse(dataLine.replace('data: ', '')) };
    });
    return { status: response.status, type, events };
  }

  test('streams deltas then the saved turn', async () => {
    const { body } = await call('POST', '/api/chat/conversations', {});
    client.queue(FakeAnthropic.reply('Play safe until your first item.'));

    const result = await stream(`/api/chat/conversations/${body.conversation.id}/messages`, { content: 'early game?' });

    expect(result.status).toBe(200);
    expect(result.type).toMatch('text/event-stream');
    const deltas = result.events.filter((e) => e.event === 'delta').map((e) => e.data.text);
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join('')).toBe('Play safe until your first item.');
    const done = result.events[result.events.length - 1];
    expect(done.event).toBe('done');
    expect(done.data.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  test('errors before streaming starts keep their status code', async () => {
    const { body } = await call('POST', '/api/chat/conversations', {});
    const empty = await stream(`/api/chat/conversations/${body.conversation.id}/messages`, { content: '' });
    expect(empty.status).toBe(400);

    client.queue(new Error('network down'));
    const failed = await fetch(`${baseUrl}/api/chat/conversations/${body.conversation.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content: 'hi' })
    });
    expect(failed.status).toBe(503);
    expect(failed.headers.get('retry-after')).toBe('30');
    expect(await failed.json()).toEqual({ error: COMPANION_MESSAGE, resources: CRISIS_RESOURCES });
  });

  test('safeguard replies arrive as a single done event', async () => {
    const { body } = await call('POST', '/api/chat/conversations', {});
    const result = await stream(`/api/chat/conversations/${body.conversation.id}/messages`, { content: 'I want to die' });
    expect(result.events.map((e) => e.event)).toEqual(['done']);
    expect(result.events[0].data.safeguard.conversationEnded).toBe(true);
    expect(client.requests).toHaveLength(0);
  });

  test('requires auth', async () => {
    const response = await fetch(`${baseUrl}/api/chat/conversations`);
    expect(response.status).toBe(401);
  });
});

describe('chat routes when the database is unavailable (spec 017)', () => {
  const token = jwt.sign({ id: 'u1', tier: 'free' }, 'test-secret');
  let server;
  let baseUrl;
  let client;
  let chats;
  let errorSpy;

  function pgError(code = '57014') {
    const error = new Error('canceling statement for user "player@example.com" at 10.0.0.9');
    error.code = code;
    return error;
  }

  async function request(method, path, { body, stream = false } = {}) {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    if (stream) headers.Accept = 'text/event-stream';
    const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body && JSON.stringify(body) });
    const type = response.headers.get('content-type') || '';
    const text = await response.text();
    const result = { status: response.status, retryAfter: response.headers.get('retry-after'), type };
    if (type.includes('text/event-stream')) {
      result.events = text.trim().split('\n\n').filter(Boolean).map((chunk) => {
        const [eventLine, dataLine] = chunk.split('\n');
        return { event: eventLine.replace('event: ', ''), data: JSON.parse(dataLine.replace('data: ', '')) };
      });
    } else {
      result.body = JSON.parse(text);
    }
    return result;
  }

  beforeEach(async () => {
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    client = new FakeAnthropic();
    chats = new FakeChatRepository();
    const chatService = new ChatService({
      chats,
      client,
      moods: { getSummary: async () => ({ tone: 'balanced' }) }
    });
    const app = express();
    app.use(express.json());
    app.use('/api/chat', createChatRouter({ chatService, rateLimit: (req, res, next) => next() }));
    app.use(errorMiddleware);
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    return new Promise((resolve) => server.close(resolve));
  });

  function expectOutage(result) {
    expect(result.status).toBe(503);
    expect(result.retryAfter).toBe('30');
    expect(result.body).toEqual({ error: UNAVAILABLE_MESSAGE, resources: CRISIS_RESOURCES });
  }

  test('R2.4: listing conversations gives 503 with the crisis resources', async () => {
    jest.spyOn(chats, 'listConversations').mockRejectedValue(pgError('ECONNREFUSED'));

    expectOutage(await request('GET', '/api/chat/conversations'));
  });

  test('R2.4: opening a conversation gives 503 with the crisis resources', async () => {
    const { id } = await chats.createConversation('u1', 'coach');
    jest.spyOn(chats, 'getMessages').mockRejectedValue(new Error('Query read timeout'));

    expectOutage(await request('GET', `/api/chat/conversations/${id}`));
  });

  test('R2.4: creating a conversation gives 503 with the crisis resources', async () => {
    jest.spyOn(chats, 'createConversation').mockRejectedValue(new Error('timeout exceeded when trying to connect'));

    expectOutage(await request('POST', '/api/chat/conversations', { body: {} }));
  });

  test('R2.4: sending a message (JSON) gives 503 with the crisis resources', async () => {
    const { id } = await chats.createConversation('u1', 'coach');
    client.queue(FakeAnthropic.reply('Ward the river.'));
    jest.spyOn(chats, 'appendMessages').mockRejectedValue(pgError());

    expectOutage(await request('POST', `/api/chat/conversations/${id}/messages`, { body: { content: 'vision tips?' } }));
  });

  test('R2.4: a streamed send that fails before streaming starts gives the JSON 503 with the resources', async () => {
    const { id } = await chats.createConversation('u1', 'coach');
    jest.spyOn(chats, 'getConversation').mockRejectedValue(pgError('57P01'));

    const result = await request('POST', `/api/chat/conversations/${id}/messages`, { body: { content: 'hi' }, stream: true });

    expectOutage(result);
  });

  test('R2.4: a streamed send that fails after streaming began ends with an error event carrying the resources', async () => {
    const { id } = await chats.createConversation('u1', 'coach');
    client.queue(FakeAnthropic.reply('Ward the river before objectives.'));
    jest.spyOn(chats, 'appendMessages').mockRejectedValue(new Error('Connection terminated unexpectedly'));

    const result = await request('POST', `/api/chat/conversations/${id}/messages`, { body: { content: 'vision tips?' }, stream: true });

    expect(result.status).toBe(200);
    expect(result.events.some((e) => e.event === 'delta')).toBe(true);
    const last = result.events[result.events.length - 1];
    expect(last).toEqual({
      event: 'error',
      data: { error: UNAVAILABLE_MESSAGE, status: 503, resources: CRISIS_RESOURCES }
    });
  });

  test('R2.4: a streamed send that fails after streaming began for another reason is handled as before', async () => {
    const { id } = await chats.createConversation('u1', 'coach');
    client.queue(FakeAnthropic.reply('Ward the river before objectives.'));
    jest.spyOn(chats, 'appendMessages').mockRejectedValue(new Error('relation "chat_messages" does not exist'));

    const result = await request('POST', `/api/chat/conversations/${id}/messages`, { body: { content: 'vision tips?' }, stream: true });

    const last = result.events[result.events.length - 1];
    expect(last).toEqual({ event: 'error', data: { error: 'Something went wrong. Please try again.', status: 500 } });
    expect(errorSpy).toHaveBeenCalledWith('Chat stream failed', { errorName: 'Error' });
  });

  test('R2.5: the outage is logged with name, code, method and path only', async () => {
    jest.spyOn(chats, 'listConversations').mockRejectedValue(pgError('57014'));

    await request('GET', '/api/chat/conversations');

    expect(errorSpy).toHaveBeenCalledWith('store_unavailable', {
      errorName: 'Error',
      errorCode: '57014',
      method: 'GET',
      path: '/api/chat/conversations'
    });
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain('player@example.com');
    expect(logged).not.toContain('10.0.0.9');
    expect(logged).not.toContain('canceling');
  });

  test('R2.5: an outage after streaming began is logged with name, code, method and path only', async () => {
    const { id } = await chats.createConversation('u1', 'coach');
    client.queue(FakeAnthropic.reply('Ward the river.'));
    jest.spyOn(chats, 'appendMessages').mockRejectedValue(pgError('57014'));

    await request('POST', `/api/chat/conversations/${id}/messages`, { body: { content: 'vision tips?' }, stream: true });

    expect(errorSpy).toHaveBeenCalledWith('store_unavailable', {
      errorName: 'Error',
      errorCode: '57014',
      method: 'POST',
      path: `/api/chat/conversations/${id}/messages`
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('player@example.com');
  });

  test('R2.4: errors that are not outages still reach the app error handler (no resources)', async () => {
    const error = new Error('duplicate key value: (email)=(player@example.com)');
    error.code = '23505';
    jest.spyOn(chats, 'listConversations').mockRejectedValue(error);

    const result = await request('GET', '/api/chat/conversations');

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Internal server error' });
  });

  test('R2.4: a 404 still answers 404 without resources', async () => {
    const result = await request('GET', '/api/chat/conversations/missing');

    expect(result.status).toBe(404);
    expect(result.body.resources).toBeUndefined();
  });
});

describe('chat routes when Claude is unavailable (spec 017 R2.7)', () => {
  const token = jwt.sign({ id: 'u1', tier: 'free' }, 'test-secret');
  let server;
  let baseUrl;
  let errorSpy;

  // As chat.service.js throws it when Claude fails
  function companionError() {
    return Object.assign(new ServiceUnavailableError(COMPANION_MESSAGE), { code: 'COMPANION_UNAVAILABLE' });
  }

  async function start(chatService) {
    const app = express();
    app.use(express.json());
    app.use('/api/chat', createChatRouter({ chatService, rateLimit: (req, res, next) => next() }));
    app.use(errorMiddleware);
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }

  async function post(path, { stream = false } = {}) {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    if (stream) headers.Accept = 'text/event-stream';
    const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify({ content: 'hi' }) });
    const text = await response.text();
    const type = response.headers.get('content-type') || '';
    if (type.includes('text/event-stream')) {
      const events = text.trim().split('\n\n').filter(Boolean).map((chunk) => {
        const [eventLine, dataLine] = chunk.split('\n');
        return { event: eventLine.replace('event: ', ''), data: JSON.parse(dataLine.replace('data: ', '')) };
      });
      return { status: response.status, events };
    }
    return { status: response.status, retryAfter: response.headers.get('retry-after'), body: JSON.parse(text) };
  }

  beforeEach(() => {
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    return new Promise((resolve) => server.close(resolve));
  });

  test('R2.7: chat.service gives a Claude failure the fixed COMPANION_UNAVAILABLE code and the unchanged message', async () => {
    const chats = new FakeChatRepository();
    const { id } = await chats.createConversation('u1', 'coach');
    const client = new FakeAnthropic().queue(new Error('overloaded for player@example.com'));
    const chatService = new ChatService({ chats, client, moods: { getSummary: async () => ({ tone: 'balanced' }) } });
    await start(chatService);

    const error = await chatService.sendMessage({ id: 'u1', tier: 'free' }, id, 'hi').catch((e) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error.code).toBe('COMPANION_UNAVAILABLE');
    expect(error.message).toBe(COMPANION_MESSAGE);
  });

  test('R2.7: the JSON path answers 503 with the companion message, Retry-After and the resources', async () => {
    await start({ sendMessage: async () => { throw companionError(); } });

    const result = await post('/api/chat/conversations/c1/messages');

    expect(result.status).toBe(503);
    expect(result.retryAfter).toBe('30');
    expect(result.body).toEqual({ error: COMPANION_MESSAGE, resources: CRISIS_RESOURCES });
  });

  test('R2.7: a Claude failure mid-stream ends with an error event with the companion message and the resources', async () => {
    await start({
      sendMessage: async (user, id, content, { onText }) => {
        onText('Ward the ');
        throw companionError();
      }
    });

    const result = await post('/api/chat/conversations/c1/messages', { stream: true });

    expect(result.status).toBe(200);
    expect(result.events[0]).toEqual({ event: 'delta', data: { text: 'Ward the ' } });
    expect(result.events[result.events.length - 1]).toEqual({
      event: 'error',
      data: { error: COMPANION_MESSAGE, status: 503, resources: CRISIS_RESOURCES }
    });
  });

  test.each([false, true])('R2.7: logged as companion_unavailable (name, code, status), not as a store outage (stream: %s)', async (stream) => {
    await start({
      sendMessage: async (user, id, content, { onText } = {}) => {
        if (onText) onText('x');
        throw companionError();
      }
    });

    await post('/api/chat/conversations/c1/messages', { stream });

    expect(errorSpy).toHaveBeenCalledWith('companion_unavailable', {
      errorName: 'ServiceUnavailableError',
      errorCode: 'COMPANION_UNAVAILABLE',
      status: 503
    });
    expect(errorSpy).not.toHaveBeenCalledWith('store_unavailable', expect.anything());
    expect(errorSpy).not.toHaveBeenCalledWith('Chat stream failed', expect.anything());
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(COMPANION_MESSAGE);
  });
});
