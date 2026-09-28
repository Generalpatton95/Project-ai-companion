import { describe, test, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createApp } from '../../app.js';
import { loadConfig } from '../../config/index.js';
import { ValidationError, UnauthorizedError } from '../../utils/errors.js';
import { capturingLogger } from '../helpers.js';

/** Routes that exist only in tests, to exercise the error handler. */
function testRoutes() {
  const router = express.Router();
  router.get('/boom/validation', () => { throw new ValidationError('Name is required'); });
  router.get('/boom/unauthorized', () => { throw new UnauthorizedError(); });
  router.get('/boom/sync', () => { throw new Error('db password is hunter2'); });
  router.get('/boom/async', async () => {
    await Promise.resolve();
    throw new Error('async internal detail');
  });
  router.post('/echo', (req, res) => res.json(req.body));
  return router;
}

function makeApp(env = {}) {
  const { logger, lines } = capturingLogger({ LOG_LEVEL: 'error' });
  const config = loadConfig({ NODE_ENV: 'test', CORS_ORIGINS: 'http://localhost:5173', ...env });
  const app = createApp(config, { logger, routes: [testRoutes()] });
  return { app, lines };
}

describe('built-in routes', () => {
  test('R2.1: GET /health returns status, service, timestamp and uptime', async () => {
    const res = await request(makeApp().app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'healthy',
      service: 'AI Gaming Companion',
      timestamp: expect.any(String),
      uptime: expect.any(Number),
    });
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  test('R2.2: GET /api/v1/status returns version and status', async () => {
    const res = await request(makeApp().app).get('/api/v1/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: 'v1', status: 'operational' });
  });
});

describe('client errors', () => {
  test('R2.3: unknown routes return 404 NOT_FOUND JSON', async () => {
    const res = await request(makeApp().app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });

  test('R2.4: malformed JSON returns 400 INVALID_JSON', async () => {
    const res = await request(makeApp().app)
      .post('/echo').set('Content-Type', 'application/json').send('{"bad json');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'INVALID_JSON', message: expect.any(String) } });
  });

  test('R2.6: bodies over the limit return 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(makeApp({ JSON_BODY_LIMIT: '1kb' }).app)
      .post('/echo').send({ data: 'x'.repeat(2048) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: { code: 'PAYLOAD_TOO_LARGE', message: expect.any(String) } });
  });

  test('R2.6: bodies under the limit are accepted', async () => {
    const res = await request(makeApp().app).post('/echo').send({ hello: 'world' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hello: 'world' });
  });
});

describe('CORS', () => {
  test('R2.5: allowed origins get CORS headers', async () => {
    const res = await request(makeApp().app).get('/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  test('R2.5: other origins get no CORS headers', async () => {
    const res = await request(makeApp().app).get('/health').set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('R2.5: requests without an Origin header are allowed', async () => {
    const res = await request(makeApp().app).get('/health');
    expect(res.status).toBe(200);
  });
});

describe('error handler', () => {
  test('R3.1, R3.2: typed errors use their status, code and message', async () => {
    const { app } = makeApp();
    const validation = await request(app).get('/boom/validation');
    expect(validation.status).toBe(400);
    expect(validation.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Name is required' } });

    const unauthorized = await request(app).get('/boom/unauthorized');
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.body.error.code).toBe('UNAUTHORIZED');
  });

  test.each(['development', 'production', 'test'])(
    'R3.3: unexpected errors return a generic 500 with no internals (NODE_ENV=%s)',
    async (NODE_ENV) => {
      const res = await request(makeApp({ NODE_ENV }).app).get('/boom/sync');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
      expect(res.text).not.toContain('hunter2');
      expect(res.text).not.toMatch(/at .*\.js/);
    },
  );

  test('R3.4: 5xx errors are logged with stack, method and path', async () => {
    const { app, lines } = makeApp();
    await request(app).get('/boom/sync');
    const entry = lines.find((l) => l.level === 'error');
    expect(entry).toMatchObject({ method: 'GET', path: '/boom/sync' });
    expect(entry.stack).toContain('hunter2');
  });

  test('R3.4: 4xx errors are not logged as errors', async () => {
    const { app, lines } = makeApp();
    await request(app).get('/boom/validation');
    expect(lines.filter((l) => l.level === 'error')).toHaveLength(0);
  });

  test('R3.5: errors from async handlers reach the error handler', async () => {
    const res = await request(makeApp().app).get('/boom/async');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.text).not.toContain('async internal detail');
  });
});
