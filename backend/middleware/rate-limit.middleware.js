// ============================================================================
// FILE: backend/middleware/rate-limit.middleware.js
// Rate Limiting Middleware
// ============================================================================

import redis from '../config/redis.js';
import logger from '../utils/logger.js';

const RATE_LIMITS = {
  query: { max: 50, window: 900000 },     // 50 per 15 min
  analyze: { max: 10, window: 900000 }    // 10 per 15 min
};

function rateLimitMiddleware(type = 'query') {
  return async (req, res, next) => {
    try {
      const userId = req.user.id;
      const limit = RATE_LIMITS[type] || RATE_LIMITS.query;
      const key = `ratelimit:${type}:${userId}`;
      
      // Get current count
      const current = await redis.get(key);
      const count = current ? parseInt(current) : 0;
      
      if (count >= limit.max) {
        logger.warn('Rate limit exceeded', { userId, type });
        return res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil(limit.window / 1000)
        });
      }
      
      // Increment counter
      if (count === 0) {
        await redis.setex(key, Math.ceil(limit.window / 1000), 1);
      } else {
        await redis.incr(key);
      }
      
      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', limit.max);
      res.setHeader('X-RateLimit-Remaining', limit.max - count - 1);
      
      next();
      
    } catch (error) {
      logger.error('Rate limit middleware error', { error: error.message });
      next(); // Don't block on rate limit errors
    }
  };
}

export { rateLimitMiddleware };