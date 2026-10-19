// Runs against a real Postgres when TEST_DATABASE_URL is set, e.g.
// TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/gaming_companion_test

const { Pool } = require('pg');
const { migrate } = require('../../../db/migrate');
const { UserRepository } = require('../../../models/user.model');

const describeWithDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeWithDb('UserRepository (Postgres)', () => {
  let pool;
  let users;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await migrate(pool);
    users = new UserRepository({ pool });
  });

  beforeEach(() => pool.query('TRUNCATE users CASCADE'));

  afterAll(() => pool.end());

  test('migrations are idempotent', async () => {
    expect(await migrate(pool)).toEqual([]);
  });

  test('creates and finds users', async () => {
    const created = await users.create({ email: 'a@example.com', passwordHash: 'hash', displayName: 'A' });
    expect(created).toMatchObject({ email: 'a@example.com', displayName: 'A', tier: 'free' });

    expect((await users.findByEmail('a@example.com')).id).toBe(created.id);
    expect((await users.findById(created.id)).email).toBe('a@example.com');
    expect(await users.findByEmail('missing@example.com')).toBeNull();
  });

  test('returns null instead of throwing on a duplicate email', async () => {
    await users.create({ email: 'a@example.com', passwordHash: 'hash', displayName: 'A' });
    expect(await users.create({ email: 'a@example.com', passwordHash: 'other', displayName: 'B' })).toBeNull();
  });
});
