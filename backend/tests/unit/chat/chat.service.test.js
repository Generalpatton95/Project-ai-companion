const Anthropic = require('@anthropic-ai/sdk');
const { ChatService } = require('../../../services/chat/chat.service');
const { SYSTEM_PROMPT, buildModeNote } = require('../../../services/chat/prompts');
const { FakeChatRepository } = require('../../helpers/fake-chat-repository');
const { FakeAnthropic } = require('../../helpers/fake-anthropic');

describe('ChatService', () => {
  const user = { id: 'user-1' };
  let chats;
  let client;
  let tone;
  let service;

  beforeEach(() => {
    chats = new FakeChatRepository();
    client = new FakeAnthropic();
    tone = 'balanced';
    service = new ChatService({
      chats,
      client,
      moods: { getSummary: async () => ({ tone }) },
      model: 'claude-opus-5-5',
      effort: 'medium'
    });
  });

  test('sends the request shape we expect', async () => {
    const conversation = await service.createConversation(user, { personality: 'coach' });
    client.queue(FakeAnthropic.reply('Ward the river at 2:45.'));

    const result = await service.sendMessage(user, conversation.id, '  How do I stop dying to ganks?  ');

    const [request] = client.requests;
    expect(request).toMatchObject({
      model: 'claude-opus-5-5',
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: SYSTEM_PROMPT
    });
    expect(request).not.toHaveProperty('temperature');
    expect(request.messages).toEqual([
      { role: 'user', content: 'How do I stop dying to ganks?' },
      { role: 'system', content: buildModeNote('coach', 'balanced') }
    ]);

    expect(result.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'How do I stop dying to ganks?'],
      ['assistant', 'Ward the river at 2:45.']
    ]);
  });

  test('history is append-only: each request extends the previous one exactly', async () => {
    const conversation = await service.createConversation(user);
    const firstReply = FakeAnthropic.reply('First answer');
    client.queue(firstReply, FakeAnthropic.reply('Second answer'));

    await service.sendMessage(user, conversation.id, 'first');
    await service.sendMessage(user, conversation.id, 'second');

    const [first, second] = client.requests;
    expect(second.system).toBe(first.system);
    expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages);
    // Assistant content, thinking block included, is replayed unchanged
    expect(second.messages[first.messages.length]).toEqual({ role: 'assistant', content: firstReply.content });
    // Mode unchanged, so no second note
    expect(second.messages.slice(first.messages.length + 1)).toEqual([{ role: 'user', content: 'second' }]);
  });

  test('personality and mood changes are appended as new notes, not edits', async () => {
    const conversation = await service.createConversation(user);
    client.queue(FakeAnthropic.reply('one'), FakeAnthropic.reply('two'), FakeAnthropic.reply('three'));

    await service.sendMessage(user, conversation.id, 'hi');
    await service.setPersonality(user, conversation.id, 'analyst');
    await service.sendMessage(user, conversation.id, 'again');
    tone = 'encouraging';
    await service.sendMessage(user, conversation.id, 'rough day');

    const last = client.requests[2].messages;
    const notes = last.filter((m) => m.role === 'system').map((m) => m.content);
    expect(notes).toEqual([
      buildModeNote('friend', 'balanced'),
      buildModeNote('analyst', 'balanced'),
      buildModeNote('analyst', 'encouraging')
    ]);
    // Every note directly follows a user message
    last.forEach((m, i) => {
      if (m.role === 'system') {
        expect(last[i - 1].role).toBe('user');
      }
    });
  });

  test('crisis language never reaches Claude and ends the conversation', async () => {
    const conversation = await service.createConversation(user);

    const result = await service.sendMessage(user, conversation.id, 'I want to die');

    expect(client.requests).toHaveLength(0);
    expect(result.safeguard).toMatchObject({ safeguard: 'crisis', conversationEnded: true });
    expect(result.messages[1]).toMatchObject({ role: 'assistant', safeguard: 'crisis' });
    expect(result.messages[1].resources.map((r) => r.contact).join(' ')).toContain('988');
    await expect(service.sendMessage(user, conversation.id, 'ok')).rejects.toMatchObject({ statusCode: 409 });
  });

  test('distress gets resources without calling Claude, and chat continues', async () => {
    const conversation = await service.createConversation(user);
    client.queue(FakeAnthropic.reply('I hear you.'));

    const result = await service.sendMessage(user, conversation.id, 'I hate myself after that game');
    expect(client.requests).toHaveLength(0);
    expect(result.safeguard).toMatchObject({ safeguard: 'distress', conversationEnded: false });

    await service.sendMessage(user, conversation.id, 'thanks');
    // The supportive exchange stays in the history Claude sees
    expect(client.requests[0].messages[0]).toEqual({ role: 'user', content: 'I hate myself after that game' });
    expect(client.requests[0].messages[1].role).toBe('assistant');
  });

  test('a refusal is replaced with a gentle reply', async () => {
    const conversation = await service.createConversation(user);
    client.queue({ ...FakeAnthropic.reply(''), content: [], stop_reason: 'refusal', stop_details: { category: 'cyber' } });

    const result = await service.sendMessage(user, conversation.id, 'something');
    expect(result.messages[1]).toMatchObject({ role: 'assistant', safeguard: 'refusal' });
    expect(result.messages[1].text).toMatch(/can't help with that one/);
  });

  test('API failures store nothing and surface a 503', async () => {
    const conversation = await service.createConversation(user);
    client.queue(new Anthropic.APIError(529, { type: 'overloaded_error' }, 'Overloaded', new Headers()));

    await expect(service.sendMessage(user, conversation.id, 'hello')).rejects.toMatchObject({ statusCode: 503 });
    expect((await service.getConversation(user, conversation.id)).messages).toEqual([]);
  });

  test('validates input and ownership', async () => {
    const conversation = await service.createConversation(user);
    await expect(service.sendMessage(user, conversation.id, '   ')).rejects.toThrow('cannot be empty');
    await expect(service.sendMessage(user, conversation.id, 'x'.repeat(4001))).rejects.toThrow('4000');
    await expect(service.sendMessage({ id: 'someone-else' }, conversation.id, 'hi')).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.getConversation(user, 'not-a-uuid')).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.createConversation(user, { personality: 'drill-sergeant' })).rejects.toThrow('personality must be');
  });

  test('a failing mood lookup falls back to a balanced tone', async () => {
    service.moods = { getSummary: async () => { throw new Error('redis down'); } };
    const conversation = await service.createConversation(user);
    await service.sendMessage(user, conversation.id, 'hi');
    expect(client.requests[0].messages[1].content).toBe(buildModeNote('friend', 'balanced'));
  });
});
