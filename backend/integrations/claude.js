// ============================================================================
// FILE: backend/integrations/claude.js
// Claude API Client
// ============================================================================

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const logger = require('../utils/logger');

class ClaudeProvider {
  constructor({
    client = null,
    model = config.anthropic.model,
    maxTokens = config.anthropic.maxTokens,
    effort = config.anthropic.effort
  } = {}) {
    this.client = client;
    this.model = model;
    this.maxTokens = maxTokens;
    this.effort = effort;
  }

  getClient() {
    if (!this.client) {
      this.client = new Anthropic({ apiKey: config.anthropic.apiKey });
    }
    return this.client;
  }

  /**
   * Complete a conversation with tools.
   *
   * Pass the same `tools` on every call in a conversation: the API needs tool
   * definitions while the history holds tool_use blocks, and changing them
   * invalidates the thinking blocks replayed from earlier turns.
   * Sampling parameters (temperature, top_p, top_k) are not sent; current
   * models reject them.
   */
  async complete(messages, tools = null, options = {}) {
    try {
      const { system, conversation } = this.formatMessages(messages);

      const requestParams = {
        model: this.model,
        max_tokens: options.maxTokens || this.maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: this.effort },
        messages: conversation
      };

      if (system) {
        requestParams.system = system;
      }

      if (tools && tools.length > 0) {
        requestParams.tools = tools;
      }

      logger.debug('Claude API request', {
        messageCount: conversation.length,
        toolCount: tools?.length || 0
      });

      const response = await this.getClient().beta.messages.create(
        requestParams,
        options.signal ? { signal: options.signal } : undefined
      );

      logger.debug('Claude API response', {
        stopReason: response.stop_reason,
        usage: response.usage
      });

      return {
        content: response.content,
        stopReason: response.stop_reason,
        toolCalls: this.extractToolCalls(response.content),
        usage: response.usage
      };

    } catch (error) {
      logger.error('Claude API error', { error: error.message });
      throw error;
    }
  }

  /**
   * Split leading system messages into the top-level system prompt and pass
   * everything else through unchanged. Content blocks (tool_use, tool_result,
   * thinking) must be sent back as-is, not stringified.
   */
  formatMessages(messages) {
    let start = 0;
    const systemParts = [];
    while (start < messages.length && messages[start].role === 'system') {
      systemParts.push(messages[start].content);
      start += 1;
    }

    return {
      system: systemParts.join('\n\n'),
      conversation: messages.slice(start).map(msg => ({
        role: msg.role,
        content: msg.content
      }))
    };
  }

  /**
   * Extract tool calls from response content
   */
  extractToolCalls(content) {
    if (!Array.isArray(content)) return [];

    return content
      .filter(block => block.type === 'tool_use')
      .map(block => ({
        id: block.id,
        name: block.name,
        input: block.input
      }));
  }
}

module.exports = { ClaudeProvider };
