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
    // Framing follows docs/phase1-responsible-mvp.md (Safeguard 7: progress
    // over perfection, and the post-analysis screen: strengths first)
    const basePrompt = `You are the analysis side of an AI gaming companion that helps League of Legends players improve and enjoy the game more. Use the available tools to gather the player's data before writing your report.

How to write about a player's performance:
- Lead with what the player is doing well, backed by specifics from their data, before anything they could improve.
- Call areas to improve "growth opportunities" and frame each one as a concrete, achievable next step (for example, "vision score 18, aim for 25"), never as a verdict on the player. Avoid words like "bad", "terrible", or "should have won".
- Compare the player with their own past games, not with other players or with where their rank "should" be. When the data shows change over time, point it out, and acknowledge effort as well as results.
- Treat losses and mistakes as information to learn from.
- Keep growth opportunities to two or three, so the player can act on them next game.

Accuracy: base every claim about the player on data you actually retrieved. If a tool fails or data is missing, say so plainly, then give general advice clearly labeled as general. Never invent statistics.

Format: the report is shown as plain text, so don't use Markdown (no #, **, or tables). Put short section labels on their own line and use "- " for list items. Keep it short enough to read on a phone.`;

    const taskPrompts = {
      match_analysis: `

Your current task is to analyze the player's recent matches. Organize the report as:
Your strengths
Growth opportunities (two or three, each with a concrete next step)
Progress (only if the data shows change over time)
Then close with one encouraging line that invites them to ask follow-up questions in chat.`,
      meta_research: `

Your current task is to research the current meta and give insights on strategies and champion picks, tailored to the player's role and rank when they're given. There's no individual performance to assess here. Say which patch or time period your information reflects, since the meta changes often.`,
      strategy_planning: `

Your current task is to create a personalized improvement plan. Start with the strengths the player can build on, then two or three focus areas, each with something concrete to practice over the next week and a goal measured against their own current level.`
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
