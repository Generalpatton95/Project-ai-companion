import express from 'express';
import cors from 'cors';
import { createRequestLogger } from './middleware/request-logger.js';
import { notFound } from './middleware/not-found.js';
import { createErrorHandler } from './middleware/error-handler.js';
import { healthRoutes } from './routes/health.routes.js';

/**
 * Builds the Express app. Does not listen — see server.js (R6.2).
 *
 * @param {ReturnType<typeof import('./config/index.js').loadConfig>} config
 * @param {{ logger: import('winston').Logger, routes?: import('express').Router[] }} deps
 *   `routes` mounts extra routers before the 404 handler (used by tests).
 */
export function createApp(config, { logger, routes = [] }) {
  const app = express();
  app.disable('x-powered-by');

  app.use(createRequestLogger(logger));
  app.use(cors({
    // No Origin header (curl, server-to-server) is allowed; browsers must match the allowlist (R2.5).
    origin: (origin, callback) => callback(null, !origin || config.corsOrigins.includes(origin)),
  }));
  app.use(express.json({ limit: config.jsonBodyLimit }));

  app.use(healthRoutes);
  for (const router of routes) app.use(router);

  app.use(notFound);
  app.use(createErrorHandler(logger));
  return app;
}
