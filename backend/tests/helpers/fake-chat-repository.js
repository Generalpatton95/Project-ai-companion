// In-memory stand-in for ChatRepository

const { randomUUID } = require('crypto');

class FakeChatRepository {
  constructor() {
    this.conversations = new Map();
    this.messages = new Map();
    this.nextId = 1;
  }

  async createConversation(userId, personality) {
    const conversation = {
      id: randomUUID(),
      userId,
      title: null,
      personality,
      endedReason: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.conversations.set(conversation.id, conversation);
    this.messages.set(conversation.id, []);
    return { ...conversation };
  }

  async listConversations(userId) {
    return [...this.conversations.values()]
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => ({ ...c }));
  }

  async getConversation(id, userId) {
    const conversation = this.conversations.get(id);
    return conversation && conversation.userId === userId ? { ...conversation } : null;
  }

  async updateConversation(id, userId, { personality, endedReason }) {
    const conversation = this.conversations.get(id);
    if (!conversation || conversation.userId !== userId) {
      return null;
    }
    if (personality) conversation.personality = personality;
    if (endedReason) conversation.endedReason = endedReason;
    conversation.updatedAt = new Date();
    return { ...conversation };
  }

  async getMessages(conversationId) {
    // Round-trip through JSON like the JSONB column does
    return JSON.parse(JSON.stringify(this.messages.get(conversationId) || []));
  }

  async appendMessages(conversationId, messages, { title, endedReason } = {}) {
    const list = this.messages.get(conversationId);
    const saved = messages.map((m) => ({
      id: String(this.nextId++),
      role: m.role,
      content: JSON.parse(JSON.stringify(m.content)),
      displayText: m.displayText || null,
      safeguard: m.safeguard || null,
      createdAt: new Date()
    }));
    list.push(...saved);
    const conversation = this.conversations.get(conversationId);
    conversation.title = conversation.title || title || null;
    conversation.endedReason = conversation.endedReason || endedReason || null;
    conversation.updatedAt = new Date();
    return JSON.parse(JSON.stringify(saved));
  }
}

module.exports = { FakeChatRepository };
