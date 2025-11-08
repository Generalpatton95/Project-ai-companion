// ============================================================================
// FILE: backend/agent/orchestrator.js
// Main Agent Orchestrator - Controls agent execution flow
// ============================================================================

const { ToolRegistry } = require('../tools');
const { StateManager } = require('./state-manager');
const { ClaudeProvider } = require('../integrations/claude');
const logger = require('../utils/logger');

class AgentOrchestrator {
  constructor(options = {}) {
    this.llm = new ClaudeProvider();
    this.toolRegistry = new ToolRegistry();
    this.stateManager = new StateManager();
    this.maxIterations = options.maxIterations || 10;
    this.timeout = options.timeout || 30000; // 30 seconds
  }

  /**
   * Execute an agent task
   * @param {Object} task - Task configuration
   * @param {string} task.type - Type of task (e.g., 'match_analysis')
   * @param {Object} task.parameters - Task parameters
   * @param {Object} task.context - User context
   * @returns {Object} Task result
   */
  async executeTask(task) {
    const taskId = this.generateTaskId();
    const startTime = Date.now();
    
    try {
      logger.info('Starting agent task', { taskId, type: task.type });
      
      // Initialize task state
      const state = await this.stateManager.createTask(taskId, task);
      
      // Set timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Task timeout')), this.timeout);
      });
      
      // Execute task with timeout
      const result = await Promise.race([
        this.runAgentLoop(taskId, task, state),
        timeoutPromise
      ]);
      
      // Update final state
      await this.stateManager.completeTask(taskId, result);
      
      const duration = Date.now() - startTime;
      logger.info('Task completed', { taskId, duration });
      
