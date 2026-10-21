// ============================================================================
// FILE: backend/middleware/safeguards.middleware.js
// Safeguard checks applied in front of agent endpoints
// ============================================================================

const { detectCrisis, buildSafeguardResponse, UsageService } = require('../services/safeguards');
const logger = require('../utils/logger');
const { errorFields } = require('../utils/log-fields');
const { withTimeout, sendUnavailable } = require('../utils/unavailable');

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
 * request completes successfully. If usage can't be checked the analysis is
 * refused with 503 (fail closed), so the limit always applies.
 */
function usageLimitMiddleware(usageService = new UsageService()) {
  return async (req, res, next) => {
    let usage;
    try {
      const override = Boolean(req.body && req.body.override);
      usage = await withTimeout(usageService.checkAnalysis(req.user, { override }));
    } catch (error) {
      logger.error('usage_limit_unavailable', errorFields(error));
      return sendUnavailable(res);
    }

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
          logger.error('usage_record_failed', errorFields(error));
        });
      }
    });

    return next();
  };
}

module.exports = { crisisCheckMiddleware, usageLimitMiddleware };
