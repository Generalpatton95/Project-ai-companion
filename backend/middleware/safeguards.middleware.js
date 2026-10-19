// ============================================================================
// FILE: backend/middleware/safeguards.middleware.js
// Safeguard checks applied in front of agent endpoints
// ============================================================================

const { detectCrisis, buildSafeguardResponse, UsageService } = require('../services/safeguards');
const logger = require('../utils/logger');

/**
 * Screen a free-text body field for crisis/distress language before it
 * reaches the agent. Message text is never logged.
 */
function crisisCheckMiddleware(field = 'query') {
  return (req, res, next) => {
    const { level } = detectCrisis(req.body && req.body[field]);

    if (level === 'none') {
      return next();
    }

    logger.warn('Safeguard triggered', { userId: req.user && req.user.id, level });
    return res.json(buildSafeguardResponse(level));
  };
}

/**
 * Enforce daily analysis limits. An analysis is only counted once the
 * request completes successfully.
 */
function usageLimitMiddleware(usageService = new UsageService()) {
  return async (req, res, next) => {
    try {
      const override = Boolean(req.body && req.body.override);
      const usage = await usageService.checkAnalysis(req.user, { override });

      if (!usage.allowed) {
        return res.status(429).json({
          error: 'Daily analysis limit reached',
          safeguard: 'usage_limit',
          message: usage.message,
          count: usage.count,
          limit: usage.limit,
          overridable: !usage.hardLimit
        });
      }

      if (usage.message) {
        res.setHeader('X-Safeguard-Usage-Reminder', 'soft-limit');
      }

      res.on('finish', () => {
        if (res.statusCode < 400) {
          usageService.recordAnalysis(req.user.id).catch((error) => {
            logger.error('Failed to record analysis usage', { error: error.message });
          });
        }
      });

      next();
    } catch (error) {
      logger.error('Usage limit middleware error', { error: error.message });
      next(); // Don't block analysis if usage tracking is unavailable
    }
  };
}

module.exports = { crisisCheckMiddleware, usageLimitMiddleware };
