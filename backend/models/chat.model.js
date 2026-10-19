// ============================================================================
// FILE: backend/models/chat.model.js
// Conversation and message persistence (Postgres)
// ============================================================================

function toConversation(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    personality: row.personality,
    endedReason: row.ended_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toMessage(row) {
  return {
    id: String(row.id),
    role: row.role,
    content: row.content,
    displayText: row.display_text,
    safeguard: row.safeguard,
    createdAt: row.created_at
  };
}

const CONVERSATION_COLUMNS = 'id, user_id, title, personality, ended_reason, created_at, updated_at';

class ChatRepository {
  constructor({ pool } = {}) {
    this.pool = pool || require('../config/database');
  }

  async createConversation(userId, personality) {
    const { rows } = await this.pool.query(
      `INSERT INTO conversations (user_id, personality) VALUES ($1, $2)
       RETURNING ${CONVERSATION_COLUMNS}`,
      [userId, personality]
    );
    return toConversation(rows[0]);
  }

  async listConversations(userId, limit = 20) {
    const { rows } = await this.pool.query(
      `SELECT ${CONVERSATION_COLUMNS} FROM conversations
       WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2`,
      [userId, limit]
    );
    return rows.map(toConversation);
  }

  async getConversation(id, userId) {
    const { rows } = await this.pool.query(
      `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return toConversation(rows[0]);
  }

  async updateConversation(id, userId, { personality, endedReason }) {
    const { rows } = await this.pool.query(
      `UPDATE conversations
       SET personality = COALESCE($3, personality),
           ended_reason = COALESCE($4, ended_reason),
           updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING ${CONVERSATION_COLUMNS}`,
      [id, userId, personality || null, endedReason || null]
    );
    return toConversation(rows[0]);
  }

  async getMessages(conversationId) {
    const { rows } = await this.pool.query(
      `SELECT id, role, content, display_text, safeguard, created_at
       FROM chat_messages WHERE conversation_id = $1 ORDER BY id`,
      [conversationId]
    );
    return rows.map(toMessage);
  }

  /**
   * Append messages in order and bump the conversation. Sets the title from
   * the first user message if there isn't one yet.
   */
  async appendMessages(conversationId, messages, { title, endedReason } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const saved = [];
      for (const message of messages) {
        const { rows } = await client.query(
          `INSERT INTO chat_messages (conversation_id, role, content, display_text, safeguard)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, role, content, display_text, safeguard, created_at`,
          [
            conversationId,
            message.role,
            JSON.stringify(message.content),
            message.displayText || null,
            message.safeguard || null
          ]
        );
        saved.push(toMessage(rows[0]));
      }
      await client.query(
        `UPDATE conversations
         SET updated_at = now(),
             title = COALESCE(title, $2),
             ended_reason = COALESCE($3, ended_reason)
         WHERE id = $1`,
        [conversationId, title || null, endedReason || null]
      );
      await client.query('COMMIT');
      return saved;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = { ChatRepository };
