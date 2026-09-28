// ============================================================================
// FILE: backend/controllers/agent.controller.js
// Agent Controller - Handles agent-related requests
// ============================================================================

import { AgentOrchestrator } from '../agent/orchestrator.js';
import { StateManager } from '../agent/state-manager.js';
import logger from '../utils/logger.js';

class AgentController {
  constructor() {
    this.orchestrator = new AgentOrchestrator();
    this.stateManager = new StateManager();
  }

  /**
   * Handle simple query
   */
  async handleQuery(body, user) {
    const { query, context = {} } = body;

    if (!query) {
      throw new Error('Query is required');
    }

    logger.info('Handling query', { userId: user.id, query });

    // For simple queries, use fast response
    // This could call a simpler LLM or knowledge base
    const result = {
      answer: 'This would be a fast response from knowledge base or simple LLM call',
      sources: []
    };

    return result;
  }

  /**
   * Handle complex analysis
   */
  async handleAnalysis(body, user) {
    const { task_type, parameters, context = {} } = body;

    if (!task_type) {
      throw new Error('task_type is required');
    }

    logger.info('Handling analysis', { userId: user.id, taskType: task_type });

    // Execute agent task
    const task = {
      type: task_type,
      parameters,
      context: {
        ...context,
        userId: user.id
      }
    };

    const result = await this.orchestrator.executeTask(task);

    return result;
  }

  /**
   * Get task status
   */
  async getTaskStatus(taskId, user) {
    try {
      const state = await this.stateManager.getTask(taskId);

      // Verify user owns this task
      if (state.context.userId !== user.id) {
        throw new Error('Unauthorized');
      }

      return {
        taskId,
        status: state.status,
        iterations: state.iterations,
        result: state.result,
        error: state.error,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt
      };
    } catch (error) {
      logger.error('Failed to get task status', { taskId, error: error.message });
      throw error;
    }
  }
}

export { AgentController };