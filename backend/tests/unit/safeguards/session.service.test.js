const { SessionService } = require('../../../services/safeguards/session.service');
const { MemoryStore } = require('../../helpers/memory-store');

describe('SessionService', () => {
  const start = new Date('2026-10-18T12:00:00Z');
  const minutesLater = (minutes) => new Date(start.getTime() + minutes * 60000);
  let service;

  beforeEach(async () => {
    service = new SessionService({ store: new MemoryStore() });
    await service.start('u1', start);
  });

  test('no reminder early in a session', async () => {
    const status = await service.heartbeat('u1', minutesLater(90));
    expect(status.active).toBe(true);
    expect(status.reminder).toBeNull();
  });

  test('break reminder after 2 hours, wrap-up after 4', async () => {
    expect((await service.heartbeat('u1', minutesLater(120))).reminder.level).toBe('break');
    expect((await service.heartbeat('u1', minutesLater(240))).reminder.level).toBe('wrap_up');
  });

  test('snooze hides reminders, then they come back', async () => {
    await service.snooze('u1', 30, minutesLater(125));
    expect((await service.heartbeat('u1', minutesLater(150))).reminder).toBeNull();
    expect((await service.heartbeat('u1', minutesLater(156))).reminder.level).toBe('break');
  });

  test('snooze length is clamped', async () => {
    const status = await service.snooze('u1', 600, minutesLater(125));
    expect(new Date(status.snoozedUntil)).toEqual(minutesLater(185));
  });

  test('ending a session reports its length and clears it', async () => {
    const ended = await service.end('u1', minutesLater(75));
    expect(ended.elapsedMinutes).toBe(75);
    expect((await service.heartbeat('u1', minutesLater(80))).active).toBe(false);
  });

  test('heartbeat without a session is inactive', async () => {
    expect(await service.heartbeat('nobody', start)).toEqual({ active: false });
  });
});
