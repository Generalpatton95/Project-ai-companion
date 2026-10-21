// In-memory stand-in for the subset of ioredis used by the safeguard services
// and the rate limiters. TTLs are recorded but not enforced.

const { RESERVE_SCRIPT, RELEASE_SCRIPT } = require('../../services/safeguards/usage.service');

class MemoryStore {
  constructor() {
    this.data = new Map();
    this.ttls = new Map();
  }

  async get(key) {
    const value = this.data.get(key);
    return value === undefined ? null : String(value);
  }

  async setex(key, seconds, value) {
    this.data.set(key, String(value));
    this.ttls.set(key, seconds);
    return 'OK';
  }

  async incr(key) {
    const next = (parseInt(this.data.get(key), 10) || 0) + 1;
    this.data.set(key, String(next));
    return next;
  }

  async expire(key, seconds) {
    this.ttls.set(key, seconds);
    return 1;
  }

  async ttl(key) {
    if (!this.data.has(key)) return -2;
    return this.ttls.has(key) ? this.ttls.get(key) : -1;
  }

  // Lua can't run here, so only the app's own scripts are supported: the usage
  // service's reserve and release scripts (matched by identity) and the rate
  // limiters' count script. Each runs in one step (no await in between), like
  // a script does in Redis.
  async eval(script, numKeys, key, ...args) {
    if (numKeys !== 1) {
      throw new Error('MemoryStore.eval only supports one-key scripts');
    }
    const count = parseInt(this.data.get(key), 10) || 0;

    // Compare with the cap (ARGV[1]) first; count only if there's room, then
    // give the key an expiry of ARGV[2] seconds if it has none. Replies
    // {granted, count}, as Redis does for a Lua table of integers.
    if (script === RESERVE_SCRIPT) {
      const [cap, seconds] = args;
      if (count >= Number(cap)) {
        return [0, count];
      }
      this.data.set(key, String(count + 1));
      if (!this.ttls.has(key)) {
        this.ttls.set(key, Number(seconds));
      }
      return [1, count + 1];
    }

    // Take one off while the count is above zero
    if (script === RELEASE_SCRIPT) {
      if (count > 0) {
        this.data.set(key, String(count - 1));
        return count - 1;
      }
      return 0;
    }

    // The rate limiters' count script: INCR KEYS[1], then EXPIRE it for
    // ARGV[1] seconds if it has no expiry
    if (!/INCR/.test(script) || !/TTL/.test(script) || !/EXPIRE/.test(script)) {
      throw new Error('MemoryStore.eval only supports the usage and rate-limit scripts');
    }
    const [seconds] = args;
    this.data.set(key, String(count + 1));
    if (!this.ttls.has(key)) {
      this.ttls.set(key, Number(seconds));
    }
    return count + 1;
  }

  async del(key) {
    this.ttls.delete(key);
    return this.data.delete(key) ? 1 : 0;
  }

  async lpush(key, value) {
    const list = this.data.get(key) || [];
    list.unshift(value);
    this.data.set(key, list);
    return list.length;
  }

  async ltrim(key, start, stop) {
    const list = this.data.get(key) || [];
    this.data.set(key, list.slice(start, stop + 1));
    return 'OK';
  }

  async lrange(key, start, stop) {
    const list = this.data.get(key) || [];
    return list.slice(start, stop + 1);
  }
}

module.exports = { MemoryStore };
