// ============================================================================
// FILE: backend/services/chat/chat.service.js
// Conversations with the companion (Claude), with safeguards
//
// History is append-only: every stored row is replayed to Claude exactly as
// saved, including assistant thinking blocks, and the top-level system prompt
// never changes. Personality / mood changes are appended as role: 'system'
// messages. Editing or trimming earlier turns would invalidate replayed
// thinking blocks (a 400 on newer accounts) and break prompt caching.
// ============================================================================

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../../config');
const logger = require('../../utils/logger');
const { ChatRepository } = require('../../models/chat.model');
const { MoodService } = require('../safeguards/mood.service');
const { detectCrisis, buildSafeguardResponse } = require('../safeguards/crisis-detection.service');
const { CRISIS_RESOURCES } = require('../safeguards/messages');
const { SYSTEM_PROMPT, PERSONALITIES, buildModeNote } = require('./prompts');
const {
  ValidationError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError
} = require('../../utils/errors');

const MAX_MESSAGE_LENGTH = 4000;
const TITLE_LENGTH = 60;
const MAX_TOKENS = 16000;
const DEFAULT_PERSONALITY = 'friend';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REFUSAL_REPLY =
  "I can't help with that one, but I'm happy to keep talking about your games. What's on your mind?";
const EMPTY_REPLY = "Sorry, I lost my train of thought there. Could you ask that again?";

class ChatAbortedError extends Error {
  constructor() {
    super('Chat request aborted');
    this.name = 'ChatAbortedError';
  }
}

function validatePersonality(personality) {
  if (!PERSONALITIES[personality]) {
    throw new ValidationError(`personality must be one of: ${Object.keys(PERSONALITIES).join(', ')}`);
  }
}

function textOf(content) {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

/**
 * Make an assistant turn safe to replay. After a mid-reply fallback the
 * content holds the declined model's partial output before the last
 * `fallback` block; only its text may be echoed back (its thinking and other
 * model-internal blocks would be rejected or dropped).
 */
function prepareForReplay(content) {
  const lastFallback = content.map((b) => b.type).lastIndexOf('fallback');
  if (lastFallback === -1) {
    return content;
  }
  return content.filter((block, index) =>
    index >= lastFallback || block.type === 'text' || block.type === 'fallback'
  );
}

/**
 * Messages the user should see (system notes stay hidden).
 */
function visible(messages) {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      id: m.id,
      role: m.role,
      text: m.displayText || textOf(m.content),
      safeguard: m.safeguard || null,
      ...((m.safeguard === 'crisis' || m.safeguard === 'distress') && { resources: CRISIS_RESOURCES }),
      createdAt: m.createdAt
    }));
}

class ChatService {
  constructor({
    chats = new ChatRepository(),
    moods = new MoodService(),
    client = null,
    model = config.anthropic.chatModel,
    effort = config.anthropic.chatEffort
  } = {}) {
    this.chats = chats;
    this.moods = moods;
    this.client = client;
    this.model = model;
    this.effort = effort;
  }

  getClient() {
    if (!this.client) {
      this.client = new Anthropic({ apiKey: config.anthropic.apiKey });
    }
    return this.client;
  }

  async requireConversation(user, conversationId) {
    if (!UUID_PATTERN.test(String(conversationId))) {
      throw new NotFoundError('Conversation not found');
    }
    const conversation = await this.chats.getConversation(conversationId, user.id);
    if (!conversation) {
      throw new NotFoundError('Conversation not found');
    }
    return conversation;
  }

  async createConversation(user, { personality = DEFAULT_PERSONALITY } = {}) {
    validatePersonality(personality);
    return this.chats.createConversation(user.id, personality);
  }

  listConversations(user) {
    return this.chats.listConversations(user.id);
  }

  async getConversation(user, conversationId) {
    const conversation = await this.requireConversation(user, conversationId);
    const messages = await this.chats.getMessages(conversation.id);
    return { conversation, messages: visible(messages) };
  }

