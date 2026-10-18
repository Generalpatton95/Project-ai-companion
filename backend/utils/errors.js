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

module.exports = { ValidationError };
