// ============================================================================
// FILE: backend/routes/agent.routes.js
// Agent API Routes
// ============================================================================

const express = require('express');
const { AgentController } = require('../controllers/agent.controller');
const { authMiddleware } = require('../middleware/auth.middleware');
const { rateLimitMiddleware } = require('../middleware/rate-limit.middleware');
const { crisisCheckMiddleware, usageLimitMiddleware } = require('../middleware/safeguards.middleware');

const router = express.Router();
const agentController = new AgentController();

// All agent routes require authentication
router.use(authMiddleware);

/**
 * POST /api/agent/query
 * Fast query endpoint for simple questions
 */
router.post('/query', crisisCheckMiddleware('query'), rateLimitMiddleware('query'), async (req, res, next) => {
  try {
    const result = await agentController.handleQuery(req.body, req.user);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/agent/analyze
 * Starts a deep analysis in the background and returns 202 with a taskId.
 * Poll GET /api/agent/task/:taskId until status is 'completed' or 'failed'.
 * An analysis that fails later gives its daily usage slot back.
 */
router.post('/analyze', rateLimitMiddleware('analyze'), usageLimitMiddleware(), async (req, res, next) => {
  // Captured so the background task holds the slot, not the whole request
  const slot = req.usageSlot;
  try {
    // From here a disconnect leaves the slot used; a failure still gives it back
    if (slot) {
      slot.markStarted();
    }
    const result = await agentController.handleAnalysis(req.body, req.user, {
      onFailed: () => slot && slot.release()
    });
    res.status(202).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/agent/task/:taskId
 * Get task status and results
 */
router.get('/task/:taskId', async (req, res, next) => {
  try {
    const result = await agentController.getTaskStatus(req.params.taskId, req.user);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
