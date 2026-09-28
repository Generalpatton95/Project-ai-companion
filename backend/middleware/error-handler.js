import { AppError } from '../utils/errors.js';

/** Errors raised by express.json() (body-parser), keyed by err.type. */
const BODY_PARSER_ERRORS = {
  'entity.parse.failed': { status: 400, code: 'INVALID_JSON', message: 'Request body is not valid JSON' },
  'entity.too.large': { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
};

const INTERNAL_ERROR = { status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong' };

function toResponse(err) {
  if (err instanceof AppError) return { status: err.status, code: err.code, message: err.message };
  return BODY_PARSER_ERRORS[err?.type] ?? INTERNAL_ERROR;
}

/**
 * Maps any error to `{ error: { code, message } }` (R3.1).
 * Unexpected errors get a generic 500 and never expose internals (R3.3); 5xx are logged (R3.4).
 *
 * @param {import('winston').Logger} logger
 */
export function createErrorHandler(logger) {
  // Express identifies error handlers by their four parameters.
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);

    const { status, code, message } = toResponse(err);
    if (status >= 500) {
      logger.error('Unhandled error', { stack: err?.stack, method: req.method, path: req.path });
    }
    res.status(status).json({ error: { code, message } });
  };
}
