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
 * Enforce daily analysis limits. A slot is taken, in one atomic step, before
 * the analysis starts, so simultaneous requests can't all get through. If the
 * request then fails (status 400 or above) or the client goes away before the
 * analysis starts, the slot is given back (once: release() ignores repeats).
 * The slot is on req.usageSlot so a background analysis that fails later can
 * give it back too. If a slot can't be taken the analysis is refused with 503
 * (fail closed), so the limit always applies.
 */
function usageLimitMiddleware(usageService = new UsageService()) {
  return async (req, res, next) => {
    let usage;
    try {
      const override = Boolean(req.body && req.body.override);
      usage = await withTimeout(usageService.reserveAnalysis(req.user, { override }));
    } catch (error) {
      logger.error('usage_limit_unavailable', errorFields(error));
      return sendUnavailable(res);
    }

    if (!usage.granted) {
      return res.status(429).json({
        error: 'Daily analysis limit reached',
        safeguard: 'usage_limit',
        message: usage.message,
        count: usage.count,
        limit: usage.limit,
        overridable: !usage.hardLimit
      });
    }

    const { slot } = usage;
    req.usageSlot = slot;

    if (usage.message) {
      res.setHeader('X-Safeguard-Usage-Reminder', 'soft-limit');
    }

    res.on('finish', () => {
      if (res.statusCode >= 400) {
        slot.release();
      }
    });
    // A disconnect before the analysis starts gives the slot back; once it
    // has started (slot.markStarted(), in the route) only a failure does
    res.on('close', () => {
      if (!res.writableFinished && !slot.started) {
        slot.release();
      }
    });

    return next();
  };
}

module.exports = { crisisCheckMiddleware, usageLimitMiddleware };
