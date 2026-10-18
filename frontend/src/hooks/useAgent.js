// ============================================================================
// FILE: frontend/src/hooks/useAgent.js
// Starts a background analysis and polls it until it finishes
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { startAnalysis, getTask } from '../services/agent.service.js';

const TASK_KEY = 'companion.analysisTaskId';
const MAX_POLL_FAILURES = 5;

function saveTaskId(taskId) {
  try {
    if (taskId) localStorage.setItem(TASK_KEY, taskId);
    else localStorage.removeItem(TASK_KEY);
  } catch {
    // Storage unavailable: a reload just won't resume the analysis
  }
}

function savedTaskId() {
  try {
    return localStorage.getItem(TASK_KEY);
  } catch {
    return null;
  }
}

export function useAnalysisTask({ pollMs = 2000 } = {}) {
  // Resume an analysis that was running when the page was last open
  const [task, setTask] = useState(() => {
    const taskId = savedTaskId();
    return taskId ? { taskId, status: 'running', resumed: true } : null;
  });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);
  const failures = useRef(0);

  const start = useCallback(async (body) => {
    setStarting(true);
    setStartError(null);
    try {
      const { taskId } = await startAnalysis(body);
      failures.current = 0;
      saveTaskId(taskId);
      setTask({ taskId, status: 'running', iterations: 0 });
    } catch (error) {
      setStartError(error);
    } finally {
      setStarting(false);
    }
  }, []);

  const reset = useCallback(() => {
    saveTaskId(null);
    setTask(null);
    setStartError(null);
  }, []);

  const running = Boolean(task && task.status === 'running');
  const taskId = task && task.taskId;
  const resumed = Boolean(task && task.resumed);

  useEffect(() => {
    if (!running) {
      return undefined;
    }
    let cancelled = false;
    let timer;

    // Poll one request at a time, so slow responses never overlap
    const poll = async () => {
      try {
        const status = await getTask(taskId);
        if (cancelled) return;
        failures.current = 0;
        if (status.status !== 'running') {
          saveTaskId(null);
        }
        setTask((current) => (current && current.taskId === taskId ? { ...current, ...status } : current));
        if (status.status !== 'running') return;
      } catch (error) {
        if (cancelled) return;
        if (error.status === 404) {
          // Expired or not ours (e.g. a different account signed in)
          saveTaskId(null);
          setTask(null);
          return;
        }
        failures.current += 1;
        if (failures.current >= MAX_POLL_FAILURES) {
          setTask((current) => current && {
            ...current,
            status: 'failed',
            error: "Lost touch with the server. Your analysis may still finish; check back in a moment."
          });
          return;
        }
      }
      timer = setTimeout(poll, pollMs);
    };

    // A resumed task is checked right away; a new one after the first interval
    timer = setTimeout(poll, resumed ? 0 : pollMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [taskId, running, resumed, pollMs]);

  return { task, starting, startError, start, reset };
}
