// ============================================================================
// FILE: backend/routes/auth.routes.js
// Account registration, login, and current user
// ============================================================================

const express = require('express');
const { AuthService } = require('../services/auth.service');
const { authMiddleware } = require('../middleware/auth.middleware');
const { ipRateLimitMiddleware } = require('../middleware/rate-limit.middleware');

function createAuthRouter({
  authService = new AuthService(),
  rateLimit = ipRateLimitMiddleware('auth')
} = {}) {
  const router = express.Router();

  /**
   * POST /api/auth/register
   * Body: { email, password, displayName?, ageConfirmed: true }
   */
  router.post('/register', rateLimit, async (req, res, next) => {
    try {
      res.status(201).json(await authService.register(req.body));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/auth/login
   * Body: { email, password }
   */
  router.post('/login', rateLimit, async (req, res, next) => {
    try {
      res.json(await authService.login(req.body));
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/auth/me
   */
  router.get('/me', authMiddleware, async (req, res, next) => {
    try {
      res.json({ user: await authService.getCurrentUser(req.user.id) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createAuthRouter };
