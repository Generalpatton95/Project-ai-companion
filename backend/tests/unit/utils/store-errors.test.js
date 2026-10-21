const { isStoreUnavailable } = require('../../../utils/store-errors');
const { ServiceUnavailableError, ValidationError, NotFoundError } = require('../../../utils/errors');

function withCode(code, message = 'connection to 10.0.0.9 failed for user "player@example.com"') {
  const error = new Error(message);
  error.code = code;
  return error;
}

describe('isStoreUnavailable', () => {
  test('R2.7: ServiceUnavailableError is not a store outage (chat keeps the companion message)', () => {
    expect(isStoreUnavailable(new ServiceUnavailableError('Timed out waiting for the store'))).toBe(false);
    const companion = new ServiceUnavailableError('The companion is unavailable right now. Please try again in a moment.');
    companion.code = 'COMPANION_UNAVAILABLE';
    expect(isStoreUnavailable(companion)).toBe(false);
  });

  test.each([
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'EPIPE',
    // Added in review round 1 (D5)
    'ENETUNREACH', 'ENETDOWN', 'EHOSTDOWN', 'ECONNABORTED'
  ])(
    'R2.3, R2.8: Node socket code %s',
    (code) => {
      expect(isStoreUnavailable(withCode(code))).toBe(true);
    }
  );

  test.each([
    ['57014', 'query_canceled (statement_timeout)'],
    ['57P01', 'admin_shutdown'],
    ['57P02', 'crash_shutdown'],
    ['57P03', 'cannot_connect_now'],
    ['53300', 'too_many_connections'],
    ['08000', 'connection_exception'],
    ['08001', 'sqlclient_unable_to_establish_sqlconnection'],
    ['08003', 'connection_does_not_exist'],
    ['08006', 'connection_failure'],
    ['08P01', 'protocol_violation']
  ])('R2.3: Postgres SQLSTATE %s (%s)', (code) => {
    expect(isStoreUnavailable(withCode(code))).toBe(true);
  });

  // pg's own timeout and termination errors have no code, so they are matched
  // by their fixed messages. Confirmed against the locked versions
  // (backend/package-lock.json: pg 8.23.1, pg-pool 3.14.0):
  //   'timeout exceeded when trying to connect'          pg-pool/index.js:224
  //       (waiting for a free client longer than connectionTimeoutMillis)
  //   'Connection terminated due to connection timeout'  pg-pool/index.js:276
  //       (a new connection not made within connectionTimeoutMillis)
  //   'Connection terminated unexpectedly'               pg/lib/client.js:204
  //       (the socket closed without client.end())
  //   'Query read timeout'                               pg/lib/client.js:707
  //       (query_timeout; also pg/lib/native/client.js:196)
  // Added in review round 1 (D5):
  //   'timeout expired'                                  pg/lib/client.js:170
  //       (the client's own connectionTimeoutMillis timer, lines 167-171)
  //   'Client has encountered a connection error and is not queryable'
  //                                                      pg/lib/client.js:767
  //       (a query on a client after its connection failed; also native/client.js:226)
  //   'Client was closed and is not queryable'           pg/lib/client.js:774
  //       (a query on a client after it ended; also native/client.js:234)
  test.each([
    'timeout exceeded when trying to connect',
    'Connection terminated due to connection timeout',
    'Connection terminated unexpectedly',
    'Query read timeout',
    'timeout expired',
    'Client has encountered a connection error and is not queryable',
    'Client was closed and is not queryable'
  ])('R2.3: pg error "%s"', (message) => {
    expect(isStoreUnavailable(new Error(message))).toBe(true);
  });

  // ioredis errors with no code (review round 1, D5), confirmed against the
  // locked ioredis 5.8.2:
  //   MaxRetriesPerRequestError (name)  ioredis/built/errors/MaxRetriesPerRequestError.js:4
  //       (class; `name` getter returns the class name, lines 10-12; thrown
  //       by flushQueue at built/redis/event_handler.js:207 while Redis is down)
  //   'Connection is closed.'           ioredis/built/utils/index.js:291
  //       (CONNECTION_CLOSED_ERROR_MSG; rejects commands at built/Redis.js:333
  //       and built/redis/event_handler.js:214)
  //   'Command timed out'               ioredis/built/Command.js:192
  //       (commandTimeout)
  test('R2.8: ioredis MaxRetriesPerRequestError (the real class)', () => {
    const { MaxRetriesPerRequestError } = require('ioredis/built/errors');
    const error = new MaxRetriesPerRequestError(1);

    expect(error.name).toBe('MaxRetriesPerRequestError');
    expect(error.code).toBeUndefined();
    expect(isStoreUnavailable(error)).toBe(true);
  });

  test.each(['Connection is closed.', 'Command timed out'])('R2.8: ioredis error "%s"', (message) => {
    expect(isStoreUnavailable(new Error(message))).toBe(true);
  });

  test('R2.8: the ioredis strings are the ones in the installed ioredis source', () => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '../../../node_modules/ioredis');
    const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8');

    expect(JSON.parse(read('package.json')).version).toBe('5.8.2');
    expect(read('built/utils/index.js')).toContain('exports.CONNECTION_CLOSED_ERROR_MSG = "Connection is closed.";');
    expect(read('built/Command.js')).toContain('new Error("Command timed out")');
    expect(read('built/errors/MaxRetriesPerRequestError.js')).toContain('class MaxRetriesPerRequestError extends');
    expect(read('built/redis/event_handler.js')).toContain('new errors_1.MaxRetriesPerRequestError(');
  });

  test('R2.8: an error that only resembles an ioredis one is not matched', () => {
    expect(isStoreUnavailable(new Error('Connection is closed'))).toBe(false);
    expect(isStoreUnavailable(Object.assign(new Error('x'), { name: 'MaxRetriesPerRequestError', code: 'OTHER' }))).toBe(false);
  });

  test('R2.3: the pg strings are the ones in the installed pg and pg-pool source', () => {
    const fs = require('fs');
    const path = require('path');
    // pg-pool's "exports" hides its package.json, so read the files directly
    const pgDir = path.join(__dirname, '../../../node_modules/pg');
    const poolDir = path.join(__dirname, '../../../node_modules/pg-pool');
    const version = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
    const pgClient = fs.readFileSync(path.join(pgDir, 'lib/client.js'), 'utf8');
    const pgPool = fs.readFileSync(path.join(poolDir, 'index.js'), 'utf8');

    // A pg upgrade fails here first, so the strings get checked again
    expect(version(pgDir)).toBe('8.23.1');
    expect(version(poolDir)).toBe('3.14.0');
    expect(pgPool).toContain("new Error('timeout exceeded when trying to connect')");
    expect(pgPool).toContain("new Error('Connection terminated due to connection timeout'");
    expect(pgClient).toContain("new Error('Connection terminated unexpectedly')");
    expect(pgClient).toContain("new Error('Query read timeout')");
    expect(pgClient).toContain("new Error('timeout expired')");
    expect(pgClient).toContain("new Error('Client has encountered a connection error and is not queryable')");
    expect(pgClient).toContain("new Error('Client was closed and is not queryable')");
  });

  test('R2.3: a pg message is matched exactly, not as a substring', () => {
    expect(isStoreUnavailable(new Error('Query read timeout for player@example.com'))).toBe(false);
    expect(isStoreUnavailable(new Error('connection terminated unexpectedly'))).toBe(false);
  });

  test.each([
    ['a unique violation (23505)', withCode('23505', 'duplicate key value: (email)=(player@example.com)')],
    ['an undefined table (42P01)', withCode('42P01')],
    ['a code that only starts like a connection code (80001)', withCode('80001')],
    ['a ValidationError', new ValidationError('query is required')],
    ['a NotFoundError', new NotFoundError('Task not found')],
    ['a plain Error', new Error('something broke')],
    ['an Error with a numeric code', withCode(8006)]
  ])('R2.3: %s is not a store outage', (label, error) => {
    expect(isStoreUnavailable(error)).toBe(false);
  });

  test.each([undefined, null, 'ECONNREFUSED', 42, {}])('R2.3: a non-error (%p) is not a store outage', (value) => {
    expect(isStoreUnavailable(value)).toBe(false);
  });
});
