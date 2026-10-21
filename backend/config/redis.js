// ============================================================================
// FILE: backend/config/redis.js
// Redis Client Configuration
// ============================================================================

const Redis = require('ioredis');
const config = require('./index');
const logger = require('../utils/logger');
const { errorFields } = require('../utils/log-fields');
const { SOCKET_CODES } = require('../utils/store-errors');

// lazyConnect defers the TCP connection until the first command, so merely
// requiring this module (e.g. from tests that inject their own store) does
// not open a socket that keeps the process alive. maxRetriesPerRequest: 1
// drops queued commands quickly while Redis is down, so the checks that
// depend on it fail closed instead of waiting. commandTimeout and
// connectTimeout bound each command and connection attempt; the app-level
// withTimeout (utils/unavailable.js) stays as the backstop. Exported so the
// real-Redis integration test builds its client the same way.
const REDIS_OPTIONS = {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  commandTimeout: 1500,
  connectTimeout: 2000,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
};

let redisClient;

// Each client's outage record ({ startedAt, failedAttempts } or null) and
// whether its startup connect is running; see attachLogging
const logState = new WeakMap();

// Connection failures (Node socket codes; ioredis's connect timeout is
// ETIMEDOUT too), as opposed to errors while connected
function isConnectionError(err) {
  return Boolean(err) && SOCKET_CODES.has(err.code);
}

/**
 * Log Redis outages once, with recovery, instead of an error line on every
 * reconnect attempt:
 * - the first connection failure logs redis_unavailable; later ones in the
 *   same outage are only counted
 * - `ready` after an outage logs redis_recovered with its length in whole
 *   seconds and the number of failed attempts
 * - any other error is logged as redis_error
 * During the startup connect, connectRedis logs the failure itself
 * (redis_connect_failed), so a connection failure then opens the outage
 * without logging. `now` is injectable for tests.
 */
function attachLogging(client, { now = Date.now } = {}) {
  const state = { outage: null, starting: false, now };
  logState.set(client, state);

  client.on('error', (err) => {
    if (!isConnectionError(err)) {
      logger.error('redis_error', errorFields(err));
      return;
    }
    if (state.outage) {
      state.outage.failedAttempts += 1;
      return;
    }
    state.outage = { startedAt: now(), failedAttempts: 1 };
    if (!state.starting) {
      logger.error('redis_unavailable', errorFields(err));
    }
  });

  client.on('ready', () => {
    if (!state.outage) {
      return;
    }
    const { startedAt, failedAttempts } = state.outage;
    state.outage = null;
    logger.info('redis_recovered', {
      outageSeconds: Math.round((now() - startedAt) / 1000),
      failedAttempts
    });
  });

  return client;
}

function createRedisClient() {
  if (redisClient) {
    return redisClient;
  }

  redisClient = config.redis.url
    ? new Redis(config.redis.url, { ...REDIS_OPTIONS })
    : new Redis({
        ...REDIS_OPTIONS,
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password
      });

  return attachLogging(redisClient);
}

/**
 * Connect at startup so a Redis problem shows up in the log straight away.
 * Never throws: the server still starts, and the rate and usage checks fail
 * closed until Redis recovers. A failed startup connect is the start of an
 * outage, so the eventual `ready` logs redis_recovered.
 */
async function connectRedis(client = redisClient) {
  const state = logState.get(client);
  if (state) {
    state.starting = true;
  }
  try {
    await client.connect();
    logger.info('redis_connected');
  } catch (error) {
    logger.error('redis_connect_failed', errorFields(error));
    if (state && !state.outage) {
      state.outage = { startedAt: state.now(), failedAttempts: 1 };
    }
  } finally {
    if (state) {
      state.starting = false;
    }
  }
}

module.exports = createRedisClient();
module.exports.connectRedis = connectRedis;
module.exports.attachLogging = attachLogging;
module.exports.REDIS_OPTIONS = REDIS_OPTIONS;
