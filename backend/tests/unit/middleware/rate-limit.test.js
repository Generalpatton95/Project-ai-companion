const { rateLimitMiddleware, ipRateLimitMiddleware } = require('../../../middleware/rate-limit.middleware');
const logger = require('../../../utils/logger');
const { CRISIS_RESOURCES } = require('../../../services/safeguards/messages');
const { MemoryStore } = require('../../helpers/memory-store');

const UNAVAILABLE = { error: 'Service temporarily unavailable. Please try again shortly.' };
const WINDOW_SECONDS = 900;

function fakeResponse() {
  const res = {
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
  };
  return res;
}

// The limiters only call eval (one atomic script per request); these fakes
// have nothing else, so any other store call would fail the test
function failingStore() {
  const error = new Error('connect ECONNREFUSED 10.0.0.5:6379 secret-detail');
  error.code = 'ECONNREFUSED';
  return { eval: async () => { throw error; } };
}

function hangingStore() {
  return { eval: () => new Promise(() => {}) };
}

// A MemoryStore that only exposes eval, and counts the calls
function countingStore() {
  const memory = new MemoryStore();
  const store = {
    memory,
    calls: 0,
    eval: (...args) => {
      store.calls += 1;
      return memory.eval(...args);
    }
  };
  return store;
}

