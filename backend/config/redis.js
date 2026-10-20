// ============================================================================
// FILE: backend/config/redis.js
// Redis Client Configuration
// ============================================================================

const Redis = require('ioredis');
const config = require('./index');
const logger = require('../utils/logger');
const { errorFields } = require('../utils/log-fields');

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

  redisClient.on('error', (err) => {
    logger.error('Redis error', errorFields(err));
  });

  return redisClient;
}

/**
 * Connect at startup so a Redis problem shows up in the log straight away.
 * Never throws: the server still starts, and the rate and usage checks fail
 * closed until Redis recovers.
 */
async function connectRedis(client = redisClient) {
  try {
    await client.connect();
    logger.info('redis_connected');
  } catch (error) {
    logger.error('redis_connect_failed', errorFields(error));
  }
}

module.exports = createRedisClient();
module.exports.connectRedis = connectRedis;
module.exports.REDIS_OPTIONS = REDIS_OPTIONS;
