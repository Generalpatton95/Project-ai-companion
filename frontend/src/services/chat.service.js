// ============================================================================
// FILE: frontend/src/services/chat.service.js
// Client for /api/chat (see backend/routes/chat.routes.js)
// ============================================================================

import { apiRequest, apiStream } from './api.js';

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
/**
 * Send a message and stream the reply. onDelta receives reply text as it
 * arrives; resolves with the saved turn ({ messages, safeguard, conversation }).
 */
export async function sendMessageStream(id, content, { onDelta, signal } = {}) {
  let result = null;
  await apiStream(`/chat/conversations/${id}/messages`, {
    body: { content },
    signal,
    onEvent: (event, data) => {
      if (event === 'delta' && onDelta) {
        onDelta(data.text);
      } else if (event === 'done') {
        result = data;
      } else if (event === 'error') {
        // `data` rides along like apiRequest's, so an outage's crisis
        // resources (data.resources) reach the page
        throw Object.assign(new Error(data.error), { status: data.status, data });
      }
    }
  });
  if (!result) {
    throw Object.assign(new Error('The reply was interrupted. Please try again.'), { status: 0 });
  }
  return result;
}
