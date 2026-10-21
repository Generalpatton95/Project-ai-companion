const logger = require('../utils/logger');
const { errorFields } = require('../utils/log-fields');
const { ValidationError } = require('../utils/errors');
const { isStoreUnavailable } = require('../utils/store-errors');
const { sendUnavailable } = require('../utils/unavailable');

function errorMiddleware(err, req, res, next) {
  // Postgres or Redis unreachable or too slow: the same 503 and Retry-After
  // as the fail-closed checks, never the error's own message
  if (isStoreUnavailable(err)) {
    logger.error('store_unavailable', {
      ...errorFields(err),
      method: req.method,
      path: req.path
    });
    return sendUnavailable(res);
  }

  // Name, code and status only: messages and stacks from Postgres, Redis,
  // Claude or Riot can carry the values that were sent
  logger.error('Error', {
    ...errorFields(err),
    path: req.path,
    method: req.method
  });

  // Default error
  let statusCode = 500;
  let message = 'Internal server error';

  // Only the app's own errors (utils/errors.js) send their message
  if (err.statusCode) {
    statusCode = err.statusCode;
    message = err.message;
  } else if (err instanceof ValidationError) {
    statusCode = 400;
    message = err.message;
  } else if (err.name === 'UnauthorizedError') {
    statusCode = 401;
    message = 'Unauthorized';
  }

  res.status(statusCode).json({ error: message });
}

module.exports = { errorMiddleware };
