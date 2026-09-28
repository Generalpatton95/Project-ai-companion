// ============================================================================
// FILE: backend/routes/agent.routes.js
// Agent API Routes
// ============================================================================

import express from 'express';
import { AgentController } from '../controllers/agent.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { rateLimitMiddleware } from '../middleware/rate-limit.middleware.js';

const router = express.Router();
const agentController = new AgentController();

// All agent routes require authentication
router.use(authMiddleware);

/**
 * POST /api/agent/query
 * Fast query endpoint for simple questions
 */
router.post('/query', rateLimitMiddleware('query'), async (req, res, next) => {
  try {
    const result = await agentController.handleQuery(req.body, req.user);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/agent/analyze
 * Deep analysis endpoint for complex tasks
 */
router.post('/analyze', rateLimitMiddleware('analyze'), async (req, res, next) => {
  try {
    const result = await agentController.handleAnalysis(req.body, req.user);
    res.json(result);
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

export default router;
