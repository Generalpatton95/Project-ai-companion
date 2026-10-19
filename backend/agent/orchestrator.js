const { ToolRegistry } = require('../tools');
const { StateManager } = require('./state-manager');
const { ClaudeProvider } = require('../integrations/claude');
const config = require('../config');
const logger = require('../utils/logger');

class AgentOrchestrator {
  constructor(options = {}) {
    this.llm = options.llm || new ClaudeProvider();
    this.toolRegistry = options.toolRegistry || new ToolRegistry();
    this.stateManager = options.stateManager || new StateManager();
    this.maxIterations = options.maxIterations || config.agent.maxIterations;
    this.timeout = options.timeout || config.agent.timeout;
  }

  /**
   * Run a task to completion and return its result.
   */
  async executeTask(task) {
    const { taskId, state } = await this.createTask(task);
    return this.runTask(taskId, task, state);
  }

  /**
   * Record a task and start it in the background. Resolves once the task can
   * be polled (GET /api/agent/task/:taskId); `done` settles when it finishes.
   */
  async startTask(task) {
    const { taskId, state } = await this.createTask(task);
    const done = this.runTask(taskId, task, state).catch((error) => {
      // runTask records its own failures; this only catches errors while
      // recording them (e.g. Redis down), which must not crash the process
      logger.error('Background agent task crashed', { taskId, error: error.message });
    });
    return { taskId, done };
  }

  async createTask(task) {
    const taskId = this.generateTaskId();
    logger.info('Starting agent task', { taskId, type: task.type });
    const state = await this.stateManager.createTask(taskId, task);
    return { taskId, state };
  }

  async runTask(taskId, task, state) {
    const startTime = Date.now();
    
    try {
      // On timeout, abort the in-flight Claude request and stop the loop so a
      // timed-out task doesn't keep spending tokens in the background
      const controller = new AbortController();
      let timer;
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Task timeout'));
        }, this.timeout);
      });
      
      let result;
      try {
        result = await Promise.race([
          this.runAgentLoop(taskId, task, state, controller.signal),
          timeoutPromise
        ]);
      } finally {
        clearTimeout(timer);
      }
      
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

  async runAgentLoop(taskId, task, state, signal) {
    const messages = this.buildInitialMessages(task);
    const tools = this.toolRegistry.getToolSchemas();
    
    for (let i = 0; i < this.maxIterations; i++) {
      this.throwIfAborted(signal);
      logger.debug('Agent iteration', { taskId, iteration: i + 1 });
      
      const response = await this.llm.complete(messages, tools, { signal });
      
      messages.push({
        role: 'assistant',
        content: response.content
      });
      
      await this.stateManager.addIteration(taskId, {
        iteration: i + 1,
        response: response.content
      });
      
      if (response.stopReason === 'end_turn' || !response.toolCalls?.length) {
        return this.extractFinalAnswer(response.content);
      }
      
      this.throwIfAborted(signal);
      const toolResults = await this.executeTools(taskId, response.toolCalls);
      
      messages.push({
        role: 'user',
        content: this.formatToolResults(toolResults)
      });
      
      if (this.shouldStopIteration(toolResults)) {
        const finalResponse = await this.llm.complete(messages, tools, { signal });
        return this.extractFinalAnswer(finalResponse.content);
      }
    }
    
    logger.warn('Max iterations reached', { taskId });
    const summary = await this.generateSummary(messages, tools, signal);
    return summary;
  }

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

  buildInitialMessages(task) {
    const systemPrompt = this.getSystemPrompt(task.type);
    const userPrompt = this.buildUserPrompt(task);
    
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
  }

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
   * One tool_result block per tool_use, all in a single user message
   */
  formatToolResults(toolResults) {
    return toolResults.map(result => ({
      type: 'tool_result',
      tool_use_id: result.toolCallId,
      content: result.success
        ? JSON.stringify(result.data ?? null, null, 2)
        : `Error: ${result.error}`,
      ...(!result.success && { is_error: true })
    }));
  }

  extractFinalAnswer(content) {
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

  shouldStopIteration(toolResults) {
    const allFailed = toolResults.every(r => !r.success);
    if (allFailed) {
      logger.warn('All tools failed, stopping iteration');
      return true;
    }
    
    return false;
  }

  throwIfAborted(signal) {
    if (signal && signal.aborted) {
      throw new Error('Task timeout');
    }
  }

  async generateSummary(messages, tools, signal) {
    messages.push({
      role: 'user',
      content: 'Please provide a summary of your analysis based on the information gathered so far.'
    });
    
    const response = await this.llm.complete(messages, tools, { signal });
    return this.extractFinalAnswer(response.content);
  }

  async handleError(taskId, error) {
    try {
      const state = await this.stateManager.getTask(taskId);
      
      if (state && state.iterations > 0) {
        logger.info('Attempting to generate partial result', { taskId });
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

  generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = { AgentOrchestrator };
