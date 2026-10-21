// Real Redis: the usage service's reserve and release scripts, and the usage
// middleware under simultaneous requests (spec 017, NFR2).
// Runs only when REDIS_URL is set (CI starts a Redis service); skipped otherwise.

const { EventEmitter } = require('events');
const Redis = require('ioredis');
const { REDIS_OPTIONS } = require('../../../config/redis');
const { UsageService, FREE_DAILY_LIMIT, RELEASE_SCRIPT } = require('../../../services/safeguards/usage.service');
const { usageLimitMiddleware } = require('../../../middleware/safeguards.middleware');

const describeWithRedis = process.env.REDIS_URL ? describe : describe.skip;

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

// Close the client so Jest can exit. ioredis keeps a commandTimeout timer for
// each command for up to 1.5s, so wait those out too.
async function close(client) {
  await client.quit().catch(() => {});
  client.disconnect();
  await new Promise((resolve) => setTimeout(resolve, REDIS_OPTIONS.commandTimeout + 100));
}

describeWithRedis('usage slots (real Redis)', () => {
  // User ids are unique to this run, so the day keys never collide
  const prefix = `test017:${process.pid}:${Date.now()}:`;
  // One time for the whole file, so every key is the same day's
  const now = new Date();
  let client;
  let service;

  beforeAll(() => {
    // Built the same way as config/redis.js builds the app's client
    client = new Redis(process.env.REDIS_URL, REDIS_OPTIONS);
    service = new UsageService({ store: client });
  });

  afterAll(async () => {
    const keys = await client.keys(`safeguards:usage:analyses:${prefix}*`).catch(() => []);
    if (keys.length) {
      await client.del(...keys).catch(() => {});
    }
    await close(client);
  });

  test('R1.1, R1.2: 10 parallel free-tier reservations give exactly 5 grants', async () => {
    const user = { id: `${prefix}parallel`, tier: 'free' };

    const results = await Promise.all(Array.from({ length: 10 }, () => service.reserveAnalysis(user, {}, now)));

    expect(results.filter((r) => r.granted)).toHaveLength(FREE_DAILY_LIMIT);
    expect(results.filter((r) => !r.granted)).toHaveLength(10 - FREE_DAILY_LIMIT);
    expect(await service.getTodayCount(user.id, now)).toBe(FREE_DAILY_LIMIT);
    // The day key has the 48-hour expiry
    const ttl = await client.ttl(service.key(user.id, now));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60 * 60 * 48);
  });

  test('R1.2: 10 simultaneous requests through the middleware give 5 passes and 5 × 429', async () => {
    const user = { id: `${prefix}middleware`, tier: 'free' };
    // The middleware doesn't pass a time, so pin the same `now` as the rest of
    // the file (a run across midnight UTC would otherwise read the wrong day)
    const middleware = usageLimitMiddleware({
      reserveAnalysis: (who, options) => service.reserveAnalysis(who, options, now)
    });
    const next = jest.fn();
    const responses = Array.from({ length: 10 }, fakeResponse);

    await Promise.all(responses.map((res) => middleware({ user, body: {} }, res, next)));

    expect(next).toHaveBeenCalledTimes(5);
    expect(responses.filter((res) => res.statusCode === 429)).toHaveLength(5);
    expect(await service.getTodayCount(user.id, now)).toBe(5);
  });

  test('R1.3: a paid user at the soft limit is refused without override and granted with it', async () => {
    const user = { id: `${prefix}paid`, tier: 'pro' };
    for (let i = 0; i < 10; i++) {
      expect((await service.reserveAnalysis(user, {}, now)).granted).toBe(true);
    }

    const denied = await service.reserveAnalysis(user, {}, now);
    expect(denied).toMatchObject({ granted: false, count: 10, hardLimit: false });
    expect(await service.getTodayCount(user.id, now)).toBe(10);

    const overridden = await service.reserveAnalysis(user, { override: true }, now);
    expect(overridden).toMatchObject({ granted: true, count: 11 });
    expect(overridden.message).toBeDefined();
  });

  test('R1.4, R1.5: release decrements once, and stays at 0 at 0', async () => {
    const user = { id: `${prefix}release`, tier: 'free' };
    const first = await service.reserveAnalysis(user, {}, now);
    const second = await service.reserveAnalysis(user, {}, now);
    expect(await service.getTodayCount(user.id, now)).toBe(2);

    await first.slot.release();
    await first.slot.release();
    expect(await service.getTodayCount(user.id, now)).toBe(1);

    // At 0, giving a slot back keeps it at 0
    await client.set(second.slot.key, 0);
    await second.slot.release();
    expect(await client.get(second.slot.key)).toBe('0');

    // With no count at all, it isn't created
    await client.del(second.slot.key);
    expect(await client.eval(RELEASE_SCRIPT, 1, second.slot.key)).toBe(0);
    expect(await client.get(second.slot.key)).toBeNull();
  });
});
