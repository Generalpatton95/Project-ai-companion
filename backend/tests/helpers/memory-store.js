// In-memory stand-in for the subset of ioredis used by the safeguard services.
// TTLs are recorded but not enforced.

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
