const {
  UsageService,
  FREE_DAILY_LIMIT,
  SOFT_DAILY_LIMIT,
  RESERVE_SCRIPT,
  RELEASE_SCRIPT
} = require('../../../services/safeguards/usage.service');
const { MemoryStore } = require('../../helpers/memory-store');
const { ServiceUnavailableError } = require('../../../utils/errors');
const logger = require('../../../utils/logger');

describe('UsageService', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  let store;
  let service;

  beforeEach(() => {
    store = new MemoryStore();
    service = new UsageService({ store });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Take `count` slots for the user (override, so a paid user isn't stopped
  // at the soft limit)
  async function useAnalyses(user, count, at = now) {
    for (let i = 0; i < count; i++) {
      await service.reserveAnalysis(user, { override: true }, at);
    }
  }

  test('free tier is hard-capped per day', async () => {
    const user = { id: 'u1' };
    await useAnalyses(user, FREE_DAILY_LIMIT - 1);
    expect((await service.checkAnalysis(user, {}, now)).allowed).toBe(true);

    await useAnalyses(user, 1);
    const blocked = await service.checkAnalysis(user, { override: true }, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.hardLimit).toBe(true);
    expect(blocked.message).toBeDefined();
  });

  test('paid tiers get a soft limit that can be overridden', async () => {
    const user = { id: 'u2', tier: 'pro' };
    await useAnalyses(user, SOFT_DAILY_LIMIT);

    const soft = await service.checkAnalysis(user, {}, now);
    expect(soft.allowed).toBe(false);
    expect(soft.hardLimit).toBe(false);

    const overridden = await service.checkAnalysis(user, { override: true }, now);
    expect(overridden.allowed).toBe(true);
    expect(overridden.message).toBeDefined();
  });

  test('counts reset on a new UTC day', async () => {
    const user = { id: 'u1' };
    await useAnalyses(user, FREE_DAILY_LIMIT);
    const tomorrow = new Date('2026-10-19T00:00:01Z');
    expect((await service.checkAnalysis(user, {}, tomorrow)).allowed).toBe(true);
    expect((await service.reserveAnalysis(user, {}, tomorrow)).granted).toBe(true);
  });

  test('R1.7: checkAnalysis only reads the count', async () => {
    const user = { id: 'u1' };
    await useAnalyses(user, 2);

    await service.checkAnalysis(user, {}, now);
    await service.checkAnalysis(user, { override: true }, now);

    expect(await service.getTodayCount('u1', now)).toBe(2);
  });

  test('recordAnalysis is gone: the reservation replaces it', () => {
    expect(service.recordAnalysis).toBeUndefined();
  });

  describe('reserveAnalysis', () => {
    test('R1.1, R1.2: 10 parallel free-tier reservations give exactly 5 grants', async () => {
      const user = { id: 'u1', tier: 'free' };

      const results = await Promise.all(
        Array.from({ length: 10 }, () => service.reserveAnalysis(user, {}, now))
      );

      expect(results.filter((r) => r.granted)).toHaveLength(FREE_DAILY_LIMIT);
      expect(results.filter((r) => !r.granted)).toHaveLength(10 - FREE_DAILY_LIMIT);
      expect(await service.getTodayCount('u1', now)).toBe(FREE_DAILY_LIMIT);
    });

    test('R1.1: a grant carries the count, the limit and a slot; the key gets the 48-hour expiry', async () => {
      const user = { id: 'u1', tier: 'free' };

      const first = await service.reserveAnalysis(user, {}, now);

      expect(first).toMatchObject({ granted: true, count: 1, limit: FREE_DAILY_LIMIT, hardLimit: true });
      expect(first.message).toBeUndefined();
      expect(first.slot.key).toBe('safeguards:usage:analyses:u1:2026-10-18');
      expect(typeof first.slot.release).toBe('function');
      expect(await store.ttl(first.slot.key)).toBe(60 * 60 * 48);
    });

    test('R1.2: a free-tier denial is a hard limit, carries the limit message and changes nothing', async () => {
      const user = { id: 'u1', tier: 'free' };
      await useAnalyses(user, FREE_DAILY_LIMIT);

      const denied = await service.reserveAnalysis(user, { override: true }, now);

      expect(denied).toMatchObject({ granted: false, count: FREE_DAILY_LIMIT, limit: FREE_DAILY_LIMIT, hardLimit: true });
      expect(denied.message).toBeDefined();
      expect(denied.slot).toBeUndefined();
      expect(await service.getTodayCount('u1', now)).toBe(FREE_DAILY_LIMIT);
    });

    test('R1.3: a paid user at 10 without override gets an overridable denial and the count is unchanged', async () => {
      const user = { id: 'u2', tier: 'pro' };
      await useAnalyses(user, SOFT_DAILY_LIMIT);

      const denied = await service.reserveAnalysis(user, {}, now);

      expect(denied).toMatchObject({ granted: false, count: SOFT_DAILY_LIMIT, limit: SOFT_DAILY_LIMIT, hardLimit: false });
      expect(denied.message).toBeDefined();
      expect(denied.slot).toBeUndefined();
      expect(await service.getTodayCount('u2', now)).toBe(SOFT_DAILY_LIMIT);
    });

    test('R1.3: a paid user at 10 with override is granted, with the reminder message, and the count is 11', async () => {
      const user = { id: 'u2', tier: 'pro' };
      await useAnalyses(user, SOFT_DAILY_LIMIT);

      const granted = await service.reserveAnalysis(user, { override: true }, now);

      expect(granted).toMatchObject({ granted: true, count: SOFT_DAILY_LIMIT + 1, limit: SOFT_DAILY_LIMIT, hardLimit: false });
      expect(granted.message).toBeDefined();
      expect(granted.slot).toBeDefined();
      expect(await service.getTodayCount('u2', now)).toBe(SOFT_DAILY_LIMIT + 1);
    });

    test('R1.3: a paid user under the soft limit is granted without the reminder, override or not', async () => {
      const user = { id: 'u2', tier: 'pro' };
      await useAnalyses(user, SOFT_DAILY_LIMIT - 2);

      const plain = await service.reserveAnalysis(user, {}, now);
      const overridden = await service.reserveAnalysis(user, { override: true }, now);

      expect(plain).toMatchObject({ granted: true, count: SOFT_DAILY_LIMIT - 1 });
      expect(plain.message).toBeUndefined();
      expect(overridden).toMatchObject({ granted: true, count: SOFT_DAILY_LIMIT });
      expect(overridden.message).toBeUndefined();
    });

    test('R1.1: the reservation is one script call with the cap and the expiry', async () => {
      const evalSpy = jest.spyOn(store, 'eval');

      await service.reserveAnalysis({ id: 'u1' }, {}, now);
      await service.reserveAnalysis({ id: 'u2', tier: 'pro' }, {}, now);
      await service.reserveAnalysis({ id: 'u3', tier: 'pro' }, { override: true }, now);

      expect(evalSpy.mock.calls).toEqual([
        [RESERVE_SCRIPT, 1, 'safeguards:usage:analyses:u1:2026-10-18', FREE_DAILY_LIMIT, 60 * 60 * 48],
        [RESERVE_SCRIPT, 1, 'safeguards:usage:analyses:u2:2026-10-18', SOFT_DAILY_LIMIT, 60 * 60 * 48],
        [RESERVE_SCRIPT, 1, 'safeguards:usage:analyses:u3:2026-10-18', Number.MAX_SAFE_INTEGER, 60 * 60 * 48]
      ]);
    });

    test.each([
      ['a number', 1],
      ['null', null],
      ['a string', 'OK'],
      ['a one-element array', [1]],
      ['a three-element array', [1, 2, 3]],
      ['non-integers', ['1', '2']],
      ['NaN', [1, NaN]],
      ['a fraction', [1, 1.5]]
    ])('R1.6: a reply that is %s fails closed with ServiceUnavailableError', async (label, reply) => {
      const fake = new UsageService({ store: { eval: async () => reply } });

      await expect(fake.reserveAnalysis({ id: 'u1' }, {}, now)).rejects.toBeInstanceOf(ServiceUnavailableError);
    });

    test('R1.6: a store error is passed on (the middleware answers 503)', async () => {
      const error = new Error('connect ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      const fake = new UsageService({ store: { eval: async () => { throw error; } } });

      await expect(fake.reserveAnalysis({ id: 'u1' }, {}, now)).rejects.toBe(error);
    });
  });

  describe('slot.release', () => {
    test('R1.4: gives one slot back, and later calls do nothing', async () => {
      const user = { id: 'u1' };
      await useAnalyses(user, 2);
      const { slot } = await service.reserveAnalysis(user, {}, now);
      expect(await service.getTodayCount('u1', now)).toBe(3);

      await slot.release();
      await slot.release();
      await slot.release();

      expect(await service.getTodayCount('u1', now)).toBe(2);
    });

    test('R1.4: release runs the release script once on the reservation key', async () => {
      const { slot } = await service.reserveAnalysis({ id: 'u1' }, {}, now);
      const evalSpy = jest.spyOn(store, 'eval');

      await Promise.all([slot.release(), slot.release()]);

      expect(evalSpy.mock.calls).toEqual([[RELEASE_SCRIPT, 1, 'safeguards:usage:analyses:u1:2026-10-18']]);
    });

    test('R1.4: a slot starts unstarted; markStarted() marks it, and release still works after', async () => {
      const { slot } = await service.reserveAnalysis({ id: 'u1' }, {}, now);
      expect(slot.started).toBe(false);

      slot.markStarted();
      expect(slot.started).toBe(true);

      await slot.release();
      expect(await service.getTodayCount('u1', now)).toBe(0);
    });

    test('R1.5: a slot taken at 23:59:59Z and given back after midnight goes back to the earlier day', async () => {
      const user = { id: 'u1' };
      const lastSecond = new Date('2026-10-18T23:59:59Z');
      const afterMidnight = new Date('2026-10-19T00:00:01Z');

      const { slot } = await service.reserveAnalysis(user, {}, lastSecond);
      await service.reserveAnalysis(user, {}, afterMidnight);

      await slot.release();

      expect(await service.getTodayCount('u1', lastSecond)).toBe(0);
      expect(await service.getTodayCount('u1', afterMidnight)).toBe(1);
    });

    test('R1.5: giving a slot back never takes the count below 0', async () => {
      const { slot } = await service.reserveAnalysis({ id: 'u1' }, {}, now);
      // The count went away (e.g. it expired, or Redis was flushed)
      await store.del(slot.key);

      await slot.release();

      expect(await service.getTodayCount('u1', now)).toBe(0);
      expect(await store.get(slot.key)).toBeNull();
    });

    test('R1.6: a failed release logs the event name and error code only, never throws, and the slot stays used', async () => {
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
      const { slot } = await service.reserveAnalysis({ id: 'u1' }, {}, now);
      const error = new Error('connection to 10.0.0.9 failed for user "player@example.com"');
      error.code = 'ECONNRESET';
      const evalSpy = jest.spyOn(store, 'eval').mockImplementation(async () => { throw error; });

      await expect(slot.release()).resolves.toBeUndefined();
      await slot.release();

      expect(evalSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith('usage_release_failed', { errorName: 'Error', errorCode: 'ECONNRESET' });
      const logged = JSON.stringify(errorSpy.mock.calls);
      expect(logged).not.toContain('player@example.com');
      expect(logged).not.toContain('10.0.0.9');
      evalSpy.mockRestore();
      expect(await service.getTodayCount('u1', now)).toBe(1);
    });

    test('R1.6: a store that throws synchronously still never throws from release', async () => {
      jest.spyOn(logger, 'error').mockImplementation(() => logger);
      const { slot } = await service.reserveAnalysis({ id: 'u1' }, {}, now);
      jest.spyOn(store, 'eval').mockImplementation(() => { throw new TypeError('boom'); });

      expect(() => slot.release()).not.toThrow();
      await expect(slot.release()).resolves.toBeUndefined();
    });
  });
});
