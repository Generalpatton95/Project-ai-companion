// ============================================================================
// FILE: backend/services/safeguards/usage.service.js
// Daily analysis tracking and gentle usage limits (Safeguard 6)
//
// Free tier: hard cap of 5 analyses per day.
// Paid tiers: soft cap at 10 per day; the user can override after seeing the
// message, but every call over the cap still returns the reminder.
// Days roll over at midnight UTC.
//
// A slot is reserved before the analysis starts, in one atomic step, so
// simultaneous requests can't all pass the check. A request that fails gives
// its slot back (see middleware/safeguards.middleware.js).
// ============================================================================

const { FREE_LIMIT_MESSAGE, SOFT_LIMIT_MESSAGE } = require('./messages');
const { ServiceUnavailableError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const { errorFields } = require('../../utils/log-fields');

const FREE_DAILY_LIMIT = 5;
const SOFT_DAILY_LIMIT = 10;
const COUNTER_TTL_SECONDS = 60 * 60 * 48;

// Take a slot only if the count is under the cap (ARGV[1]), and give the key
// an expiry of ARGV[2] seconds if it has none, in one atomic step. The
// comparison comes before the increment, so a refused request never changes
// the count. Replies {granted (0 or 1), count}.
const RESERVE_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= tonumber(ARGV[1]) then
  return {0, count}
end
count = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return {1, count}
`;

// Give a slot back, never taking the count below 0
const RELEASE_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count > 0 then
  return redis.call('DECR', KEYS[1])
end
return 0
`;

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
   * Read-only status: whether another analysis may run today. Takes no slot
   * (GET /api/safeguards/usage). Returns { allowed, count, limit, hardLimit, message? }.
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

  /**
   * Take one of today's analysis slots if there's room, in one atomic step.
   * Returns { granted, count, limit, hardLimit, message?, slot? }; `slot` is
   * set when granted. Fails with ServiceUnavailableError if the store's reply
   * can't be trusted, so the check fails closed.
   */
  async reserveAnalysis(user, { override = false } = {}, now = new Date()) {
    const free = (user.tier || 'free') === 'free';
    const limit = free ? FREE_DAILY_LIMIT : SOFT_DAILY_LIMIT;
    // A paid user who chose to go on past the soft limit isn't capped
    const cap = !free && override ? Number.MAX_SAFE_INTEGER : limit;
    const key = this.key(user.id, now);

    const reply = await this.store.eval(RESERVE_SCRIPT, 1, key, cap, COUNTER_TTL_SECONDS);
    // Anything but two integers means the count can't be trusted: fail closed
    if (!Array.isArray(reply) || reply.length !== 2 || !reply.every(Number.isInteger)) {
      throw new ServiceUnavailableError('Usage reservation reply was not an integer pair');
    }
    const [granted, count] = reply;

    if (granted !== 1) {
      return {
        granted: false,
        count,
        limit,
        hardLimit: free,
        message: free ? FREE_LIMIT_MESSAGE : SOFT_LIMIT_MESSAGE
      };
    }

    return {
      granted: true,
      count,
      limit,
      hardLimit: free,
      ...(!free && count > SOFT_DAILY_LIMIT && { message: SOFT_LIMIT_MESSAGE }),
      slot: this.createSlot(key)
    };
  }

  /**
   * A reserved slot. `key` is fixed when the slot is taken, so a slot given
   * back after midnight UTC goes back to the day it came from. release() gives
   * it back once (later calls do nothing) and never throws: if the store
   * fails, the event is logged and the slot stays used. markStarted() records
   * that the analysis has begun, after which a client disconnect no longer
   * gives the slot back (only a failure does).
   */
  createSlot(key) {
    let released = false;
    return {
      key,
      started: false,
      markStarted() {
        this.started = true;
      },
      release: () => {
        if (released) {
          return Promise.resolve();
        }
        released = true;
        return Promise.resolve()
          .then(() => this.store.eval(RELEASE_SCRIPT, 1, key))
          .then(
            () => undefined,
            (error) => {
              logger.error('usage_release_failed', errorFields(error));
            }
          );
      }
    };
  }
}

module.exports = {
  UsageService,
  FREE_DAILY_LIMIT,
  SOFT_DAILY_LIMIT,
  RESERVE_SCRIPT,
  RELEASE_SCRIPT
};
