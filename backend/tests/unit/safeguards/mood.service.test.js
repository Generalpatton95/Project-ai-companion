const { MoodService } = require('../../../services/safeguards/mood.service');
const { MemoryStore } = require('../../helpers/memory-store');

describe('MoodService', () => {
  let service;

  beforeEach(() => {
    service = new MoodService({ store: new MemoryStore() });
  });

  test('records a check-in and returns it newest first', async () => {
    await service.recordCheckIn('u1', { phase: 'pre', mood: 'good' });
    await service.recordCheckIn('u1', { phase: 'post', mood: 'low' });

    const history = await service.getHistory('u1');
    expect(history.map((e) => e.mood)).toEqual(['low', 'good']);
  });

  test('rejects unknown moods and phases', async () => {
    await expect(service.recordCheckIn('u1', { phase: 'pre', mood: 'ecstatic' }))
      .rejects.toThrow(/mood must be one of/);
    await expect(service.recordCheckIn('u1', { phase: 'during', mood: 'good' }))
      .rejects.toThrow(/phase must be one of/);
  });

  test('adapts tone to the latest mood', async () => {
    expect((await service.getSummary('u1')).tone).toBe('balanced');

    await service.recordCheckIn('u1', { phase: 'pre', mood: 'low' });
    expect((await service.getSummary('u1')).tone).toBe('encouraging');

    await service.recordCheckIn('u1', { phase: 'post', mood: 'good' });
    expect((await service.getSummary('u1')).tone).toBe('challenging');
  });

  test('suggests support only when recent moods are consistently low', async () => {
    for (const mood of ['low', 'low', 'low', 'okay']) {
      await service.recordCheckIn('u1', { phase: 'pre', mood });
    }
    let summary = await service.getSummary('u1');
    expect(summary.consistentlyLow).toBe(false);
    expect(summary.support).toBeUndefined();

    await service.recordCheckIn('u1', { phase: 'post', mood: 'low' });
    summary = await service.getSummary('u1');
    expect(summary.consistentlyLow).toBe(true);
    expect(summary.support.resources.length).toBeGreaterThan(0);
  });

  test('caps stored history', async () => {
    for (let i = 0; i < 70; i++) {
      await service.recordCheckIn('u1', { phase: 'pre', mood: 'okay' });
    }
    expect(await service.getHistory('u1', 100)).toHaveLength(60);
  });
});
