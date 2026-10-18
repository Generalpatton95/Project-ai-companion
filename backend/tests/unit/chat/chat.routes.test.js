process.env.JWT_SECRET = 'test-secret';

const express = require('express');
const jwt = require('jsonwebtoken');
const { createChatRouter } = require('../../../routes/chat.routes');
const { errorMiddleware } = require('../../../middleware/error.middleware');
const { ChatService } = require('../../../services/chat/chat.service');
const { FakeChatRepository } = require('../../helpers/fake-chat-repository');
const { FakeAnthropic } = require('../../helpers/fake-anthropic');

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
    expect(failed.body.error).toMatch(/unavailable/);
  });

  test('requires auth', async () => {
    const response = await fetch(`${baseUrl}/api/chat/conversations`);
    expect(response.status).toBe(401);
  });
});
