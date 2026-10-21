const { errorFields } = require('../../../utils/log-fields');

describe('errorFields', () => {
  test('R4.2: keeps name, code and status but never message, detail or stack', () => {
    const error = new Error('duplicate key value violates unique constraint "users_email_key"');
    error.code = '23505';
    error.status = 409;
    error.detail = 'Key (email)=(player@example.com) already exists.';

    const fields = errorFields(error);

    expect(fields).toEqual({ errorName: 'Error', errorCode: '23505', status: 409 });
    expect(JSON.stringify(fields)).not.toMatch(/player@example\.com|duplicate key|at /);
  });

  test('R4.2: status falls back to statusCode', () => {
    const error = new Error('nope');
    error.name = 'ServiceUnavailableError';
    error.statusCode = 503;

    expect(errorFields(error)).toEqual({ errorName: 'ServiceUnavailableError', status: 503 });
  });

  test('R4.2: leaves out undefined keys', () => {
    expect(errorFields(new TypeError('x'))).toEqual({ errorName: 'TypeError' });
  });

  test('R4.2: an empty object comes back for undefined', () => {
    expect(errorFields(undefined)).toEqual({});
    expect(errorFields(null)).toEqual({});
  });
});
