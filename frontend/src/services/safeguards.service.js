// ============================================================================
// FILE: frontend/src/services/safeguards.service.js
// Client for /api/safeguards (see backend/routes/safeguards.routes.js)
// ============================================================================

import { apiRequest } from './api.js';

export function recordMood(phase, mood) {
  return apiRequest('/safeguards/mood', { method: 'POST', body: { phase, mood } });
}

export function getMoodSummary() {
  return apiRequest('/safeguards/mood/summary');
}

export function startSession() {
  return apiRequest('/safeguards/session/start', { method: 'POST' });
}

export function sendHeartbeat() {
  return apiRequest('/safeguards/session/heartbeat', { method: 'POST' });
}

export function snoozeReminders(minutes) {
  return apiRequest('/safeguards/session/snooze', { method: 'POST', body: { minutes } });
}

export function endSession() {
  return apiRequest('/safeguards/session/end', { method: 'POST' });
}

export function getUsage() {
  return apiRequest('/safeguards/usage');
}
