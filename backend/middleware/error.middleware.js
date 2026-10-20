const logger = require('../utils/logger');
const { errorFields } = require('../utils/log-fields');
const { ValidationError } = require('../utils/errors');

function errorMiddleware(err, req, res, next) {
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
