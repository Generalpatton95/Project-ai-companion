// Real Redis: the limiters' count script and the client's fail-fast settings.
// Runs only when REDIS_URL is set (CI starts a Redis service); skipped otherwise.

const Redis = require('ioredis');
const { REDIS_OPTIONS } = require('../../../config/redis');
const { COUNT_SCRIPT, ipRateLimitMiddleware, rateLimitMiddleware } = require('../../../middleware/rate-limit.middleware');
const logger = require('../../../utils/logger');

const describeWithRedis = process.env.REDIS_URL ? describe : describe.skip;
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

// Close a client whether or not it ever connected, so Jest can exit. ioredis
// keeps a commandTimeout timer for each command for up to 1.5s, even after a
// command fails early (e.g. connection refused), so wait those out too.
async function close(client) {
  await client.quit().catch(() => {});
  client.disconnect();
  await new Promise((resolve) => setTimeout(resolve, REDIS_OPTIONS.commandTimeout + 100));
}

describeWithRedis('rate-limit count script (real Redis)', () => {
  const prefix = `test:016:${process.pid}:${Date.now()}:`;
  let client;

  beforeAll(() => {
    // Built the same way as config/redis.js builds the app's client
    client = new Redis(process.env.REDIS_URL, REDIS_OPTIONS);
  });

  afterAll(async () => {
    const keys = await client.keys(`${prefix}*`).catch(() => []);
    if (keys.length) {
      await client.del(...keys).catch(() => {});
    }
    await close(client);
  });

  test('R1.1, R2.1: counts 1, 2, 3', async () => {
    const key = `${prefix}counts`;

    expect(await client.eval(COUNT_SCRIPT, 1, key, WINDOW_SECONDS)).toBe(1);
    expect(await client.eval(COUNT_SCRIPT, 1, key, WINDOW_SECONDS)).toBe(2);
    expect(await client.eval(COUNT_SCRIPT, 1, key, WINDOW_SECONDS)).toBe(3);
  });

  test('R1.1, R2.1: the expiry is set on the first count and not reset by later ones', async () => {
    const key = `${prefix}expiry`;

    await client.eval(COUNT_SCRIPT, 1, key, WINDOW_SECONDS);
    const ttl = await client.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(WINDOW_SECONDS);

    await client.expire(key, 42);
    await client.eval(COUNT_SCRIPT, 1, key, WINDOW_SECONDS);
    const later = await client.ttl(key);
    expect(later).toBeGreaterThan(0);
    expect(later).toBeLessThanOrEqual(42);
  });

  test('R1.1, R2.1: a count left without an expiry gets one', async () => {
    const key = `${prefix}no-expiry`;
    await client.set(key, 5);
    expect(await client.ttl(key)).toBe(-1);

    expect(await client.eval(COUNT_SCRIPT, 1, key, WINDOW_SECONDS)).toBe(6);
    const ttl = await client.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(WINDOW_SECONDS);
  });

  test('R2.1: the user limiter counts through the real client', async () => {
    const userId = `${prefix}user`;
    const next = jest.fn();
    const res = fakeResponse();

    await rateLimitMiddleware('query', { store: client })({ user: { id: userId } }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headers['X-RateLimit-Remaining']).toBe(49);
    expect(await client.ttl(`ratelimit:query:${userId}`)).toBeGreaterThan(0);
    await client.del(`ratelimit:query:${userId}`);
  });
});

describeWithRedis('unreachable Redis (real client)', () => {
  let client;

  beforeAll(() => {
    // Nothing listens on port 1
    client = new Redis('redis://127.0.0.1:1', REDIS_OPTIONS);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await close(client);
  });

  test('R1.2: the IP limiter answers 503 within 1.5s', async () => {
    const res = fakeResponse();
    const next = jest.fn();
    const started = Date.now();

    await ipRateLimitMiddleware('auth', { store: client })({ ip: '203.0.113.7' }, res, next);
    const elapsed = Date.now() - started;

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('30');
    // 1.5s limit plus a little scheduling slack
    expect(elapsed).toBeLessThanOrEqual(1600);
  });
});
