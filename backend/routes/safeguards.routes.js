// ============================================================================
// FILE: backend/routes/safeguards.routes.js
// Mood check-ins, play sessions, and usage status
// ============================================================================

const express = require('express');
const { authMiddleware } = require('../middleware/auth.middleware');
const { MoodService, SessionService, UsageService } = require('../services/safeguards');

function createSafeguardsRouter({
  moodService = new MoodService(),
  sessionService = new SessionService(),
  usageService = new UsageService()
} = {}) {
  const router = express.Router();

  router.use(authMiddleware);

  const handle = (fn) => async (req, res, next) => {
    try {
      res.json(await fn(req));
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/safeguards/mood
   * Body: { phase: 'pre' | 'post', mood: 'good' | 'okay' | 'low' }
   */
  router.post('/mood', handle(async (req) => {
    const entry = await moodService.recordCheckIn(req.user.id, req.body || {});
    const summary = await moodService.getSummary(req.user.id);
    return { checkIn: entry, ...summary };
  }));

  /**
   * GET /api/safeguards/mood/summary
   */
  router.get('/mood/summary', handle((req) => moodService.getSummary(req.user.id)));

  /**
   * POST /api/safeguards/session/start
   */
  router.post('/session/start', handle((req) => sessionService.start(req.user.id)));

  /**
   * POST /api/safeguards/session/heartbeat
   * Returns a break/wrap-up reminder when one is due.
   */
  router.post('/session/heartbeat', handle((req) => sessionService.heartbeat(req.user.id)));

  /**
   * POST /api/safeguards/session/snooze
   * Body: { minutes?: number } (5-60, default 30)
   */
  router.post('/session/snooze', handle((req) =>
    sessionService.snooze(req.user.id, req.body && req.body.minutes)
  ));

  /**
   * POST /api/safeguards/session/end
   */
  router.post('/session/end', handle((req) => sessionService.end(req.user.id)));

  /**
   * GET /api/safeguards/usage
   */
  router.get('/usage', handle((req) => usageService.checkAnalysis(req.user)));

  return router;
}

module.exports = { createSafeguardsRouter };
