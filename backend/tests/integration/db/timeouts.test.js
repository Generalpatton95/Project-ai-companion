// Runs against a real Postgres when TEST_DATABASE_URL is set (CI); skipped otherwise.
// The app pool cancels a long query; the migration pool does not (spec 017 R2.2).

const describeWithDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeWithDb('Postgres time limits (Postgres)', () => {
  let appPool;
  let migrationPool;
  let isStoreUnavailable;

  beforeAll(() => {
    jest.isolateModules(() => {
      // The real config/database.js, pointed at the test database
      jest.doMock('../../../config/index', () => ({
        ...jest.requireActual('../../../config/index'),
        database: { url: process.env.TEST_DATABASE_URL }
      }));
      const { createPool } = require('../../../config/database');
      appPool = createPool();
      migrationPool = createPool({ timeouts: false });
      ({ isStoreUnavailable } = require('../../../utils/store-errors'));
    });
  });

  afterAll(async () => {
    jest.dontMock('../../../config/index');
    // The shared pool built when config/database.js loaded never connected
    await Promise.all([appPool.end(), migrationPool.end()]);
  });

  test('R2.2, R2.3: a 6s query on the app pool is cancelled by Postgres with 57014', async () => {
    const error = await appPool.query('SELECT pg_sleep(6)').catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('57014');
    expect(isStoreUnavailable(error)).toBe(true);
  }, 15000);

  // Checked through the session setting instead of sleeping past 5s
  test('R2.2: the migration pool has no statement time limit; the app pool has 5s', async () => {
    const migration = await migrationPool.query('SHOW statement_timeout');
    const app = await appPool.query('SHOW statement_timeout');

    expect(migration.rows[0].statement_timeout).toBe('0');
    expect(app.rows[0].statement_timeout).toBe('5s');
  });

  test('R2.2: the cancelled query leaves the app pool usable', async () => {
    const { rows } = await appPool.query('SELECT 1 AS one');

    expect(rows[0].one).toBe(1);
  });
});
