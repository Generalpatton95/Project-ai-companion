/**
 * Base class for errors whose status, code and message are safe to send to clients.
 */
export class AppError extends Error {
  /**
   * @param {string} message
   * @param {{ status: number, code: string }} options
   */
  constructor(message, { status, code }) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request') {
    super(message, { status: 400, code: 'VALIDATION_ERROR' });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, { status: 401, code: 'UNAUTHORIZED' });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, { status: 404, code: 'NOT_FOUND' });
  }
}

/**
 * Thrown at startup when configuration is invalid. Names keys only, never values.
 * Not an AppError: it is never sent over HTTP.
 */
export class ConfigError extends Error {
  /** @param {string[]} keys */
  constructor(keys) {
    super(`Invalid configuration: ${keys.join(', ')}`);
    this.name = 'ConfigError';
    this.keys = keys;
  }
}
