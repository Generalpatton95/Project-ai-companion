import 'dotenv/config';
import { loadConfig } from './config/index.js';
import { createLogger } from './utils/logger.js';
import { ConfigError } from './utils/errors.js';
import { createApp } from './app.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  // No logger yet: config is what builds it. Key names only, never values (R1.3).
  console.error(`Invalid config: ${err.keys.join(', ')}`);
  process.exit(1);
}

const logger = createLogger(config);

createApp(config, { logger }).listen(config.port, () => {
  logger.info(`Server listening on http://localhost:${config.port}`, { port: config.port, env: config.env });
});
