// Transaction cleanup when Postgres fails mid-transaction (spec 017 R2.6):
// the rollback is attempted on its own, the original error is what the caller
// sees, and a broken connection is thrown away instead of going back to the pool.

const { ChatRepository } = require('../../../models/chat.model');
const { migrate } = require('../../../db/migrate');

function pgError(code, message = 'canceling statement for user "player@example.com"') {
  const error = new Error(message);
  error.code = code;
  return error;
}

// A client whose queries succeed, except those matched in `failures`
// ({ pattern: error }). Records every query's first word.
function fakeClient(failures = []) {
  const client = {
    statements: [],
    query: jest.fn(async (sql) => {
      const text = String(sql).trim();
      client.statements.push(text.split(/\s+/)[0]);
      const failure = failures.find(([pattern]) => pattern.test(text));
      if (failure) {
        throw failure[1];
      }
      return { rows: [{ id: 1, role: 'user', content: '"hi"', display_text: null, safeguard: null, created_at: new Date() }] };
    }),
    release: jest.fn()
  };
  return client;
}

function fakePool(client, { applied = [] } = {}) {
  return {
    connect: jest.fn(async () => client),
    query: jest.fn(async (sql) => (/SELECT name FROM schema_migrations/.test(sql)
      ? { rows: applied.map((name) => ({ name })) }
      : { rows: [] }))
  };
}

describe('ChatRepository.appendMessages transactions', () => {
  const append = (client) => new ChatRepository({ pool: fakePool(client) })
    .appendMessages('c1', [{ role: 'user', content: 'hi' }], { title: 'hi' });

  test('R2.6: a successful append commits and returns the client to the pool', async () => {
    const client = fakeClient();

    await expect(append(client)).resolves.toHaveLength(1);

    expect(client.statements).toEqual(['BEGIN', 'INSERT', 'UPDATE', 'COMMIT']);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release.mock.calls[0]).toEqual([]);
  });

  test('R2.6: a query cancelled by statement_timeout is rolled back, rethrown, and its client discarded', async () => {
    const timeout = pgError('57014');
    const client = fakeClient([[/^INSERT/, timeout]]);

    await expect(append(client)).rejects.toBe(timeout);

    expect(client.statements).toEqual(['BEGIN', 'INSERT', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  test('R2.6: a client-side query timeout (no code) also discards the client', async () => {
    const timeout = new Error('Query read timeout');
    const client = fakeClient([[/^UPDATE/, timeout]]);

    await expect(append(client)).rejects.toBe(timeout);

    expect(client.statements).toEqual(['BEGIN', 'INSERT', 'UPDATE', 'ROLLBACK']);
    expect(client.release.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  test('R2.6: a failed rollback still rethrows the original error and discards the client', async () => {
    const original = pgError('ECONNRESET');
    const client = fakeClient([[/^INSERT/, original], [/^ROLLBACK/, new Error('Connection terminated unexpectedly')]]);

    await expect(append(client)).rejects.toBe(original);

    expect(client.statements).toEqual(['BEGIN', 'INSERT', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  test('R2.6: a failed rollback after an ordinary error also discards the client', async () => {
    const original = pgError('23503', 'insert violates foreign key');
    const client = fakeClient([[/^INSERT/, original], [/^ROLLBACK/, new Error('rollback failed')]]);

    await expect(append(client)).rejects.toBe(original);

    expect(client.release.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  test('R2.6: an ordinary error that rolls back cleanly returns the client to the pool', async () => {
    const original = pgError('23503', 'insert violates foreign key');
    const client = fakeClient([[/^INSERT/, original]]);

    await expect(append(client)).rejects.toBe(original);

    expect(client.statements).toEqual(['BEGIN', 'INSERT', 'ROLLBACK']);
    expect(client.release.mock.calls[0]).toEqual([]);
  });
});

describe('migrate() transactions', () => {
  test('R2.6: a migration cancelled mid-transaction is rolled back, reported by code, and its client discarded', async () => {
    const client = fakeClient([[/^(?!BEGIN|ROLLBACK|COMMIT|INSERT)/, pgError('57P01')]]);

    const error = await migrate(fakePool(client)).catch((e) => e);

    expect(error).toMatchObject({ code: '57P01', migration: '001_create_users.sql' });
    expect(error.message).toBe('Migration 001_create_users.sql failed');
    expect(client.statements.slice(-1)).toEqual(['ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  test('R2.6: a failed rollback still reports the original failure and discards the client', async () => {
    const client = fakeClient([
      [/^(?!BEGIN|ROLLBACK|COMMIT|INSERT)/, pgError('42P07', 'relation "users" already exists')],
      [/^ROLLBACK/, new Error('Connection terminated unexpectedly')]
    ]);

    const error = await migrate(fakePool(client)).catch((e) => e);

    expect(error).toMatchObject({ code: '42P07', migration: '001_create_users.sql' });
    expect(client.release.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  test('R2.6: an ordinary migration error that rolls back cleanly returns the client', async () => {
    const client = fakeClient([[/^(?!BEGIN|ROLLBACK|COMMIT|INSERT)/, pgError('42P07', 'relation "users" already exists')]]);

    const error = await migrate(fakePool(client)).catch((e) => e);

    expect(error).toMatchObject({ code: '42P07' });
    expect(client.release.mock.calls[0]).toEqual([]);
  });

  test('R2.6: successful migrations commit and return each client', async () => {
    const client = fakeClient();

    const ran = await migrate(fakePool(client));

    expect(ran).toEqual(['001_create_users.sql', '002_create_chat.sql']);
    expect(client.release.mock.calls).toEqual([[], []]);
  });
});
