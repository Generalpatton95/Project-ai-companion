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

  const options = config.redis.url 
    ? config.redis.url 
    : {
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        }
      };

  redisClient = new Redis(options);

  redisClient.on('connect', () => {
    logger.info('Redis connected');
  });

  redisClient.on('error', (err) => {
    logger.error('Redis error', { error: err.message });
  });

  return redisClient;
}

module.exports = createRedisClient();