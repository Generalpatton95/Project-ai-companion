// ============================================================================
// FILE: backend/routes/chat.routes.js
// Chat with the companion
// ============================================================================

const express = require('express');
const { ChatService } = require('../services/chat/chat.service');
const { authMiddleware } = require('../middleware/auth.middleware');
const { rateLimitMiddleware } = require('../middleware/rate-limit.middleware');

function createChatRouter({
  chatService = new ChatService(),
  rateLimit = rateLimitMiddleware('chat')
} = {}) {
  const router = express.Router();

  router.use(authMiddleware);

  const handle = (fn, status = 200) => async (req, res, next) => {
    try {
      res.status(status).json(await fn(req));
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/chat/conversations
   */
  router.get('/conversations', handle(async (req) => ({
    conversations: await chatService.listConversations(req.user)
  })));

  /**
   * POST /api/chat/conversations
   * Body: { personality?: 'coach' | 'friend' | 'analyst' }
   */
  router.post('/conversations', handle(async (req) => ({
    conversation: await chatService.createConversation(req.user, req.body || {})
  }), 201));

  /**
   * GET /api/chat/conversations/:id
   */
  router.get('/conversations/:id', handle((req) =>
    chatService.getConversation(req.user, req.params.id)
  ));

  /**
   * PATCH /api/chat/conversations/:id
   * Body: { personality }
   */
  router.patch('/conversations/:id', handle(async (req) => ({
    conversation: await chatService.setPersonality(req.user, req.params.id, (req.body || {}).personality)
  })));

  /**
   * POST /api/chat/conversations/:id/messages
   * Body: { content }
   */
  router.post('/conversations/:id/messages', rateLimit, handle((req) =>
    chatService.sendMessage(req.user, req.params.id, (req.body || {}).content)
  ));

  return router;
}

module.exports = { createChatRouter };
