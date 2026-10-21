// ============================================================================
// FILE: backend/utils/store-errors.js
// Recognise "the store is unavailable" errors (Postgres, Redis, the network)
// so the error handlers can answer 503 instead of 500
// ============================================================================

// Node socket errors (also used by config/redis.js for outage logging)
const SOCKET_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'EPIPE',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTDOWN',
  'ECONNABORTED'
]);

// Postgres SQLSTATE codes: query_canceled (raised by statement_timeout),
// admin_shutdown, crash_shutdown, cannot_connect_now, too_many_connections.
// Any 08xxx (connection exception) is matched as a class below.
const POSTGRES_CODES = new Set(['57014', '57P01', '57P02', '57P03', '53300']);

// pg's and ioredis's own timeout and connection errors carry no code, only
// these fixed messages (pg 8.23.1, pg-pool 3.14.0, ioredis 5.8.2; see
// tests/unit/utils/store-errors.test.js for where each comes from). The
// message is only compared, never logged or returned.
const FIXED_MESSAGES = new Set([
  // pg-pool
  'timeout exceeded when trying to connect',
  'Connection terminated due to connection timeout',
  // pg
  'Connection terminated unexpectedly',
  'Query read timeout',
  'timeout expired',
  'Client has encountered a connection error and is not queryable',
  'Client was closed and is not queryable',
  // ioredis
  'Connection is closed.',
  'Command timed out'
]);

// ioredis error classes with no code: a command dropped after
// maxRetriesPerRequest while Redis is down
const ERROR_NAMES = new Set(['MaxRetriesPerRequestError']);

/**
 * True when `err` means a store (Postgres, Redis) couldn't be reached or
 * didn't answer in time, rather than a fault in the request or the code.
 * The app's own ServiceUnavailableError is not one: it carries its own
 * message (chat's Claude failure), handled where it's thrown.
 */
function isStoreUnavailable(err) {
  if (!err || typeof err !== 'object') {
    return false;
  }

  const { code } = err;
  if (typeof code === 'string') {
    return SOCKET_CODES.has(code) || POSTGRES_CODES.has(code) || /^08[0-9A-Z]{3}$/.test(code);
  }

  return code === undefined && (ERROR_NAMES.has(err.name) || FIXED_MESSAGES.has(err.message));
}

module.exports = { isStoreUnavailable, SOCKET_CODES };
