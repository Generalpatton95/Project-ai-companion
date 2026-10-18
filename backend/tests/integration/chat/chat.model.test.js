// Runs against a real Postgres when TEST_DATABASE_URL is set

const { Pool } = require('pg');
const { migrate } = require('../../../db/migrate');
const { UserRepository } = require('../../../models/user.model');
const { ChatRepository } = require('../../../models/chat.model');

const describeWithDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeWithDb('ChatRepository (Postgres)', () => {
  let pool;
  let chats;
  let userId;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await migrate(pool);
    chats = new ChatRepository({ pool });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE users CASCADE');
    const user = await new UserRepository({ pool }).create({
      email: 'chat@example.com',
      passwordHash: 'hash',
      displayName: 'Chat'
    });
    userId = user.id;
  });

  afterAll(() => pool.end());

  test('stores messages in order and round-trips content blocks', async () => {
    const conversation = await chats.createConversation(userId, 'coach');
    const blocks = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: 'Hello' }
    ];

    await chats.appendMessages(conversation.id, [
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'note' },
      { role: 'assistant', content: blocks, displayText: 'Hello' }
    ], { title: 'hi' });

    const messages = await chats.getMessages(conversation.id);
    expect(messages.map((m) => m.role)).toEqual(['user', 'system', 'assistant']);
    expect(messages[0].content).toBe('hi');
    expect(messages[2].content).toEqual(blocks);

    const [listed] = await chats.listConversations(userId);
    expect(listed.title).toBe('hi');
  });

  test('scopes conversations to their owner', async () => {
    const conversation = await chats.createConversation(userId, 'friend');
    const other = await new UserRepository({ pool }).create({ email: 'o@example.com', passwordHash: 'h', displayName: 'O' });
    expect(await chats.getConversation(conversation.id, other.id)).toBeNull();
    expect(await chats.updateConversation(conversation.id, other.id, { personality: 'coach' })).toBeNull();
  });

  test('ends a conversation and keeps the first title', async () => {
    const conversation = await chats.createConversation(userId, 'friend');
    await chats.appendMessages(conversation.id, [{ role: 'user', content: 'first' }], { title: 'first' });
    await chats.appendMessages(conversation.id, [{ role: 'user', content: 'second' }], { title: 'second', endedReason: 'crisis' });

    const updated = await chats.getConversation(conversation.id, userId);
    expect(updated).toMatchObject({ title: 'first', endedReason: 'crisis' });
  });
});
