const {
  UsageService,
  FREE_DAILY_LIMIT,
  SOFT_DAILY_LIMIT
} = require('../../../services/safeguards/usage.service');
const { MemoryStore } = require('../../helpers/memory-store');

describe('UsageService', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  let service;

  beforeEach(() => {
    service = new UsageService({ store: new MemoryStore() });
  });

  async function useAnalyses(userId, count, at = now) {
    for (let i = 0; i < count; i++) {
      await service.recordAnalysis(userId, at);
    }
  }

  test('free tier is hard-capped per day', async () => {
    const user = { id: 'u1' };
    await useAnalyses('u1', FREE_DAILY_LIMIT - 1);
    expect((await service.checkAnalysis(user, {}, now)).allowed).toBe(true);

    await useAnalyses('u1', 1);
    const blocked = await service.checkAnalysis(user, { override: true }, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.hardLimit).toBe(true);
    expect(blocked.message).toBeDefined();
  });

  test('paid tiers get a soft limit that can be overridden', async () => {
    const user = { id: 'u2', tier: 'pro' };
    await useAnalyses('u2', SOFT_DAILY_LIMIT);

    const soft = await service.checkAnalysis(user, {}, now);
    expect(soft.allowed).toBe(false);
    expect(soft.hardLimit).toBe(false);

    const overridden = await service.checkAnalysis(user, { override: true }, now);
    expect(overridden.allowed).toBe(true);
    expect(overridden.message).toBeDefined();
  });

  test('counts reset on a new UTC day', async () => {
    const user = { id: 'u1' };
    await useAnalyses('u1', FREE_DAILY_LIMIT);
    const tomorrow = new Date('2026-10-19T00:00:01Z');
    expect((await service.checkAnalysis(user, {}, tomorrow)).allowed).toBe(true);
  });
});
