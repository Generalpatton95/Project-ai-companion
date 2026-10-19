// ============================================================================
// FILE: backend/services/safeguards/usage.service.js
// Daily analysis tracking and gentle usage limits (Safeguard 6)
//
// Free tier: hard cap of 5 analyses per day.
// Paid tiers: soft cap at 10 per day; the user can override after seeing the
// message, but every call over the cap still returns the reminder.
// Days roll over at midnight UTC.
// ============================================================================

const { FREE_LIMIT_MESSAGE, SOFT_LIMIT_MESSAGE } = require('./messages');

const FREE_DAILY_LIMIT = 5;
const SOFT_DAILY_LIMIT = 10;
const COUNTER_TTL_SECONDS = 60 * 60 * 48;

function dayKey(now) {
  return now.toISOString().slice(0, 10);
}

class UsageService {
  constructor({ store } = {}) {
    this.store = store || require('../../config/redis');
  }

  key(userId, now) {
    return `safeguards:usage:analyses:${userId}:${dayKey(now)}`;
  }

  async getTodayCount(userId, now = new Date()) {
    const value = await this.store.get(this.key(userId, now));
    return value ? parseInt(value, 10) : 0;
  }

  /**
   * Decide whether another analysis may run today.
   * Returns { allowed, count, limit, hardLimit, message? }.
   */
  async checkAnalysis(user, { override = false } = {}, now = new Date()) {
    const count = await this.getTodayCount(user.id, now);
    const tier = user.tier || 'free';

    if (tier === 'free') {
      const allowed = count < FREE_DAILY_LIMIT;
      return {
        allowed,
        count,
        limit: FREE_DAILY_LIMIT,
        hardLimit: true,
        ...(!allowed && { message: FREE_LIMIT_MESSAGE })
      };
    }

    const overLimit = count >= SOFT_DAILY_LIMIT;
    return {
      allowed: !overLimit || override,
      count,
      limit: SOFT_DAILY_LIMIT,
      hardLimit: false,
      ...(overLimit && { message: SOFT_LIMIT_MESSAGE })
    };
  }

  async recordAnalysis(userId, now = new Date()) {
    const key = this.key(userId, now);
    const count = await this.store.incr(key);
    if (count === 1) {
      await this.store.expire(key, COUNTER_TTL_SECONDS);
    }
    return count;
  }
}

module.exports = { UsageService, FREE_DAILY_LIMIT, SOFT_DAILY_LIMIT };
