const logger = require('../utils/logger');

function errorMiddleware(err, req, res, next) {
  logger.error('Error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  // Default error
  let statusCode = 500;
  let message = 'Internal server error';

  // Handle specific errors
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = err.message;
  } else if (err.name === 'UnauthorizedError') {
    statusCode = 401;
    message = 'Unauthorized';
  } else if (err.message.includes('not found')) {
    statusCode = 404;
    message = err.message;
  }

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

module.exports = { errorMiddleware };