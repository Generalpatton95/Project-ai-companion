/**
 * Logs one line per request when the response finishes.
 * Uses req.path (no query string) and never reads bodies or headers (R4.3).
 *
 * @param {import('winston').Logger} logger
 */
export function createRequestLogger(logger) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info('request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
      });
    });
    next();
  };
}
