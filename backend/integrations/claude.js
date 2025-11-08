// ============================================================================
// FILE: backend/integrations/claude.js
// Claude API Client
// ============================================================================

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const logger = require('../utils/logger');

class ClaudeProvider {
  constructor() {
    this.client = new Anthropic({
      apiKey: config.anthropic.apiKey
    });
    this.model = config.anthropic.model || 'claude-sonnet-4-20250514';
    this.maxTokens = config.anthropic.maxTokens || 4000;
  }

  /**
   * Complete a conversation with tools
   */
  async complete(messages, tools = null, options = {}) {
    try {
      const requestParams = {
        model: this.model,
        max_tokens: options.maxTokens || this.maxTokens,
        messages: this.formatMessages(messages),
        temperature: options.temperature || 0.7
      };

      if (tools && tools.length > 0) {
        requestParams.tools = tools;
      }

      logger.debug('Claude API request', { 
        messageCount: messages.length,
        toolCount: tools?.length || 0 
      });

      const response = await this.client.messages.create(requestParams);

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
   * Format messages for Claude API
   */
  formatMessages(messages) {
    return messages
      .filter(msg => msg.role !== 'system') // System messages handled separately in some cases
      .map(msg => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      }));
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