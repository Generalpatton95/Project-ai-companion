process.env.JWT_SECRET = 'test-secret';

const express = require('express');
const jwt = require('jsonwebtoken');
const { createSafeguardsRouter } = require('../../../routes/safeguards.routes');
const {
  crisisCheckMiddleware,
  usageLimitMiddleware
} = require('../../../middleware/safeguards.middleware');
const { errorMiddleware } = require('../../../middleware/error.middleware');
const { MoodService, SessionService, UsageService } = require('../../../services/safeguards');
const { MemoryStore } = require('../../helpers/memory-store');

describe('safeguard routes and middleware', () => {
  let server;
  let baseUrl;
  let usageService;
  let agentCalls;

  const token = jwt.sign({ id: 'u1', tier: 'free' }, 'test-secret');

  async function call(method, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body && JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }

  beforeEach(async () => {
    const store = new MemoryStore();
    usageService = new UsageService({ store });
    agentCalls = 0;

    const app = express();
    app.use(express.json());
    app.use('/api/safeguards', createSafeguardsRouter({
      moodService: new MoodService({ store }),
      sessionService: new SessionService({ store }),
      usageService
    }));
    app.post('/agent/query', crisisCheckMiddleware('query'), (req, res) => {
      agentCalls += 1;
      res.json({ answer: 'agent answer' });
    });
    app.post(
      '/agent/analyze',
      (req, res, next) => { req.user = { id: 'u1', tier: 'free' }; next(); },
      usageLimitMiddleware(usageService),
      (req, res) => { agentCalls += 1; res.json({ ok: true }); }
    );
    app.use(errorMiddleware);

    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(() => new Promise((resolve) => server.close(resolve)));

  test('requires authentication', async () => {
    const response = await fetch(`${baseUrl}/api/safeguards/usage`);
    expect(response.status).toBe(401);
  });

  test('mood check-in returns a summary', async () => {
    const { status, body } = await call('POST', '/api/safeguards/mood', { phase: 'pre', mood: 'low' });
    expect(status).toBe(200);
    expect(body.checkIn.mood).toBe('low');
    expect(body.tone).toBe('encouraging');
  });

  test('invalid mood is a 400', async () => {
    const { status } = await call('POST', '/api/safeguards/mood', { phase: 'pre', mood: 'meh' });
    expect(status).toBe(400);
  });

  test('session lifecycle', async () => {
    expect((await call('POST', '/api/safeguards/session/start')).body.active).toBe(true);
    expect((await call('POST', '/api/safeguards/session/heartbeat')).body.reminder).toBeNull();
    expect((await call('POST', '/api/safeguards/session/end')).body.active).toBe(false);
  });

  test('crisis message never reaches the agent', async () => {
    const { body } = await call('POST', '/agent/query', { query: 'I want to die' });
    expect(body.safeguard).toBe('crisis');
    expect(body.conversationEnded).toBe(true);
    expect(agentCalls).toBe(0);
  });

  test('ordinary query passes through', async () => {
    const { body } = await call('POST', '/agent/query', { query: 'best build for Jinx?' });
    expect(body.answer).toBe('agent answer');
    expect(agentCalls).toBe(1);
  });

  test('free tier is blocked after the daily limit', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await call('POST', '/agent/analyze', {})).status).toBe(200);
    }
    // Usage is recorded on response finish; let those writes settle
    await new Promise((resolve) => setImmediate(resolve));

    const blocked = await call('POST', '/agent/analyze', {});
    expect(blocked.status).toBe(429);
    expect(blocked.body.safeguard).toBe('usage_limit');
    expect(blocked.body.overridable).toBe(false);
    expect(agentCalls).toBe(5);
  });
});
