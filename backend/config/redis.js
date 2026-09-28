// ============================================================================
// FILE: backend/config/redis.js
// Redis Client Configuration
// ============================================================================

import Redis from 'ioredis';
import { loadConfig } from './index.js';
import logger from '../utils/logger.js';

// TODO(redis spec): config.redis now has only `url`; the host/port/password fallback is always undefined.
const config = loadConfig();

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

export default createRedisClient();