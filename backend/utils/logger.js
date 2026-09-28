import winston from 'winston';
import { loadConfig } from '../config/index.js';

/**
 * Creates the app logger. Console only (spec 001, D2).
 * Callers pass explicit fields — never whole `req`, `res` or `config` objects (R4.3).
 *
 * @param {{ env: string, logLevel: string }} config
 * @param {{ transports?: winston.transport[] }} [options] override transports (tests)
 */
export function createLogger(config, { transports } = {}) {
  const format = config.env === 'development'
    ? winston.format.combine(winston.format.colorize(), winston.format.simple())
    : winston.format.combine(winston.format.timestamp(), winston.format.json());

  return winston.createLogger({
    level: config.logLevel,
    format: winston.format.combine(winston.format.errors({ stack: true }), format),
    transports: transports ?? [new winston.transports.Console()],
  });
}

/** Builds the default logger, falling back to `info` if the environment is invalid. */
function defaultLogger() {
  try {
    return createLogger(loadConfig());
  } catch {
    return createLogger({ env: 'production', logLevel: 'info' });
  }
}

/**
 * Default logger for modules that aren't handed one. The app itself uses the logger
 * passed to createApp(), so tests stay isolated.
 */
const logger = defaultLogger();
export default logger;
