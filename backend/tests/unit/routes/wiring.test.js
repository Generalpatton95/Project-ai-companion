// The real auth and agent routes, with only the Redis client replaced:
// proves the routes use the fail-closed limiters and usage check by default.

process.env.JWT_SECRET = 'test-secret';

// The real Riot client starts an interval timer when constructed (agent
// routes build one); these requests never reach it
jest.mock('../../../integrations/riot-games', () => ({
  RiotGamesClient: class {}
}));

const jwt = require('jsonwebtoken');
const { COUNT_SCRIPT } = require('../../../middleware/rate-limit.middleware');

const UNAVAILABLE = 'Service temporarily unavailable. Please try again shortly.';

function storeError() {
  const error = new Error('connect ECONNREFUSED 10.0.0.5:6379');
  error.code = 'ECONNREFUSED';
  return error;
}

// Redis down: every command fails
const downStore = () => ({
  eval: async () => { throw storeError(); },
  get: async () => { throw storeError(); },
  setex: async () => { throw storeError(); },
  incr: async () => { throw storeError(); },
  expire: async () => { throw storeError(); }
});

// The rate-limit count works, but a usage slot can't be taken
const usageDownStore = () => ({
  ...downStore(),
  eval: async (script) => {
    if (script === COUNT_SCRIPT) return 1;
    throw storeError();
  }
});

describe('route wiring', () => {
  let server;
  let baseUrl;
  let authService;
  let logger; // the routes' own logger (isolateModules gives them a fresh one)
  const token = jwt.sign({ id: 'u1', tier: 'free' }, 'test-secret');

  async function start(store) {
    let app;
    jest.isolateModules(() => {
      jest.doMock('../../../config/redis', () => store);
      const express = require('express');
      const { createAuthRouter } = require('../../../routes/auth.routes');
      const agentRoutes = require('../../../routes/agent.routes');
      const { errorMiddleware } = require('../../../middleware/error.middleware');
      logger = require('../../../utils/logger');
      for (const level of ['error', 'warn', 'info']) {
        jest.spyOn(logger, level).mockImplementation(() => logger);
      }

      app = express();
      app.use(express.json());
      // Only the auth service is replaced; the rate limit is the route's default
      app.use('/api/auth', createAuthRouter({ authService }));
      app.use('/api/agent', agentRoutes);
      app.use(errorMiddleware);
    });
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }

  async function post(path, body, auth) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = `Bearer ${auth}`;
    const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: response.status, retryAfter: response.headers.get('retry-after'), body: await response.json() };
  }

  beforeEach(() => {
    authService = { login: jest.fn(async () => ({ token: 't' })), register: jest.fn(async () => ({ token: 't' })) };
  });

  afterEach(async () => {
    jest.dontMock('../../../config/redis');
    jest.restoreAllMocks();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
  });

  test.each(['/api/auth/login', '/api/auth/register'])('016 R1.1: %s uses the IP limiter by default, so Redis down gives 503', async (path) => {
    await start(downStore());

    const result = await post(path, { email: 'player@example.com', password: 'correct horse', ageConfirmed: true });

    expect(result.status).toBe(503);
    expect(result.retryAfter).toBe('30');
    expect(result.body).toEqual({ error: UNAVAILABLE });
    expect(authService.login).not.toHaveBeenCalled();
    expect(authService.register).not.toHaveBeenCalled();
  });

  test('016 R2.1: /api/agent/query uses the query limiter by default, so Redis down gives 503', async () => {
    await start(downStore());

    const result = await post('/api/agent/query', { query: 'best jungle route?' }, token);

    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: UNAVAILABLE });
  });

  test('016 R2.1: /api/agent/analyze uses the analyze limiter by default, so Redis down gives 503', async () => {
    await start(downStore());

    const result = await post('/api/agent/analyze', { task_type: 'match_analysis' }, token);

    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: UNAVAILABLE });
    expect(logger.error).toHaveBeenCalledWith('rate_limit_unavailable', expect.any(Object));
  });

  test('016 R3.1: /api/agent/analyze uses the daily usage check by default, so a usage outage gives 503', async () => {
    await start(usageDownStore());

    const result = await post('/api/agent/analyze', { task_type: 'match_analysis' }, token);

    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: UNAVAILABLE });
    expect(logger.error).toHaveBeenCalledWith('usage_limit_unavailable', expect.any(Object));
    expect(logger.error).not.toHaveBeenCalledWith('rate_limit_unavailable', expect.any(Object));
  });
});
