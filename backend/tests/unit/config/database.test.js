const { Pool } = require('pg');
const pool = require('../../../config/database');

const { createPool, DB_TIMEOUTS } = pool;

describe('config/database', () => {
  const made = [];
  const make = (options) => {
    const created = createPool(options);
    made.push(created);
    return created;
  };

  // None of these pools ever connects; end them anyway so nothing is left open
  afterAll(() => Promise.all(made.map((p) => p.end())));

  test('R2.1, R2.2: the time limits are 2s to connect, 5s per statement and a 6s client backstop', () => {
    expect(DB_TIMEOUTS).toEqual({ connectionTimeoutMillis: 2000, statement_timeout: 5000, query_timeout: 6000 });
  });

  test('R2.1, R2.2: the shared pool callers require has all three time limits', () => {
    expect(pool).toBeInstanceOf(Pool);
    expect(pool.options).toMatchObject(DB_TIMEOUTS);
  });

  test('R2.1, R2.2: createPool() has all three time limits', () => {
    expect(make().options).toMatchObject({ connectionTimeoutMillis: 2000, statement_timeout: 5000, query_timeout: 6000 });
  });

  test('R2.2: createPool({ timeouts: false }) (migrations) keeps the connect limit only', () => {
    expect(make({ timeouts: false }).options).toMatchObject({ connectionTimeoutMillis: 2000, statement_timeout: 0, query_timeout: 0 });
  });

  test('pool errors are logged with the error code only', () => {
    const logger = require('../../../utils/logger');
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const error = new Error('terminating connection for user "player@example.com"');
    error.code = '57P01';

    make().emit('error', error);

    expect(errorSpy).toHaveBeenCalledWith('Postgres pool error', { errorName: 'Error', errorCode: '57P01' });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('player@example.com');
    errorSpy.mockRestore();
  });
});
