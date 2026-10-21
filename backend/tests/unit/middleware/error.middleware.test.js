const { errorMiddleware } = require('../../../middleware/error.middleware');
const { NotFoundError, ValidationError, ConflictError, ServiceUnavailableError } = require('../../../utils/errors');
const logger = require('../../../utils/logger');

function fakeResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    set(name, value) {
      res.headers[name] = value;
      return res;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    }
  };
  return res;
}

describe('errorMiddleware', () => {
  const req = { path: '/api/agent/task/t1', method: 'GET', body: { query: 'private words' }, ip: '203.0.113.7' };
  let errorSpy;
  let env;

  beforeEach(() => {
    env = process.env.NODE_ENV;
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    process.env.NODE_ENV = env;
    jest.restoreAllMocks();
  });

  function handle(err) {
    const res = fakeResponse();
    errorMiddleware(err, req, res, jest.fn());
    return res;
  }

  test('R4.5: a plain Error with "not found" in its message gives a generic 500', () => {
    const res = handle(new Error('relation x not found'));

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  test('R4.5: an outside error never sends its message or stack, even in development', () => {
    process.env.NODE_ENV = 'development';
    const error = new Error('duplicate key value: (email)=(player@example.com)');
    error.code = '23505';

    const res = handle(error);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  test('R4.5: NotFoundError gives 404 with its message', () => {
    const res = handle(new NotFoundError('Task not found'));

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Task not found' });
  });

  test('R4.5: ValidationError gives 400 with its message', () => {
    const res = handle(new ValidationError('query is required'));

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'query is required' });
  });

  test('R4.5: other app errors keep their status code and message', () => {
    const res = handle(new ServiceUnavailableError('The companion is unavailable right now.'));

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'The companion is unavailable right now.' });
  });

  test('R4.5: a ConflictError keeps its status code and message', () => {
    const res = handle(new ConflictError('Email already registered'));

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'Email already registered' });
  });

  describe('store unavailable (spec 017)', () => {
    const UNAVAILABLE = { error: 'Service temporarily unavailable. Please try again shortly.' };

    function pgError(code, message = 'terminating connection for user "player@example.com" at 10.0.0.9') {
      const error = new Error(message);
      error.code = code;
      return error;
    }

    test.each([
      ['a refused connection', pgError('ECONNREFUSED')],
      ['a query cancelled by statement_timeout', pgError('57014', 'canceling statement due to statement timeout')],
      ['a connection exception', pgError('08006')],
      ['a pool connect timeout', new Error('timeout exceeded when trying to connect')],
      ['a new-connection timeout', new Error('Connection terminated due to connection timeout')],
      ['a dropped connection', new Error('Connection terminated unexpectedly')],
      ['a client query timeout', new Error('Query read timeout')]
    ])('R2.3: %s gives 503 with the outage body and Retry-After', (label, error) => {
      const res = handle(error);

      expect(res.statusCode).toBe(503);
      expect(res.headers['Retry-After']).toBe('30');
      expect(res.body).toEqual(UNAVAILABLE);
    });

    test('R2.7: a ServiceUnavailableError is not a store outage: it keeps the 016 path and its own message', () => {
      const res = handle(new ServiceUnavailableError('The companion is unavailable right now. Please try again in a moment.'));

      expect(res.statusCode).toBe(503);
      expect(res.body).toEqual({ error: 'The companion is unavailable right now. Please try again in a moment.' });
      expect(errorSpy).not.toHaveBeenCalledWith('store_unavailable', expect.anything());
    });

    test('R2.3: the outage body has no crisis resources outside chat', () => {
      expect(handle(pgError('57014')).body.resources).toBeUndefined();
    });

    test('R2.5: logs store_unavailable with the error name and code, method and path only', () => {
      handle(pgError('57P01'));

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith('store_unavailable', {
        errorName: 'Error',
        errorCode: '57P01',
        method: 'GET',
        path: '/api/agent/task/t1'
      });
      const logged = JSON.stringify(errorSpy.mock.calls);
      expect(logged).not.toContain('player@example.com');
      expect(logged).not.toContain('10.0.0.9');
      expect(logged).not.toContain('terminating');
      expect(logged).not.toContain('private words');
      expect(logged).not.toContain('203.0.113.7');
    });

    test('R2.5: a pg timeout is logged without its message', () => {
      handle(new Error('Query read timeout'));

      expect(errorSpy).toHaveBeenCalledWith('store_unavailable', { errorName: 'Error', method: 'GET', path: '/api/agent/task/t1' });
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('Query read timeout');
    });

    test('R2.3: other database errors still give the generic 500', () => {
      const res = handle(pgError('23505', 'duplicate key value: (email)=(player@example.com)'));

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error' });
      expect(errorSpy).toHaveBeenCalledWith('Error', expect.any(Object));
    });
  });

  test('R4.2: the log has error name, code, status, path and method, but no message or stack', () => {
    const error = new Error('relation "users" does not exist: player@example.com');
    error.code = '42P01';

    handle(error);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [, fields] = errorSpy.mock.calls[0];
    expect(fields).toEqual({ errorName: 'Error', errorCode: '42P01', path: '/api/agent/task/t1', method: 'GET' });
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain('player@example.com');
    expect(logged).not.toContain('does not exist');
    expect(logged).not.toContain('private words');
    expect(logged).not.toContain('203.0.113.7');
    expect(logged).not.toMatch(/stack|at /);
  });
});
