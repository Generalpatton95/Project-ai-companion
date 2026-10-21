// ============================================================================
// FILE: backend/utils/unavailable.js
// Fail-closed helpers for checks that guard a request (rate and usage limits)
// ============================================================================

const { ServiceUnavailableError } = require('./errors');
const { CRISIS_RESOURCES } = require('../services/safeguards/messages');

const DEFAULT_TIMEOUT_MS = 1500;
const RETRY_AFTER_SECONDS = 30;
const UNAVAILABLE_MESSAGE = 'Service temporarily unavailable. Please try again shortly.';

/**
 * Reject with ServiceUnavailableError if `promise` hasn't settled within `ms`,
 * so an unreachable store can't hold a request through the client's retries.
 * The timer is unref'd and cleared on settle, so it never keeps the process alive.
 */
function withTimeout(promise, ms = DEFAULT_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new ServiceUnavailableError('Timed out waiting for the store'));
    }, ms);
    timer.unref();
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Answer 503 when a check can't run. Chat also lists the crisis resources so
 * someone who is struggling during an outage still sees where to get help.
 */
function sendUnavailable(res, { crisisResources = false } = {}) {
  return res
    .status(503)
    .set('Retry-After', String(RETRY_AFTER_SECONDS))
    .json({
      error: UNAVAILABLE_MESSAGE,
      ...(crisisResources && { resources: CRISIS_RESOURCES })
    });
}

module.exports = { withTimeout, sendUnavailable };