describe('ipRateLimitMiddleware', () => {
  const ip = '203.0.113.7';
  let errorSpy;
  let warnSpy;

  beforeEach(() => {
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function authRequest() {
    return { ip, body: { email: 'player@example.com', password: 'correct horse' } };
  }

  test('016 R1.1: a failing store gives 503 with Retry-After and the handler is not called', async () => {
    const res = fakeResponse();
    const next = jest.fn();

    await ipRateLimitMiddleware('auth', { store: failingStore() })(authRequest(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('30');
    expect(res.body).toEqual(UNAVAILABLE);
  });

  test('016 R1.2: a hanging store gives 503 within 1.5s', async () => {
    jest.useFakeTimers();
    const res = fakeResponse();
    const next = jest.fn();

    const done = ipRateLimitMiddleware('auth', { store: hangingStore() })(authRequest(), res, next);
    await jest.advanceTimersByTimeAsync(1500);
    await done;

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('30');
  });

  test('016 R1.3, R4.4: the failure log has an event name and error code only (no IP, body or message)', async () => {
    await ipRateLimitMiddleware('auth', { store: failingStore() })(authRequest(), fakeResponse(), jest.fn());

    expect(errorSpy).toHaveBeenCalledWith('rate_limit_unavailable', expect.objectContaining({ errorCode: 'ECONNREFUSED' }));
    const logged = JSON.stringify([...errorSpy.mock.calls, ...warnSpy.mock.calls]);
    expect(logged).not.toContain(ip);
    expect(logged).not.toContain('player@example.com');
    expect(logged).not.toContain('correct horse');
    expect(logged).not.toContain('secret-detail');
    expect(logged).not.toContain('ECONNREFUSED 10.0.0.5');
  });

  test('016 R1.1: the count and its expiry are set in one store call', async () => {
    const store = countingStore();

    await ipRateLimitMiddleware('auth', { store })(authRequest(), fakeResponse(), jest.fn());

    expect(store.calls).toBe(1);
    expect(await store.memory.get(`ratelimit:auth:ip:${ip}`)).toBe('1');
    expect(await store.memory.ttl(`ratelimit:auth:ip:${ip}`)).toBe(WINDOW_SECONDS);
  });

  test('016 R1.1: a working store still counts and limits; the 429 has no resources', async () => {
    const store = countingStore();
    const limiter = ipRateLimitMiddleware('auth', { store });
    const next = jest.fn();

    for (let i = 0; i < 10; i += 1) {
      await limiter(authRequest(), fakeResponse(), next);
    }
    expect(next).toHaveBeenCalledTimes(10);

    const res = fakeResponse();
    await limiter(authRequest(), res, next);
    expect(next).toHaveBeenCalledTimes(10);
    expect(res.statusCode).toBe(429);
    expect(res.body).not.toHaveProperty('resources');
  });
});

describe('rateLimitMiddleware', () => {
  let errorSpy;

  beforeEach(() => {
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function userRequest() {
    return { user: { id: 'u1' }, ip: '203.0.113.7', body: { query: 'how do I stop feeling like this', content: 'private text' } };
  }

  async function fillUp(limiter, times) {
    const next = jest.fn();
    for (let i = 0; i < times; i += 1) {
      await limiter(userRequest(), fakeResponse(), next);
    }
    return next;
  }

  test.each(['query', 'analyze'])('016 R2.1: %s gives a plain 503 when the store fails, and the handler is not called', async (type) => {
    const res = fakeResponse();
    const next = jest.fn();

    await rateLimitMiddleware(type, { store: failingStore() })(userRequest(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('30');
    expect(res.body).toEqual(UNAVAILABLE);
  });

  test('016 R2.2: chat with crisisResources gives 503 + resources matching CRISIS_RESOURCES', async () => {
    const res = fakeResponse();
    const next = jest.fn();

    await rateLimitMiddleware('chat', { store: failingStore(), crisisResources: true })(userRequest(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ ...UNAVAILABLE, resources: CRISIS_RESOURCES });
  });

  test('016 R2.3: a hanging store gives 503 within 1.5s', async () => {
    jest.useFakeTimers();
    const res = fakeResponse();
    const next = jest.fn();

    const done = rateLimitMiddleware('chat', { store: hangingStore(), crisisResources: true })(userRequest(), res, next);
    await jest.advanceTimersByTimeAsync(1500);
    await done;

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body.resources).toEqual(CRISIS_RESOURCES);
  });

  test('016 R2.3: the failure log has an event name and error code only (no ids, body or message)', async () => {
    await rateLimitMiddleware('chat', { store: failingStore() })(userRequest(), fakeResponse(), jest.fn());

    expect(errorSpy).toHaveBeenCalledWith('rate_limit_unavailable', expect.objectContaining({ errorCode: 'ECONNREFUSED' }));
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain('203.0.113.7');
    expect(logged).not.toContain('feeling like this');
    expect(logged).not.toContain('private text');
    expect(logged).not.toContain('secret-detail');
  });

  test('016 R2.1: the count and its expiry are set in one store call', async () => {
    const store = countingStore();

    await rateLimitMiddleware('query', { store })(userRequest(), fakeResponse(), jest.fn());

    expect(store.calls).toBe(1);
    expect(await store.memory.get('ratelimit:query:u1')).toBe('1');
    expect(await store.memory.ttl('ratelimit:query:u1')).toBe(WINDOW_SECONDS);
  });

  test('016 R2.1: a count left without an expiry gets one, and an existing expiry is not reset', async () => {
    const store = countingStore();
    await store.memory.incr('ratelimit:query:u1'); // e.g. left behind by a crash
    expect(await store.memory.ttl('ratelimit:query:u1')).toBe(-1);

    await rateLimitMiddleware('query', { store })(userRequest(), fakeResponse(), jest.fn());
    expect(await store.memory.ttl('ratelimit:query:u1')).toBe(WINDOW_SECONDS);

    await store.memory.expire('ratelimit:query:u1', 42);
    await rateLimitMiddleware('query', { store })(userRequest(), fakeResponse(), jest.fn());
    expect(await store.memory.ttl('ratelimit:query:u1')).toBe(42);
    expect(await store.memory.get('ratelimit:query:u1')).toBe('3');
  });

  test('016 R2.1: two simultaneous first requests count 2', async () => {
    const store = countingStore();
    const limiter = rateLimitMiddleware('analyze', { store });
    const next = jest.fn();

    await Promise.all([
      limiter(userRequest(), fakeResponse(), next),
      limiter(userRequest(), fakeResponse(), next)
    ]);

    expect(next).toHaveBeenCalledTimes(2);
    expect(await store.memory.get('ratelimit:analyze:u1')).toBe('2');
  });

  test('016 R2.1: a working store still counts and limits; the query 429 has no resources', async () => {
    const limiter = rateLimitMiddleware('analyze', { store: countingStore() });
    const next = await fillUp(limiter, 10);
    expect(next).toHaveBeenCalledTimes(10);

    const res = fakeResponse();
    await limiter(userRequest(), res, next);
    expect(next).toHaveBeenCalledTimes(10);
    expect(res.statusCode).toBe(429);
    expect(res.body).not.toHaveProperty('resources');

    const query = rateLimitMiddleware('query', { store: countingStore() });
    await fillUp(query, 50);
    const queryRes = fakeResponse();
    await query(userRequest(), queryRes, jest.fn());
    expect(queryRes.statusCode).toBe(429);
    expect(queryRes.body).not.toHaveProperty('resources');
  });

  test('016 R2.4: the chat 429 carries CRISIS_RESOURCES', async () => {
    const limiter = rateLimitMiddleware('chat', { store: countingStore(), crisisResources: true });
    const next = await fillUp(limiter, 30);
    expect(next).toHaveBeenCalledTimes(30);

    const res = fakeResponse();
    await limiter(userRequest(), res, next);

    expect(next).toHaveBeenCalledTimes(30);
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ error: 'Rate limit exceeded', resources: CRISIS_RESOURCES });
  });

  test('016 R2.1: remaining-count header still counts down', async () => {
    const limiter = rateLimitMiddleware('analyze', { store: countingStore() });
    const first = fakeResponse();
    await limiter(userRequest(), first, jest.fn());
    const second = fakeResponse();
    await limiter(userRequest(), second, jest.fn());

    expect(first.headers['X-RateLimit-Remaining']).toBe(9);
    expect(second.headers['X-RateLimit-Remaining']).toBe(8);
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', '5'],
    ['a fraction', 1.5],
    ['NaN', NaN],
    ['an array', [1]]
  ])('R1.1, R2.1: a count that is %s gives 503 from both limiters', async (label, value) => {
    const store = { eval: async () => value };

    const userRes = fakeResponse();
    const userNext = jest.fn();
    await rateLimitMiddleware('chat', { store, crisisResources: true })(userRequest(), userRes, userNext);
    expect(userNext).not.toHaveBeenCalled();
    expect(userRes.statusCode).toBe(503);
    expect(userRes.body).toEqual({ ...UNAVAILABLE, resources: CRISIS_RESOURCES });

    const ipRes = fakeResponse();
    const ipNext = jest.fn();
    await ipRateLimitMiddleware('auth', { store })({ ip: '203.0.113.7' }, ipRes, ipNext);
    expect(ipNext).not.toHaveBeenCalled();
    expect(ipRes.statusCode).toBe(503);

    expect(errorSpy).toHaveBeenCalledWith('rate_limit_unavailable', expect.objectContaining({ errorName: 'ServiceUnavailableError' }));
  });

  test('016 R2.2, 016 R2.4: the chat route turns on crisisResources', () => {
    jest.isolateModules(() => {
      const limiter = (req, res, next) => next();
      const mockRateLimit = jest.fn(() => limiter);
      jest.doMock('../../../middleware/rate-limit.middleware', () => ({ rateLimitMiddleware: mockRateLimit }));

      const { createChatRouter } = require('../../../routes/chat.routes');
      createChatRouter({ chatService: {} });

      expect(mockRateLimit).toHaveBeenCalledWith('chat', { crisisResources: true });
    });
    jest.dontMock('../../../middleware/rate-limit.middleware');
  });
});
