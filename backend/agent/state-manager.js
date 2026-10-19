const redis = require('../config/redis');

class StateManager {
  constructor({ store } = {}) {
    this.redis = store || redis;
    this.ttl = 3600;
  }

  async createTask(taskId, task) {
    const state = {
      taskId,
      type: task.type,
      parameters: task.parameters,
      context: task.context,
      status: 'running',
      iterations: 0,
      steps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await this.saveState(taskId, state);
    return state;
  }

  async addIteration(taskId, iterationData) {
    const state = await this.getTask(taskId);
    
    state.iterations += 1;
    state.steps.push({
      iteration: state.iterations,
      ...iterationData,
      timestamp: new Date().toISOString()
    });
    state.updatedAt = new Date().toISOString();

    await this.saveState(taskId, state);
  }

  async recordToolExecution(taskId, toolData) {
    const state = await this.getTask(taskId);
    
    const lastStep = state.steps[state.steps.length - 1];
    if (!lastStep.tools) {
      lastStep.tools = [];
    }
    
    lastStep.tools.push({
      ...toolData,
      timestamp: new Date().toISOString()
    });
    
    state.updatedAt = new Date().toISOString();
    await this.saveState(taskId, state);
  }

  async completeTask(taskId, result) {
    const state = await this.getTask(taskId);
    
    state.status = 'completed';
    state.result = result;
    state.completedAt = new Date().toISOString();
    state.updatedAt = new Date().toISOString();

    await this.saveState(taskId, state);
  }

  async failTask(taskId, error) {
    const state = await this.getTask(taskId);
    
    state.status = 'failed';
    state.error = error;
    state.failedAt = new Date().toISOString();
    state.updatedAt = new Date().toISOString();

    await this.saveState(taskId, state);
  }

  async getTask(taskId) {
    const key = `task:${taskId}`;
    const data = await this.redis.get(key);
    
    if (!data) {
      throw new Error(`Task not found: ${taskId}`);
    }
    
    return JSON.parse(data);
  }

  async saveState(taskId, state) {
    const key = `task:${taskId}`;
    await this.redis.setex(key, this.ttl, JSON.stringify(state));
  }

  async deleteTask(taskId) {
    const key = `task:${taskId}`;
    await this.redis.del(key);
  }
}

module.exports = { StateManager };
