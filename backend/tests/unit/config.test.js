import { describe, test, expect } from 'vitest';
import { loadConfig } from '../../config/index.js';
import { ConfigError } from '../../utils/errors.js';

/** Returns the ConfigError thrown by loadConfig(env), or fails the test. */
function configErrorFor(env) {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return err;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig defaults', () => {
  test('R1.1: reads only from the env object passed in', () => {
    const config = loadConfig({});
    expect(config.env).toBe('development');
  });

  test('R1.2: port defaults to 3001', () => {
    expect(loadConfig({}).port).toBe(3001);
  });

  test('R1.2: port is read from PORT', () => {
    expect(loadConfig({ PORT: '8080' }).port).toBe(8080);
  });

  test.each([
    ['development', 'debug'],
    ['production', 'info'],
    ['test', 'error'],
  ])('R1.1: LOG_LEVEL defaults per NODE_ENV=%s', (NODE_ENV, level) => {
    expect(loadConfig({ NODE_ENV }).logLevel).toBe(level);
  });

  test('R1.1: LOG_LEVEL overrides the default', () => {
    expect(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'warn' }).logLevel).toBe('warn');
  });

  test('R1.1: CORS_ORIGINS defaults to the Vite dev server in development only', () => {
    expect(loadConfig({}).corsOrigins).toEqual(['http://localhost:5173']);
    expect(loadConfig({ NODE_ENV: 'production' }).corsOrigins).toEqual([]);
    expect(loadConfig({ NODE_ENV: 'test' }).corsOrigins).toEqual([]);
  });

  test('R1.1: CORS_ORIGINS is parsed as a comma-separated list', () => {
    const config = loadConfig({ CORS_ORIGINS: 'https://a.example.com, http://localhost:3000' });
    expect(config.corsOrigins).toEqual(['https://a.example.com', 'http://localhost:3000']);
  });

  test('R1.1: JSON_BODY_LIMIT defaults to 100kb and can be overridden', () => {
    expect(loadConfig({}).jsonBodyLimit).toBe('100kb');
    expect(loadConfig({ JSON_BODY_LIMIT: '1mb' }).jsonBodyLimit).toBe('1mb');
  });

  test('R1.1: config is frozen, including nested sections', () => {
    const config = loadConfig({});
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.corsOrigins)).toBe(true);
    expect(Object.isFrozen(config.riot)).toBe(true);
  });
});

describe('loadConfig optional keys', () => {
  test('R1.4: keys for unbuilt features are optional', () => {
    const config = loadConfig({});
    expect(config.anthropic.apiKey).toBeUndefined();
    expect(config.riot.apiKey).toBeUndefined();
    expect(config.redis.url).toBeUndefined();
    expect(config.database.url).toBeUndefined();
    expect(config.jwt.secret).toBeUndefined();
  });

  test('R1.4: keys for unbuilt features pass through untouched', () => {
    const config = loadConfig({
      ANTHROPIC_API_KEY: 'a', CLAUDE_MODEL: 'm', RIOT_API_KEY: 'r', RIOT_API_REGION: 'euw1',
      REDIS_URL: 'redis://x', DATABASE_URL: 'postgres://x', JWT_SECRET: 's',
    });
    expect(config.anthropic).toEqual({ apiKey: 'a', model: 'm' });
    expect(config.riot).toEqual({ apiKey: 'r', region: 'euw1' });
    expect(config.redis).toEqual({ url: 'redis://x' });
    expect(config.database).toEqual({ url: 'postgres://x' });
    expect(config.jwt).toEqual({ secret: 's' });
  });
});

describe('loadConfig validation', () => {
  test.each([
    ['PORT', 'abc'],
    ['PORT', '0'],
    ['PORT', '70000'],
    ['PORT', '30.5'],
    ['NODE_ENV', 'staging'],
    ['LOG_LEVEL', 'verbose'],
    ['CORS_ORIGINS', 'not-a-url'],
    ['CORS_ORIGINS', 'ftp://files.example.com'],
    ['CORS_ORIGINS', 'https://example.com/path'],
    ['JSON_BODY_LIMIT', 'lots'],
  ])('R1.3: rejects %s=%s', (key, value) => {
    expect(configErrorFor({ [key]: value }).keys).toEqual([key]);
  });

  test('R1.3: reports every bad key at once', () => {
    const err = configErrorFor({ PORT: 'abc', NODE_ENV: 'staging', LOG_LEVEL: 'loud' });
    expect(err.keys).toEqual(['NODE_ENV', 'PORT', 'LOG_LEVEL']);
  });

  test('R1.3: error message names keys but never values', () => {
    const err = configErrorFor({ PORT: 'secret-looking-value' });
    expect(err.message).toContain('PORT');
    expect(err.message).not.toContain('secret-looking-value');
  });
});

describe('.env.example', () => {
  test('R1.5: lists every config key, with no real secrets', async () => {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(new URL('../../.env.example', import.meta.url), 'utf8');
    const entries = Object.fromEntries(
      text.split(/\r?\n/)
        .filter((line) => /^[A-Z_]+=/.test(line))
        .map((line) => line.split(/=(.*)/s).slice(0, 2)),
    );
    const keys = [
      'NODE_ENV', 'PORT', 'LOG_LEVEL', 'CORS_ORIGINS', 'JSON_BODY_LIMIT',
      'ANTHROPIC_API_KEY', 'CLAUDE_MODEL', 'RIOT_API_KEY', 'RIOT_API_REGION',
      'REDIS_URL', 'DATABASE_URL', 'JWT_SECRET',
    ];
    for (const key of keys) expect(entries, key).toHaveProperty(key);
    for (const key of ['ANTHROPIC_API_KEY', 'RIOT_API_KEY', 'JWT_SECRET']) {
      expect(entries[key], key).toBe('');
    }
    // The example itself must be a valid config.
    expect(() => loadConfig(Object.fromEntries(
      Object.entries(entries).filter(([, v]) => v !== ''),
    ))).not.toThrow();
  });
});
