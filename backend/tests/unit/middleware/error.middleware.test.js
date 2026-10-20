const { errorMiddleware } = require('../../../middleware/error.middleware');
const { NotFoundError, ValidationError, ServiceUnavailableError } = require('../../../utils/errors');
const logger = require('../../../utils/logger');

function fakeResponse() {
  const res = {
    statusCode: 200,
    body: undefined,
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
