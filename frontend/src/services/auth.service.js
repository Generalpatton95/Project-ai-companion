// ============================================================================
// FILE: frontend/src/services/auth.service.js
// Client for /api/auth (see backend/routes/auth.routes.js)
// ============================================================================

import { apiRequest, setToken, clearToken, getToken } from './api.js';

export async function register({ email, password, displayName, ageConfirmed }) {
  const { token, user } = await apiRequest('/auth/register', {
    method: 'POST',
    body: { email, password, displayName, ageConfirmed }
  });
  setToken(token);
  return user;
}

export async function login({ email, password }) {
  const { token, user } = await apiRequest('/auth/login', {
    method: 'POST',
    body: { email, password }
  });
  setToken(token);
  return user;
}

/**
 * Returns the signed-in user, or null if there is no valid saved token.
 */
export async function fetchCurrentUser() {
  if (!getToken()) {
    return null;
  }
  try {
    const { user } = await apiRequest('/auth/me');
    return user;
  } catch (error) {
    if (error.status === 401) {
      clearToken();
      return null;
    }
    throw error;
  }
}

export function logout() {
  clearToken();
}