      return {
        taskId,
        status: 'completed',
        result,
        duration,
        iterations: state.iterations
      };
      
    } catch (error) {
      logger.error('Task failed', { taskId, error: error.message });
      
      // Try to generate partial result
      const partialResult = await this.handleError(taskId, error);
      
      await this.stateManager.failTask(taskId, error.message);
      
      return {
        taskId,
        status: 'failed',
        error: error.message,
        partialResult,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Main agent reasoning loop
   */
  async runAgentLoop(taskId, task, state) {
    const messages = this.buildInitialMessages(task);
    const tools = this.toolRegistry.getToolSchemas();
    
    for (let i = 0; i < this.maxIterations; i++) {
      logger.debug('Agent iteration', { taskId, iteration: i + 1 });
      
      // Get LLM response with tools
      const response = await this.llm.complete(messages, tools);
      
      // Add assistant response to messages
      messages.push({
        role: 'assistant',
        content: response.content
      });
      
      // Update state
      await this.stateManager.addIteration(taskId, {
        iteration: i + 1,
        response: response.content
      });
      
      // Check if task is complete (no tool calls)
      if (response.stopReason === 'end_turn' || !response.toolCalls?.length) {
        return this.extractFinalAnswer(response.content);
      }
      
      // Execute tool calls
      const toolResults = await this.executeTools(taskId, response.toolCalls);
      
      // Add tool results to messages
      messages.push({
        role: 'user',
        content: this.formatToolResults(toolResults)
      });
      
      // Check if we should stop based on tool results
      if (this.shouldStopIteration(toolResults)) {
        const finalResponse = await this.llm.complete(messages);
        return this.extractFinalAnswer(finalResponse.content);
      }
    }
    
    // Max iterations reached - generate summary
    logger.warn('Max iterations reached', { taskId });
    const summary = await this.generateSummary(messages);
    return summary;
  }

  /**
   * Execute multiple tool calls
   */
  async executeTools(taskId, toolCalls) {
    const results = [];
    
    for (const toolCall of toolCalls) {
      try {
        logger.debug('Executing tool', { taskId, tool: toolCall.name });
        
        const tool = this.toolRegistry.getTool(toolCall.name);
        const result = await tool.execute(toolCall.input);
        
        results.push({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          success: result.success,
          data: result.data,
          error: result.error
        });
        
        // Record tool execution
        await this.stateManager.recordToolExecution(taskId, {
          tool: toolCall.name,
          input: toolCall.input,
          result
        });
        
      } catch (error) {
        logger.error('Tool execution failed', { 
          taskId, 
          tool: toolCall.name, 
          error: error.message 
        });
        
        results.push({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          success: false,
          error: error.message
        });
      }
    }
    
    return results;
  }

  /**
   * Build initial messages for the task
   */
  buildInitialMessages(task) {
    const systemPrompt = this.getSystemPrompt(task.type);
    const userPrompt = this.buildUserPrompt(task);
    
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
  }

  /**
   * Get system prompt based on task type
   */
  getSystemPrompt(taskType) {
    const basePrompt = `You are an expert gaming companion AI assistant with deep knowledge of competitive gaming, strategies, and player improvement.

Your role is to help players improve their gameplay through data-driven analysis and actionable advice.

When analyzing data:
1. Look for concrete patterns and trends
2. Provide specific, actionable recommendations
3. Back up claims with data
4. Consider the player's skill level and goals

Always think step by step and use the available tools to gather information before providing recommendations.`;

    const taskPrompts = {
      match_analysis: '\n\nYour current task is to analyze the player\'s recent matches and provide a comprehensive performance report with specific improvement recommendations.',
      meta_research: '\n\nYour current task is to research the current meta and provide insights on optimal strategies and champion picks.',
      strategy_planning: '\n\nYour current task is to create a personalized improvement plan for the player based on their goals and current performance.'
    };

    return basePrompt + (taskPrompts[taskType] || '');
  }

  /**
   * Build user prompt with task parameters
   */
  buildUserPrompt(task) {
    const { parameters, context } = task;
    
    let prompt = `Task: ${task.type}\n\n`;
    
    if (context) {
      prompt += `Player Context:\n`;
      if (context.game) prompt += `- Game: ${context.game}\n`;
      if (context.rank) prompt += `- Rank: ${context.rank}\n`;
      if (context.mainRole) prompt += `- Main Role: ${context.mainRole}\n`;
      prompt += '\n';
    }
    
    if (parameters) {
      prompt += `Parameters:\n`;
      Object.entries(parameters).forEach(([key, value]) => {
        prompt += `- ${key}: ${JSON.stringify(value)}\n`;
      });
      prompt += '\n';
    }
    
    prompt += `Please analyze this request and use the available tools to gather necessary data, then provide your analysis.`;
    
    return prompt;
  }

  /**
   * Format tool results for LLM
   */
  formatToolResults(toolResults) {
    let formatted = 'Tool Execution Results:\n\n';
    
    toolResults.forEach(result => {
      formatted += `Tool: ${result.toolName}\n`;
      formatted += `Status: ${result.success ? 'Success' : 'Failed'}\n`;
      
      if (result.success) {
        formatted += `Data: ${JSON.stringify(result.data, null, 2)}\n`;
      } else {
        formatted += `Error: ${result.error}\n`;
      }
      
      formatted += '\n';
    });
    
    return formatted;
  }

  /**
   * Extract final answer from LLM response
   */
  extractFinalAnswer(content) {
    // If content is array (with tool_use blocks), extract text
    if (Array.isArray(content)) {
      const textBlocks = content.filter(block => block.type === 'text');
      return {
        summary: textBlocks.map(b => b.text).join('\n'),
        data: null
      };
    }
    
    return {
      summary: content,
      data: null
    };
  }

  /**
   * Check if iteration should stop
   */
  shouldStopIteration(toolResults) {
    // Stop if all tools failed
    const allFailed = toolResults.every(r => !r.success);
    if (allFailed) {
      logger.warn('All tools failed, stopping iteration');
      return true;
    }
    
    return false;
  }

  /**
   * Generate summary when max iterations reached
   */
  async generateSummary(messages) {
    messages.push({
      role: 'user',
      content: 'Please provide a summary of your analysis based on the information gathered so far.'
    });
    
    const response = await this.llm.complete(messages);
    return this.extractFinalAnswer(response.content);
  }

  /**
   * Handle task errors and try to generate partial result
   */
  async handleError(taskId, error) {
    try {
      const state = await this.stateManager.getTask(taskId);
      
      if (state && state.iterations > 0) {
        logger.info('Attempting to generate partial result', { taskId });
        // Return what we have so far
        return {
          partial: true,
          completedSteps: state.iterations,
          message: 'Task incomplete due to error, returning partial results.'
        };
      }
    } catch (err) {
      logger.error('Failed to generate partial result', { error: err.message });
    }
    
    return null;
  }

  /**
   * Generate unique task ID
   */
  generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = { AgentOrchestrator };
