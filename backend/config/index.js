import { ConfigError } from '../utils/errors.js';

const NODE_ENVS = ['development', 'test', 'production'];
const LOG_LEVELS = ['error', 'warn', 'info', 'debug'];
const DEFAULT_LOG_LEVEL = { development: 'debug', test: 'error', production: 'info' };
const DEV_CORS_ORIGINS = ['http://localhost:5173'];
const BODY_LIMIT_PATTERN = /^\d+(b|kb|mb)$/;

/** True if value is an http(s) origin: scheme + host (+ port), with no path, query or hash. */
function isOrigin(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(obj);
}

/**
 * Builds validated config from environment variables. Pure: reads only `env`.
 * Collects every problem and throws one ConfigError naming the bad keys (never their values).
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function loadConfig(env = process.env) {
  const badKeys = [];

  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!NODE_ENVS.includes(nodeEnv)) badKeys.push('NODE_ENV');

  const port = env.PORT === undefined ? 3001 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) badKeys.push('PORT');

  const logLevel = env.LOG_LEVEL ?? DEFAULT_LOG_LEVEL[nodeEnv] ?? 'info';
  if (!LOG_LEVELS.includes(logLevel)) badKeys.push('LOG_LEVEL');

  const corsOrigins = env.CORS_ORIGINS === undefined
    ? (nodeEnv === 'development' ? DEV_CORS_ORIGINS : [])
    : env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  if (!corsOrigins.every(isOrigin)) badKeys.push('CORS_ORIGINS');

  const jsonBodyLimit = env.JSON_BODY_LIMIT ?? '100kb';
  if (!BODY_LIMIT_PATTERN.test(jsonBodyLimit)) badKeys.push('JSON_BODY_LIMIT');

  if (badKeys.length > 0) throw new ConfigError(badKeys);

  return deepFreeze({
    env: nodeEnv,
    port,
    logLevel,
    corsOrigins: [...corsOrigins],
    jsonBodyLimit,
    // Optional until the spec that uses each one makes it required (R1.4).
    anthropic: { apiKey: env.ANTHROPIC_API_KEY, model: env.CLAUDE_MODEL },
    riot: { apiKey: env.RIOT_API_KEY, region: env.RIOT_API_REGION },
    redis: { url: env.REDIS_URL },
    database: { url: env.DATABASE_URL },
    jwt: { secret: env.JWT_SECRET },
  });
}
