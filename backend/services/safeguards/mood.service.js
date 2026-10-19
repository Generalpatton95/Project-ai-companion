// ============================================================================
// FILE: backend/services/safeguards/mood.service.js
// Mood check-ins before and after sessions
// ============================================================================

const { CRISIS_RESOURCES, LOW_MOOD_MESSAGE } = require('./messages');
const { ValidationError } = require('../../utils/errors');

const MOODS = ['good', 'okay', 'low'];
const PHASES = ['pre', 'post'];

// Keep roughly a month of check-ins (two per session)
const HISTORY_LENGTH = 60;
const HISTORY_TTL_SECONDS = 60 * 60 * 24 * 60;

// "Consistently negative": this many lows within the most recent window
const LOW_MOOD_WINDOW = 5;
const LOW_MOOD_THRESHOLD = 4;

const TONE_BY_MOOD = {
  low: 'encouraging',
  okay: 'balanced',
  good: 'challenging'
};

class MoodService {
  constructor({ store } = {}) {
    this.store = store || require('../../config/redis');
  }

  key(userId) {
    return `safeguards:mood:${userId}`;
  }

  async recordCheckIn(userId, { phase, mood }, now = new Date()) {
    if (!PHASES.includes(phase)) {
      throw new ValidationError(`phase must be one of: ${PHASES.join(', ')}`);
    }
    if (!MOODS.includes(mood)) {
      throw new ValidationError(`mood must be one of: ${MOODS.join(', ')}`);
    }

    const entry = { phase, mood, at: now.toISOString() };
    const key = this.key(userId);

    await this.store.lpush(key, JSON.stringify(entry));
    await this.store.ltrim(key, 0, HISTORY_LENGTH - 1);
    await this.store.expire(key, HISTORY_TTL_SECONDS);

    return entry;
  }

  async getHistory(userId, limit = HISTORY_LENGTH) {
    const raw = await this.store.lrange(this.key(userId), 0, limit - 1);
    return raw.map((item) => JSON.parse(item));
  }

  /**
   * Summarize recent mood: the tone the companion should take and whether to
   * gently suggest talking to someone.
   */
  async getSummary(userId) {
    const recent = await this.getHistory(userId, LOW_MOOD_WINDOW);
    const latest = recent[0] || null;
    const lowCount = recent.filter((entry) => entry.mood === 'low').length;
    const consistentlyLow = lowCount >= LOW_MOOD_THRESHOLD;

    return {
      latest,
      tone: latest ? TONE_BY_MOOD[latest.mood] : 'balanced',
      consistentlyLow,
      ...(consistentlyLow && {
        support: { message: LOW_MOOD_MESSAGE, resources: CRISIS_RESOURCES }
      })
    };
  }
}

module.exports = { MoodService, MOODS, PHASES };
