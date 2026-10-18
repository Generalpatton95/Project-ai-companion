
// ============================================================================
// FILE: backend/config/index.js
// Central Configuration
// ============================================================================

require('dotenv').config();

module.exports = {
  app: {
    port: process.env.PORT || 8000,
    env: process.env.NODE_ENV || 'development',
    apiUrl: process.env.API_URL || 'http://localhost:8000'
  },

  database: {
    url: process.env.DATABASE_URL,
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    name: process.env.DB_NAME || 'gaming_companion',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD
  },

  redis: {
    url: process.env.REDIS_URL,
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS) || 4000,
    chatModel: process.env.CHAT_MODEL || 'claude-opus-5-5',
    chatEffort: process.env.CHAT_EFFORT || 'medium'
  },

  riotGames: {
    apiKey: process.env.RIOT_API_KEY,
    region: process.env.RIOT_API_REGION || 'na1'
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: '7d'
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
  },

  agent: {
    maxIterations: 10,
    timeout: 30000, // 30 seconds
    costLimits: {
      free: parseFloat(process.env.MAX_MONTHLY_COST_FREE) || 0.50,
      basic: parseFloat(process.env.MAX_MONTHLY_COST_BASIC) || 5.00,
      pro: parseFloat(process.env.MAX_MONTHLY_COST_PRO) || 25.00
    }
  }
};
