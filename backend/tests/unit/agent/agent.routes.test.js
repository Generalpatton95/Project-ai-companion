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

const express = require('express');
const jwt = require('jsonwebtoken');
const agentRoutes = require('../../../routes/agent.routes');
const { errorMiddleware } = require('../../../middleware/error.middleware');
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
    return new Promise((resolve) => server.close(resolve));
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
