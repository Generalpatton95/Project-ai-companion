const { EventEmitter } = require('events');
const { usageLimitMiddleware } = require('../../../middleware/safeguards.middleware');
const { UsageService } = require('../../../services/safeguards');
const { MemoryStore } = require('../../helpers/memory-store');
const logger = require('../../../utils/logger');

const UNAVAILABLE = { error: 'Service temporarily unavailable. Please try again shortly.' };

function fakeResponse() {
  const res = new EventEmitter();
  Object.assign(res, {
    statusCode: 200,
    headers: {},
    body: undefined,
    writableFinished: false,
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

// What Node does when a response has been sent: 'finish', then 'close'
function finish(res, status) {
  res.statusCode = status;
  res.writableFinished = true;
  res.emit('finish');
  res.emit('close');
}

function storeError() {
  const error = new Error('connection to 10.0.0.9 failed for user "player@example.com"');
  error.code = 'ECONNRESET';
  return error;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

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

  test('R1.6, 016 R3.1: a rejecting reservation gives 503 and the analysis is not started', async () => {
    const usageService = { reserveAnalysis: async () => { throw storeError(); } };
    const res = fakeResponse();
    const next = jest.fn();

    await usageLimitMiddleware(usageService)(request(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('30');
    expect(res.body).toEqual(UNAVAILABLE);
    expect(errorSpy).toHaveBeenCalledWith('usage_limit_unavailable', { errorName: 'Error', errorCode: 'ECONNRESET' });
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain('player@example.com');
    expect(logged).not.toContain('10.0.0.9');
  });

  test('R1.6, 016 R3.1: a hanging reservation gives 503 within 1.5s and the analysis is not started', async () => {
    jest.useFakeTimers();
    const usageService = { reserveAnalysis: () => new Promise(() => {}) };
    const res = fakeResponse();
    const next = jest.fn();

    const done = usageLimitMiddleware(usageService)(request(), res, next);
    await jest.advanceTimersByTimeAsync(1500);
    await done;

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('30');
  });

  test('R1.6: a reservation reply that is not an integer pair gives 503', async () => {
    const usageService = new UsageService({ store: { eval: async () => 'OK' } });
    const res = fakeResponse();
    const next = jest.fn();

    await usageLimitMiddleware(usageService)(request(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(errorSpy).toHaveBeenCalledWith('usage_limit_unavailable', { errorName: 'ServiceUnavailableError', status: 503 });
  });

  test('R1.2: a refused reservation gives the same 429 as before and takes no slot', async () => {
    const usageService = new UsageService({ store: new MemoryStore() });
    for (let i = 0; i < 5; i++) {
      await usageService.reserveAnalysis({ id: 'u1', tier: 'free' });
    }
    const res = fakeResponse();
    const next = jest.fn();

    await usageLimitMiddleware(usageService)(request(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({
      error: 'Daily analysis limit reached',
      safeguard: 'usage_limit',
      message: expect.any(String),
      count: 5,
      limit: 5,
      overridable: false
    });
    expect(await usageService.getTodayCount('u1')).toBe(5);
  });

  test('R1.3: a paid user at the soft limit gets an overridable 429; with override the slot is taken and the header set', async () => {
    const usageService = new UsageService({ store: new MemoryStore() });
    const paid = { id: 'u2', tier: 'pro' };
    for (let i = 0; i < 10; i++) {
      await usageService.reserveAnalysis(paid);
    }

    const denied = fakeResponse();
    const deniedNext = jest.fn();
    await usageLimitMiddleware(usageService)({ user: paid, body: {} }, denied, deniedNext);
    expect(deniedNext).not.toHaveBeenCalled();
    expect(denied.statusCode).toBe(429);
    expect(denied.body.overridable).toBe(true);
    expect(denied.headers['X-Safeguard-Usage-Reminder']).toBeUndefined();
    expect(await usageService.getTodayCount('u2')).toBe(10);

    const overridden = fakeResponse();
    const next = jest.fn();
    const req = { user: paid, body: { override: true } };
    await usageLimitMiddleware(usageService)(req, overridden, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(overridden.headers['X-Safeguard-Usage-Reminder']).toBe('soft-limit');
    expect(req.usageSlot).toBeDefined();
    expect(await usageService.getTodayCount('u2')).toBe(11);
  });

  test('R1.3: a paid user under the soft limit gets no reminder header', async () => {
    const usageService = new UsageService({ store: new MemoryStore() });
    const res = fakeResponse();

    await usageLimitMiddleware(usageService)({ user: { id: 'u2', tier: 'pro' }, body: {} }, res, jest.fn());

    expect(res.headers['X-Safeguard-Usage-Reminder']).toBeUndefined();
  });

  describe('giving the slot back', () => {
    let usageService;

    beforeEach(() => {
      usageService = new UsageService({ store: new MemoryStore() });
    });

    async function admit() {
      const req = request();
      const res = fakeResponse();
      const next = jest.fn();
      await usageLimitMiddleware(usageService)(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(await usageService.getTodayCount('u1')).toBe(1);
      return { req, res };
    }

    test('R1.1: an admitted request has its slot taken before the handler runs', async () => {
      const { req } = await admit();
      expect(req.usageSlot.key).toMatch(/^safeguards:usage:analyses:u1:\d{4}-\d{2}-\d{2}$/);
    });

    test.each([400, 404, 500, 503])('R1.4: a response that ends with %i gives the slot back', async (status) => {
      const { res } = await admit();

      finish(res, status);
      await settle();

      expect(await usageService.getTodayCount('u1')).toBe(0);
    });

    test('R1.4: a 202 keeps the slot', async () => {
      const { res } = await admit();

      finish(res, 202);
      await settle();

      expect(await usageService.getTodayCount('u1')).toBe(1);
    });

    test('R1.4: a client that disconnects before the response is sent gives the slot back', async () => {
      const { res } = await admit();

      res.emit('close');
      await settle();

      expect(await usageService.getTodayCount('u1')).toBe(0);
    });

    test('R1.4 (D4): a disconnect after the analysis has started keeps the slot', async () => {
      const { req, res } = await admit();

      req.usageSlot.markStarted();
      res.emit('close');
      await settle();

      expect(await usageService.getTodayCount('u1')).toBe(1);
    });

    test('R1.4: a response of 400 or above after the analysis was marked started still gives the slot back', async () => {
      const { req, res } = await admit();

      req.usageSlot.markStarted();
      finish(res, 500);
      await settle();

      expect(await usageService.getTodayCount('u1')).toBe(0);
    });

    test('R1.4: finish with 500 and then close give the slot back only once', async () => {
      // Another analysis keeps the count above 0, so a second release would show
      await usageService.reserveAnalysis({ id: 'u1', tier: 'free' });
      const res = fakeResponse();
      await usageLimitMiddleware(usageService)(request(), res, jest.fn());
      expect(await usageService.getTodayCount('u1')).toBe(2);

      res.statusCode = 500;
      res.emit('finish');
      // Both listeners can fire: here 'close' also sees the response as unfinished
      res.emit('close');
      await settle();

      expect(await usageService.getTodayCount('u1')).toBe(1);
    });

    test('R1.4: a slot given back by the middleware and again by a failed analysis goes back once', async () => {
      await usageService.reserveAnalysis({ id: 'u1', tier: 'free' });
      const req = request();
      const res = fakeResponse();
      await usageLimitMiddleware(usageService)(req, res, jest.fn());

      res.emit('close');
      await req.usageSlot.release();
      await settle();

      expect(await usageService.getTodayCount('u1')).toBe(1);
    });

    test('R1.6: a failed release logs the event name and error code only', async () => {
      const store = {
        eval: jest.fn()
          .mockResolvedValueOnce([1, 1])
          .mockRejectedValueOnce(storeError())
      };
      const res = fakeResponse();
      await usageLimitMiddleware(new UsageService({ store }))(request(), res, jest.fn());

      finish(res, 500);
      await settle();

      expect(store.eval).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledWith('usage_release_failed', { errorName: 'Error', errorCode: 'ECONNRESET' });
      const logged = JSON.stringify(errorSpy.mock.calls);
      expect(logged).not.toContain('player@example.com');
      expect(logged).not.toContain('10.0.0.9');
    });
  });
});
