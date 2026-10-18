// ============================================================================
// FILE: frontend/src/services/chat.service.js
// Client for /api/chat (see backend/routes/chat.routes.js)
// ============================================================================

import { apiRequest } from './api.js';

export async function listConversations() {
  const { conversations } = await apiRequest('/chat/conversations');
  return conversations;
}

export async function createConversation(personality) {
  const { conversation } = await apiRequest('/chat/conversations', {
    method: 'POST',
    body: { personality }
  });
  return conversation;
}

export function getConversation(id) {
  return apiRequest(`/chat/conversations/${id}`);
}

export async function setPersonality(id, personality) {
  const { conversation } = await apiRequest(`/chat/conversations/${id}`, {
    method: 'PATCH',
    body: { personality }
  });
  return conversation;
}

export function sendMessage(id, content) {
  return apiRequest(`/chat/conversations/${id}/messages`, {
    method: 'POST',
    body: { content }
  });
}
