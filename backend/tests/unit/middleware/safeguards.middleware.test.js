const { EventEmitter } = require('events');
const { usageLimitMiddleware } = require('../../../middleware/safeguards.middleware');
const logger = require('../../../utils/logger');

const UNAVAILABLE = { error: 'Service temporarily unavailable. Please try again shortly.' };

function fakeResponse() {
  const res = new EventEmitter();
  Object.assign(res, {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    set(name, value) {
      res.headers[name] = value;
      return res;
    },
    setHeader(name, value) {
      res.headers[name] = value;
    },
    json(body) {
      res.body = body;
      return res;
    }
  });
  return res;
}

function storeError() {
  const error = new Error('connection to 10.0.0.9 failed for user "player@example.com"');
  error.code = 'ECONNRESET';
  return error;
}

describe('usageLimitMiddleware', () => {
  let errorSpy;
  const request = () => ({ user: { id: 'u1', tier: 'free' }, body: { task_type: 'match_analysis' } });

  beforeEach(() => {
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('R3.1: a rejecting checkAnalysis gives 503 and the analysis is not started', async () => {
    const usageService = { checkAnalysis: async () => { throw storeError(); }, recordAnalysis: jest.fn() };
    const res = fakeResponse();
    const next = jest.fn();

    await usageLimitMiddleware(usageService)(request(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('30');
    expect(res.body).toEqual(UNAVAILABLE);
    expect(errorSpy).toHaveBeenCalledWith('usage_limit_unavailable', { errorName: 'Error', errorCode: 'ECONNRESET' });
  });

  test('R3.1: a hanging checkAnalysis gives 503 within 1.5s and the analysis is not started', async () => {
    jest.useFakeTimers();
    const usageService = { checkAnalysis: () => new Promise(() => {}), recordAnalysis: jest.fn() };
    const res = fakeResponse();
    const next = jest.fn();

    const done = usageLimitMiddleware(usageService)(request(), res, next);
    await jest.advanceTimersByTimeAsync(1500);
    await done;

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
  });

  test('R3.2: a failed record logs the event name and error code only', async () => {
    const usageService = {
      checkAnalysis: async () => ({ allowed: true, count: 0, limit: 3 }),
      recordAnalysis: async () => { throw storeError(); }
    };
    const res = fakeResponse();
    const next = jest.fn();

    await usageLimitMiddleware(usageService)(request(), res, next);
    expect(next).toHaveBeenCalledTimes(1);

    res.statusCode = 202;
    res.emit('finish');
    await new Promise((resolve) => setImmediate(resolve));

    expect(errorSpy).toHaveBeenCalledWith('usage_record_failed', { errorName: 'Error', errorCode: 'ECONNRESET' });
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain('player@example.com');
    expect(logged).not.toContain('10.0.0.9');
  });

  test('R3.1: an allowed analysis still runs and a blocked one still gets 429', async () => {
    const allowed = { checkAnalysis: async () => ({ allowed: true }), recordAnalysis: jest.fn(async () => {}) };
    const next = jest.fn();
    await usageLimitMiddleware(allowed)(request(), fakeResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);

    const blocked = { checkAnalysis: async () => ({ allowed: false, count: 3, limit: 3, hardLimit: true }), recordAnalysis: jest.fn() };
    const res = fakeResponse();
    const blockedNext = jest.fn();
    await usageLimitMiddleware(blocked)(request(), res, blockedNext);
    expect(blockedNext).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
  });
});
