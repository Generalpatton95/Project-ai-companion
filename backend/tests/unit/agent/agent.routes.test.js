process.env.JWT_SECRET = 'test-secret';

// The rate limiter is covered in tests/unit/middleware; with no Redis here it
// would answer 503, so it is passed through for these route tests
jest.mock('../../../middleware/rate-limit.middleware', () => ({
  rateLimitMiddleware: () => (req, res, next) => next()
}));
// The real Riot client starts an interval timer when constructed, which would
// keep Jest running; these routes never call it
jest.mock('../../../integrations/riot-games', () => ({
  RiotGamesClient: class {}
}));
// The real usage middleware, on an in-memory store instead of Redis, so the
// tests can see slots taken and given back
jest.mock('../../../middleware/safeguards.middleware', () => {
  const actual = jest.requireActual('../../../middleware/safeguards.middleware');
  const { UsageService } = jest.requireActual('../../../services/safeguards');
  const { MemoryStore } = jest.requireActual('../../helpers/memory-store');
  const usageService = new UsageService({ store: new MemoryStore() });
  // The last request and response through it, so a test can watch them
  const last = {};
  const usageLimitMiddleware = () => {
    const middleware = actual.usageLimitMiddleware(usageService);
    return (req, res, next) => {
      Object.assign(last, { req, res });
      return middleware(req, res, next);
    };
  };
  return { ...actual, usageLimitMiddleware, mockUsageService: usageService, mockLast: last };
});

const express = require('express');
const jwt = require('jsonwebtoken');
const agentRoutes = require('../../../routes/agent.routes');
const { errorMiddleware } = require('../../../middleware/error.middleware');
const { AgentController } = require('../../../controllers/agent.controller');
const { mockUsageService: usageService, mockLast: last } = require('../../../middleware/safeguards.middleware');
const logger = require('../../../utils/logger');

describe('agent routes', () => {
  let server;
  let baseUrl;
  const token = jwt.sign({ id: 'u1', tier: 'free' }, 'test-secret');

  async function call(path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }

  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/agent', agentRoutes);
    app.use(errorMiddleware);
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    usageService.store.data.clear();
    return new Promise((resolve) => server.close(resolve));
  });

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  describe('GET /api/agent/task/:taskId when Redis is unavailable (R2.8)', () => {
    const { StateManager } = require('../../../agent/state-manager');
    const { MaxRetriesPerRequestError } = require('ioredis/built/errors');

    async function get(path) {
      const response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      return { status: response.status, retryAfter: response.headers.get('retry-after'), body: await response.json() };
    }

    test.each([
      ['MaxRetriesPerRequestError', () => new MaxRetriesPerRequestError(1)],
      ['Connection is closed.', () => new Error('Connection is closed.')],
      ['Command timed out', () => new Error('Command timed out')]
    ])('R2.8: an ioredis %s (no code) gives 503, not 500', async (label, makeError) => {
      jest.spyOn(logger, 'error').mockImplementation(() => logger);
      jest.spyOn(StateManager.prototype, 'getTask').mockRejectedValue(makeError());

      const result = await get('/api/agent/task/task_1');

      expect(result.status).toBe(503);
      expect(result.retryAfter).toBe('30');
      expect(result.body).toEqual({ error: 'Service temporarily unavailable. Please try again shortly.' });
      expect(logger.error).toHaveBeenCalledWith('store_unavailable', expect.objectContaining({ method: 'GET', path: '/api/agent/task/task_1' }));
    });
  });

  describe('POST /api/agent/analyze usage slots', () => {
    test('R1.4 (D4): a client that disconnects while startTask is pending keeps the slot', async () => {
      let reached;
      const pending = new Promise((resolve) => { reached = resolve; });
      let finishStart;
      jest.spyOn(AgentController.prototype, 'handleAnalysis').mockImplementation(() => {
        reached();
        return new Promise((resolve) => { finishStart = resolve; });
      });
      const controller = new AbortController();

      const request = fetch(`${baseUrl}/api/agent/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ task_type: 'match_analysis' }),
        signal: controller.signal
      }).catch((e) => e);
      await pending;
      expect(last.req.usageSlot.started).toBe(true);
      const closed = new Promise((resolve) => last.res.once('close', resolve));

      controller.abort();
      await request;
      await closed;
      await settle();

      expect(await usageService.getTodayCount('u1')).toBe(1);
      finishStart({ taskId: 'task_1', status: 'running', statusUrl: '/api/agent/task/task_1' });
    });

    test('R1.8: onFailed uses the slot captured when the analysis started, not req', async () => {
      let onFailed;
      jest.spyOn(AgentController.prototype, 'handleAnalysis').mockImplementation(async (body, user, options) => {
        ({ onFailed } = options);
        return { taskId: 'task_1', status: 'running', statusUrl: '/api/agent/task/task_1' };
      });

      expect((await call('/api/agent/analyze', { task_type: 'match_analysis' })).status).toBe(202);
      last.req.usageSlot = undefined;
      onFailed();
      await settle();

      expect(await usageService.getTodayCount('u1')).toBe(0);
    });

    test('R1.4: a handleAnalysis that throws after the slot was marked started still gives it back (the response is 500)', async () => {
      jest.spyOn(logger, 'error').mockImplementation(() => logger);
      jest.spyOn(AgentController.prototype, 'handleAnalysis').mockRejectedValue(new Error('state store broke'));

      const result = await call('/api/agent/analyze', { task_type: 'match_analysis' });
      await settle();

      expect(result.status).toBe(500);
      expect(await usageService.getTodayCount('u1')).toBe(0);
    });

    test('R1.8: the route passes onFailed, which gives the slot back once', async () => {
      let onFailed;
      jest.spyOn(AgentController.prototype, 'handleAnalysis').mockImplementation(async (body, user, options) => {
        ({ onFailed } = options);
        return { taskId: 'task_1', status: 'running', statusUrl: '/api/agent/task/task_1' };
      });

      const result = await call('/api/agent/analyze', { task_type: 'match_analysis' });
      expect(result.status).toBe(202);
      expect(await usageService.getTodayCount('u1')).toBe(1);

      // The background analysis fails later, maybe more than once over
      onFailed();
      onFailed();
      await settle();

      expect(await usageService.getTodayCount('u1')).toBe(0);
    });

    test('R1.8: an accepted analysis that does not fail keeps its slot', async () => {
      jest.spyOn(AgentController.prototype, 'handleAnalysis').mockImplementation(async () => (
        { taskId: 'task_1', status: 'running', statusUrl: '/api/agent/task/task_1' }
      ));

      expect((await call('/api/agent/analyze', { task_type: 'match_analysis' })).status).toBe(202);
      await settle();

      expect(await usageService.getTodayCount('u1')).toBe(1);
    });

    test('R1.4: an unknown task_type gives 400, and the slot is given back', async () => {
      const result = await call('/api/agent/analyze', { task_type: 'nope' });
      await settle();

      expect(result.status).toBe(400);
      expect(await usageService.getTodayCount('u1')).toBe(0);
    });
  });

  test('R5.1: POST /api/agent/query without a query gives 400', async () => {
    const result = await call('/api/agent/query', {});

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'query is required' });
  });

  test('R4.1: a query is answered and its text is not logged', async () => {
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);

    const result = await call('/api/agent/query', { query: 'best jungle route for Lee Sin' });

    expect(result.status).toBe(200);
    expect(infoSpy).toHaveBeenCalledWith('Handling query', { userId: 'u1', queryLength: 29 });
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain('Lee Sin');
  });
});
