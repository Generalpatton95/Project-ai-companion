// ============================================================================
// FILE: backend/middleware/request-log.middleware.js
// Request logging
// ============================================================================

const logger = require('../utils/logger');

/**
 * Log each request's method and path only. No IPs, query strings, headers or
 * body fields: those can identify a player or carry what they typed.
 */
function requestLogMiddleware(req, res, next) {
  logger.info('Request', {
    method: req.method,
    path: req.path
  });
  next();
}

module.exports = { requestLogMiddleware };
