// ============================================================================
// FILE: backend/config/redis.js
// Redis Client Configuration
// ============================================================================

const Redis = require('ioredis');
const config = require('./index');
const logger = require('../utils/logger');

let redisClient;

function createRedisClient() {
  if (redisClient) {
    return redisClient;
  }

  // lazyConnect defers the TCP connection until the first command, so merely
  // requiring this module (e.g. from tests that inject their own store) does
  // not open a socket that keeps the process alive.
  const options = {
    lazyConnect: true,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    }
  };

  redisClient = config.redis.url
    ? new Redis(config.redis.url, options)
    : new Redis({
        ...options,
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password
      });

  redisClient.on('connect', () => {
    logger.info('Redis connected');
  });

  redisClient.on('error', (err) => {
    logger.error('Redis error', { error: err.message });
  });

  return redisClient;
}

module.exports = createRedisClient();