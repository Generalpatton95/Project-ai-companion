// ============================================================================
// FILE: frontend/src/context/AuthContext.jsx
// Signed-in user state
// ============================================================================

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as authService from '../services/auth.service.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');

  const loadUser = useCallback(async () => {
    setStatus('loading');
    try {
      setUser(await authService.fetchCurrentUser());
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const login = useCallback(async (credentials) => {
    setUser(await authService.login(credentials));
  }, []);

  const register = useCallback(async (details) => {
    setUser(await authService.register(details));
  }, []);

  const logout = useCallback(() => {
    authService.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, status, login, register, logout, retry: loadUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
