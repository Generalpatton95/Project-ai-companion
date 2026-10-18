// ============================================================================
// FILE: backend/middleware/rate-limit.middleware.js
// Rate Limiting Middleware
// ============================================================================

const redis = require('../config/redis');
const config = require('../config');
const logger = require('../utils/logger');

const RATE_LIMITS = {
  query: { max: 50, window: 900000 },     // 50 per 15 min
  analyze: { max: 10, window: 900000 },   // 10 per 15 min
  auth: { max: 10, window: 900000 }       // 10 per 15 min, per IP
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

/**
 * Rate limit by client IP, for endpoints used before a user is known
 * (login, registration). Set app 'trust proxy' when behind a load balancer.
 */
function ipRateLimitMiddleware(type = 'auth') {
  return async (req, res, next) => {
    try {
      const limit = RATE_LIMITS[type] || RATE_LIMITS.auth;
      const key = `ratelimit:${type}:ip:${req.ip}`;

      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, Math.ceil(limit.window / 1000));
      }

      if (count > limit.max) {
        logger.warn('IP rate limit exceeded', { type });
        return res.status(429).json({
          error: 'Too many attempts. Please wait a few minutes and try again.',
          retryAfter: Math.ceil(limit.window / 1000)
        });
      }

      next();

    } catch (error) {
      logger.error('IP rate limit middleware error', { error: error.message });
      next(); // Don't block on rate limit errors
    }
  };
}

module.exports = { rateLimitMiddleware, ipRateLimitMiddleware };