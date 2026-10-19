// ============================================================================
// FILE: frontend/src/hooks/usePlaySession.js
// Tracks a play session and polls the backend for break reminders
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import {
  startSession,
  sendHeartbeat,
  snoozeReminders,
  endSession
} from '../services/safeguards.service.js';

const DEFAULT_HEARTBEAT_MS = 5 * 60 * 1000;

export function usePlaySession({ heartbeatMs = DEFAULT_HEARTBEAT_MS } = {}) {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);

  const run = useCallback(async (request) => {
    try {
      const status = await request();
      setSession(status.active ? status : null);
      setError(null);
      return status;
    } catch (err) {
      setError(err);
      return null;
    }
  }, []);

  const start = useCallback(() => run(startSession), [run]);
  const snooze = useCallback((minutes) => run(() => snoozeReminders(minutes)), [run]);
  const end = useCallback(() => run(endSession), [run]);

  const active = Boolean(session);

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const timer = setInterval(() => {
      run(sendHeartbeat);
    }, heartbeatMs);
    return () => clearInterval(timer);
  }, [active, heartbeatMs, run]);

  return { session, error, start, snooze, end };
}
