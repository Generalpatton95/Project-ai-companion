// ============================================================================
// FILE: backend/routes/chat.routes.js
// Chat with the companion
// ============================================================================

const express = require('express');
const { ChatService, ChatAbortedError } = require('../services/chat/chat.service');
const logger = require('../utils/logger');
const { errorFields } = require('../utils/log-fields');
const { authMiddleware } = require('../middleware/auth.middleware');
const { rateLimitMiddleware } = require('../middleware/rate-limit.middleware');

function createChatRouter({
  chatService = new ChatService(),
  // The 503 (outage) and the 429 (over the limit) also list the crisis resources
  rateLimit = rateLimitMiddleware('chat', { crisisResources: true })
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
   *
   * With `Accept: text/event-stream` the reply streams as server-sent events:
   *   delta  { text }                                  - reply text as it arrives
   *   done   { messages, safeguard, conversation }      - the saved turn
   *   error  { error, status }                         - failure after streaming began
   * Otherwise the response is the `done` payload as JSON.
   */
  router.post('/conversations/:id/messages', rateLimit, async (req, res, next) => {
    const content = (req.body || {}).content;
    const wantsStream = (req.get('accept') || '').includes('text/event-stream');

    if (!wantsStream) {
      try {
        return res.json(await chatService.sendMessage(req.user, req.params.id, content));
      } catch (error) {
        return next(error);
      }
    }

    const controller = new AbortController();
    let started = false;
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const start = () => {
      if (!started) {
        started = true;
        res.status(200).set({
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive'
        });
        res.flushHeaders();
      }
    };

    // Stop the Claude request if the browser goes away mid-reply
    res.on('close', () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    });

    try {
      const result = await chatService.sendMessage(req.user, req.params.id, content, {
        signal: controller.signal,
        onText: (text) => {
          start();
          send('delta', { text });
        }
      });
      start();
      send('done', result);
      res.end();
    } catch (error) {
      if (error instanceof ChatAbortedError) {
        logger.info('Chat stream closed by client', { userId: req.user.id });
        return undefined;
      }
      if (!started) {
        // Nothing streamed yet: a normal JSON error with its status code
        return next(error);
      }
      logger.error('Chat stream failed', errorFields(error));
      send('error', {
        error: error.statusCode ? error.message : 'Something went wrong. Please try again.',
        status: error.statusCode || 500
      });
      res.end();
    }
    return undefined;
  });

  return router;
}

module.exports = { createChatRouter };