  async setPersonality(user, conversationId, personality) {
    validatePersonality(personality);
    await this.requireConversation(user, conversationId);
    return this.chats.updateConversation(conversationId, user.id, { personality });
  }

  async moodTone(userId) {
    try {
      return (await this.moods.getSummary(userId)).tone;
    } catch (error) {
      logger.warn('Mood summary unavailable for chat', { error: error.message });
      return 'balanced';
    }
  }

  /**
   * Send a message and get the companion's reply. The reply streams from
   * Claude; pass onText to receive text as it arrives, and signal to stop the
   * request (nothing is saved for an aborted turn).
   */
  async sendMessage(user, conversationId, text, { onText, signal } = {}) {
    const content = typeof text === 'string' ? text.trim() : '';
    if (!content) {
      throw new ValidationError('Message cannot be empty');
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
      throw new ValidationError(`Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer`);
    }

    const conversation = await this.requireConversation(user, conversationId);
    if (conversation.endedReason) {
      throw new ConflictError('This conversation has ended. You can start a new one.');
    }

    const title = content.slice(0, TITLE_LENGTH);
    const userMessage = { role: 'user', content };

    // Safeguards run before anything is sent to Claude
    const { level } = detectCrisis(content);
    if (level !== 'none') {
      const response = buildSafeguardResponse(level);
      logger.warn('Chat safeguard triggered', { userId: user.id, level });
      const saved = await this.chats.appendMessages(
        conversation.id,
        [userMessage, { role: 'assistant', content: response.message, safeguard: level }],
        { title, endedReason: level === 'crisis' ? 'crisis' : null }
      );
      return {
        messages: visible(saved),
        safeguard: response,
        conversation: { ...conversation, endedReason: level === 'crisis' ? 'crisis' : null }
      };
    }

    const history = await this.chats.getMessages(conversation.id);
    const pending = [userMessage];

    // Append a mode note when the personality or mood tone has changed since
    // the last one (always on the first turn)
    const lastNote = [...history].reverse().find((m) => m.role === 'system');
    const note = buildModeNote(conversation.personality, await this.moodTone(user.id));
    if (!lastNote || lastNote.content !== note) {
      pending.push({ role: 'system', content: note });
    }

    const apiMessages = [...history, ...pending].map((m) => ({ role: m.role, content: m.content }));

    let response;
    try {
      const stream = this.getClient().beta.messages.stream({
        model: this.model,
        max_tokens: MAX_TOKENS,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: this.effort },
        cache_control: { type: 'ephemeral' },
        system: SYSTEM_PROMPT,
        messages: apiMessages
      }, { signal });
      if (onText) {
        stream.on('text', (delta) => onText(delta));
      }
      response = await stream.finalMessage();
    } catch (error) {
      if (signal && signal.aborted) {
        throw new ChatAbortedError();
      }
      if (error instanceof Anthropic.APIError) {
        logger.error('Claude API error in chat', { status: error.status, error: error.message });
      } else {
        logger.error('Chat request failed', { error: error.message });
      }
      throw new ServiceUnavailableError('The companion is unavailable right now. Please try again in a moment.');
    }

    let assistant;
    if (response.stop_reason === 'refusal') {
      logger.warn('Chat reply refused', { category: response.stop_details && response.stop_details.category });
      assistant = { role: 'assistant', content: REFUSAL_REPLY, safeguard: 'refusal' };
    } else {
      const replyText = textOf(response.content);
      assistant = replyText
        ? { role: 'assistant', content: prepareForReplay(response.content), displayText: replyText }
        : { role: 'assistant', content: EMPTY_REPLY };
    }

    const saved = await this.chats.appendMessages(conversation.id, [...pending, assistant], { title });
    return { messages: visible(saved), safeguard: null, conversation };
  }
}

module.exports = {
  ChatService,
  ChatAbortedError,
  prepareForReplay,
  DEFAULT_PERSONALITY,
  MAX_MESSAGE_LENGTH
};
