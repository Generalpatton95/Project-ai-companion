// ============================================================================
// FILE: frontend/src/services/agent.service.js
// Client for /api/agent (see backend/routes/agent.routes.js)
// ============================================================================

import { apiRequest } from './api.js';

/**
 * Start a background analysis. Resolves with { taskId, status, statusUrl }.
 * Body: { task_type, parameters, context, override? }
 */
export function startAnalysis(body) {
  return apiRequest('/agent/analyze', { method: 'POST', body });
}

/**
 * Current state of an analysis: { status: 'running' | 'completed' | 'failed', ... }
 */
export function getTask(taskId) {
  return apiRequest(`/agent/task/${encodeURIComponent(taskId)}`);
}
