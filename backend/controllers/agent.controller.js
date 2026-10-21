// ============================================================================
// FILE: backend/controllers/agent.controller.js
// Agent Controller - Handles agent-related requests
// ============================================================================

const { AgentOrchestrator } = require('../agent/orchestrator');
const { StateManager } = require('../agent/state-manager');
const { TASK_TYPES } = require('../agent/report-schemas');
const config = require('../config');
const logger = require('../utils/logger');
const { errorFields } = require('../utils/log-fields');
const { ValidationError, NotFoundError } = require('../utils/errors');

// A task still 'running' this long after it started was cut off (e.g. by a
// server restart) and will never finish
const STALE_GRACE_MS = 60000;

class AgentController {
  constructor({
    orchestrator = new AgentOrchestrator(),
    stateManager = new StateManager(),
    taskTimeout = config.agent.timeout
  } = {}) {
    this.orchestrator = orchestrator;
    this.stateManager = stateManager;
    this.taskTimeout = taskTimeout;
  }

  /**
   * Handle simple query
   */
  async handleQuery(body, user) {
    const { query } = body;

    if (!query) {
      throw new ValidationError('query is required');
    }

    // The query text is never logged, only its length
    logger.info('Handling query', { userId: user.id, queryLength: query.length });

    // For simple queries, use fast response
    // This could call a simpler LLM or knowledge base
    const result = {
      answer: 'This would be a fast response from knowledge base or simple LLM call',
      sources: []
    };

    return result;
  }

  /**
   * Start a complex analysis in the background. Poll getTaskStatus with the
   * returned taskId for progress and the result.
   */
  async handleAnalysis(body, user) {
    const { task_type, parameters, context = {} } = body;

    if (!task_type) {
      throw new ValidationError('task_type is required');
    }

    // Only a known type goes on: taskType is the fixed value from the list,
    // never the client's text, so it is safe to log and to use
    const taskType = TASK_TYPES.find((type) => type === task_type);
    if (!taskType) {
      throw new ValidationError(`task_type must be one of: ${TASK_TYPES.join(', ')}`);
    }

    logger.info('Handling analysis', { userId: user.id, taskType });

    // Execute agent task
    const task = {
      type: taskType,
      parameters,
      context: {
        ...context,
        userId: user.id
      }
    };

    const { taskId } = await this.orchestrator.startTask(task);

    return {
      taskId,
      status: 'running',
      statusUrl: `/api/agent/task/${taskId}`
    };
  }

  /**
   * Get task status
   */
  async getTaskStatus(taskId, user) {
    let state;
    try {
      state = await this.stateManager.getTask(taskId);
    } catch (error) {
      if (error.message.startsWith('Task not found')) {
        throw new NotFoundError('Task not found');
      }
      logger.error('Failed to get task status', { taskId, ...errorFields(error) });
      throw error;
    }

    // Someone else's task looks the same as a missing one
    if (!state.context || state.context.userId !== user.id) {
      throw new NotFoundError('Task not found');
    }

    let { status, error } = state;
    const age = Date.now() - new Date(state.createdAt).getTime();
    if (status === 'running' && age > this.taskTimeout + STALE_GRACE_MS) {
      status = 'failed';
      error = 'The analysis was interrupted. Please try again.';
    }

    return {
      taskId,
      status,
      iterations: state.iterations,
      result: state.result,
      error,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt
    };
  }
}

module.exports = { AgentController };