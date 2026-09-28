import { describe, test, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequestLogger } from '../../middleware/request-logger.js';
import { capturingLogger } from '../helpers.js';

describe('logger', () => {
  test('R4.1: supports error, warn, info and debug levels', () => {
    const { logger, lines } = capturingLogger({ LOG_LEVEL: 'debug' });
    logger.error('e');
    logger.warn('w');
    logger.info('i');
    logger.debug('d');
    expect(lines.map((l) => l.level)).toEqual(['error', 'warn', 'info', 'debug']);
  });

  test('R4.4: under NODE_ENV=test, output below error is suppressed', () => {
    const { logger, lines } = capturingLogger({ NODE_ENV: 'test' });
    logger.warn('w');
    logger.info('i');
    logger.error('e');
    expect(lines.map((l) => l.level)).toEqual(['error']);
  });
});

describe('request logger', () => {
  function appWith(logger) {
    const app = express();
    app.use(createRequestLogger(logger));
    app.use(express.json());
    app.post('/things', (req, res) => res.status(201).json({ ok: true }));
    return app;
  }

  test('R4.2: logs method, path, status and duration for each request', async () => {
    const { logger, lines } = capturingLogger();
    await request(appWith(logger)).post('/things').send({});
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'info', method: 'POST', path: '/things', status: 201 });
    expect(typeof lines[0].durationMs).toBe('number');
  });

  test('R4.3: never logs request bodies, auth headers or query strings', async () => {
    const { logger, lines } = capturingLogger();
    await request(appWith(logger))
      .post('/things?email=player@example.com')
      .set('Authorization', 'Bearer top-secret-token')
      .send({ password: 'hunter2' });
    const output = JSON.stringify(lines);
    expect(output).not.toContain('top-secret-token');
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('player@example.com');
    expect(lines[0].path).toBe('/things');
  });
});
