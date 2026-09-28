import { Writable } from 'node:stream';
import winston from 'winston';
import { createLogger } from '../utils/logger.js';
import { loadConfig } from '../config/index.js';

/**
 * A logger whose output is captured as parsed JSON entries in `lines`.
 * Defaults to production (JSON) format at the configured level.
 */
export function capturingLogger(env = {}) {
  const lines = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(...chunk.toString().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
      done();
    },
  });
  const logger = createLogger(loadConfig({ NODE_ENV: 'production', ...env }), {
    transports: [new winston.transports.Stream({ stream })],
  });
  return { logger, lines };
}
