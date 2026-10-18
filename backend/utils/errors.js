// ============================================================================
// FILE: backend/utils/errors.js
// Custom error types (mapped to status codes in error.middleware.js)
// ============================================================================

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

class AuthenticationError extends Error {
  constructor(message = 'Invalid email or password') {
    super(message);
    this.name = 'AuthenticationError';
    this.statusCode = 401;
  }
}

class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
    this.statusCode = 409;
  }
}

class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

class ServiceUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ServiceUnavailableError';
    this.statusCode = 503;
  }
}

module.exports = {
  ValidationError,
  AuthenticationError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError
};
