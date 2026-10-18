// ============================================================================
// FILE: backend/services/safeguards/session.service.js
// Play-session tracking and healthy gaming reminders (Safeguard 1)
//
// The client starts a session, sends heartbeats while the user plays, and
// shows whatever reminder comes back. Snoozing hides reminders for a while,
// then they return.
// ============================================================================

const { BREAK_REMINDER, WRAP_UP_REMINDER } = require('./messages');

const BREAK_AFTER_MINUTES = 120;
const WRAP_UP_AFTER_MINUTES = 240;
const DEFAULT_SNOOZE_MINUTES = 30;
const MIN_SNOOZE_MINUTES = 5;
const MAX_SNOOZE_MINUTES = 60;
const SESSION_TTL_SECONDS = 60 * 60 * 24;

class SessionService {
  constructor({ store } = {}) {
    this.store = store || require('../../config/redis');
  }

  key(userId) {
    return `safeguards:session:${userId}`;
  }

  async getSession(userId) {
    const data = await this.store.get(this.key(userId));
    return data ? JSON.parse(data) : null;
  }

  async saveSession(userId, session) {
    await this.store.setex(this.key(userId), SESSION_TTL_SECONDS, JSON.stringify(session));
  }

  async start(userId, now = new Date()) {
    const session = { startedAt: now.toISOString(), snoozedUntil: null };
    await this.saveSession(userId, session);
    return this.status(session, now);
  }

  async heartbeat(userId, now = new Date()) {
    const session = await this.getSession(userId);
    if (!session) {
      return { active: false };
    }
    return this.status(session, now);
  }

  async snooze(userId, minutes = DEFAULT_SNOOZE_MINUTES, now = new Date()) {
    const session = await this.getSession(userId);
    if (!session) {
      return { active: false };
    }

    const requested = Number(minutes) || DEFAULT_SNOOZE_MINUTES;
    const clamped = Math.min(Math.max(requested, MIN_SNOOZE_MINUTES), MAX_SNOOZE_MINUTES);
    session.snoozedUntil = new Date(now.getTime() + clamped * 60000).toISOString();

    await this.saveSession(userId, session);
    return this.status(session, now);
  }

  async end(userId, now = new Date()) {
    const session = await this.getSession(userId);
    if (!session) {
      return { active: false };
    }

    await this.store.del(this.key(userId));
    return {
      active: false,
      startedAt: session.startedAt,
      endedAt: now.toISOString(),
      elapsedMinutes: this.elapsedMinutes(session, now)
    };
  }

  elapsedMinutes(session, now) {
    return Math.floor((now.getTime() - new Date(session.startedAt).getTime()) / 60000);
  }

  status(session, now) {
    const elapsedMinutes = this.elapsedMinutes(session, now);
    const snoozed = session.snoozedUntil && now < new Date(session.snoozedUntil);

    let reminder = null;
    if (!snoozed) {
      if (elapsedMinutes >= WRAP_UP_AFTER_MINUTES) {
        reminder = WRAP_UP_REMINDER;
      } else if (elapsedMinutes >= BREAK_AFTER_MINUTES) {
        reminder = BREAK_REMINDER;
      }
    }

    return {
      active: true,
      startedAt: session.startedAt,
      elapsedMinutes,
      snoozedUntil: snoozed ? session.snoozedUntil : null,
      reminder
    };
  }
}

module.exports = { SessionService, BREAK_AFTER_MINUTES, WRAP_UP_AFTER_MINUTES };
