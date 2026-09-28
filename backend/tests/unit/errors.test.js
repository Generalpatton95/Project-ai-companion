import { describe, test, expect } from 'vitest';
import {
  AppError, ValidationError, UnauthorizedError, NotFoundError, ConfigError,
} from '../../utils/errors.js';

describe('typed errors', () => {
  test.each([
    [ValidationError, 400, 'VALIDATION_ERROR'],
    [UnauthorizedError, 401, 'UNAUTHORIZED'],
    [NotFoundError, 404, 'NOT_FOUND'],
  ])('R3.2: %o maps to its status and code', (ErrorClass, status, code) => {
    const err = new ErrorClass('msg');
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
    expect(err.message).toBe('msg');
    expect(err.name).toBe(ErrorClass.name);
  });

  test('R3.2: subclasses have a default message', () => {
    expect(new NotFoundError().message).toBeTruthy();
  });

  test('R1.3: ConfigError carries the bad keys and names them without values', () => {
    const err = new ConfigError(['PORT', 'NODE_ENV']);
    expect(err).not.toBeInstanceOf(AppError);
    expect(err.keys).toEqual(['PORT', 'NODE_ENV']);
    expect(err.message).toContain('PORT');
  });
});
