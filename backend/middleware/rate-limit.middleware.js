// ============================================================================
// FILE: backend/middleware/rate-limit.middleware.js
// Rate Limiting Middleware
// ============================================================================

const redis = require('../config/redis');
const logger = require('../utils/logger');
const { errorFields } = require('../utils/log-fields');
const { withTimeout, sendUnavailable } = require('../utils/unavailable');
const { ServiceUnavailableError } = require('../utils/errors');
const { CRISIS_RESOURCES } = require('../services/safeguards/messages');

const RATE_LIMITS = {
  query: { max: 50, window: 900000 },     // 50 per 15 min
  analyze: { max: 10, window: 900000 },   // 10 per 15 min
  chat: { max: 30, window: 900000 },      // 30 messages per 15 min
  auth: { max: 10, window: 900000 }       // 10 per 15 min, per IP
};

// Count a request and give the counter an expiry in one atomic step, so a
// count is never left without an expiry and simultaneous requests can't share
// one slot. TTL < 0 means no expiry yet; an existing one is never reset.
// (Works on any Redis version, unlike EXPIRE NX, which needs Redis 7.)
const COUNT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

/**
 * The request's count in the current window. Fails with
 * ServiceUnavailableError if the store doesn't answer within the time limit.
 * If the store answers after that, the count still goes up for a request that
 * was refused; that's harmless (it expires with the window).
 */
function countRequest(store, key, limit) {
  return withTimeout(Promise.resolve(store.eval(COUNT_SCRIPT, 1, key, Math.ceil(limit.window / 1000))))
    .then((count) => {
      // Anything but an integer means the count can't be trusted: fail closed
      // (NaN, for one, would never compare as over the limit)
      if (!Number.isInteger(count)) {
        throw new ServiceUnavailableError('Rate-limit count was not an integer');
      }
      return count;
    });
}

/**
 * Rate limit by signed-in user. If the counter can't be read or updated the
 * request is refused with 503 (fail closed). With crisisResources both the
 * 503 and the 429 also list the crisis resources (used by chat), so nobody is
 * cut off without help.
 */
function rateLimitMiddleware(type = 'query', { store = redis, crisisResources = false } = {}) {
  return async (req, res, next) => {
    const limit = RATE_LIMITS[type] || RATE_LIMITS.query;
    let userId;
    let count;

    try {
      userId = req.user.id;
      count = await countRequest(store, `ratelimit:${type}:${userId}`, limit);
    } catch (error) {
      logger.error('rate_limit_unavailable', errorFields(error));
      return sendUnavailable(res, { crisisResources });
    }

    if (count > limit.max) {
      logger.warn('Rate limit exceeded', { userId, type });
      return res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil(limit.window / 1000),
        ...(crisisResources && { resources: CRISIS_RESOURCES })
      });
    }

    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', limit.max);
    res.setHeader('X-RateLimit-Remaining', limit.max - count);

    return next();
  };
}

/**
 * Rate limit by client IP, for endpoints used before a user is known
 * (login, registration). Set app 'trust proxy' when behind a load balancer.
 * If the counter can't be read or updated the request is refused with 503
 * (fail closed), so an outage can't be used to guess passwords.
 */
function ipRateLimitMiddleware(type = 'auth', { store = redis } = {}) {
  return async (req, res, next) => {
    const limit = RATE_LIMITS[type] || RATE_LIMITS.auth;
    let count;

    try {
      count = await countRequest(store, `ratelimit:${type}:ip:${req.ip}`, limit);
    } catch (error) {
      logger.error('rate_limit_unavailable', errorFields(error));
      return sendUnavailable(res);
    }

    if (count > limit.max) {
      logger.warn('IP rate limit exceeded', { type });
      return res.status(429).json({
        error: 'Too many attempts. Please wait a few minutes and try again.',
        retryAfter: Math.ceil(limit.window / 1000)
      });
    }

    return next();
  };
}

module.exports = { rateLimitMiddleware, ipRateLimitMiddleware, COUNT_SCRIPT };
