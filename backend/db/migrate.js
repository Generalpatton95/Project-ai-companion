// ============================================================================
// FILE: backend/db/migrate.js
// Applies db/migrations/*.sql in filename order, once each.
// Usage: npm run migrate
// ============================================================================

const fs = require('fs');
const path = require('path');
const { errorFields } = require('../utils/log-fields');
const { isStoreUnavailable } = require('../utils/store-errors');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function migrate(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const ran = [];

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    // Set when the connection can't be trusted, so pg throws it away
    let broken;
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      ran.push(file);
    } catch (error) {
      // A failed rollback must not hide the migration's own failure
      try {
        await client.query('ROLLBACK');
        broken = isStoreUnavailable(error) ? error : undefined;
      } catch (rollbackError) {
        broken = rollbackError;
      }
      // Keep Postgres's code (e.g. 42P07), not its message
      const failure = new Error(`Migration ${file} failed`);
      failure.code = error.code;
      failure.migration = file;
      throw failure;
    } finally {
      if (broken) {
        client.release(broken);
      } else {
        client.release();
      }
    }
  }

  return ran;
}

module.exports = { migrate };

if (require.main === module) {
  // Migrations can run long, so they get no statement or query time limit
  // (R2.2); the connect limit stays
  const { createPool } = require('../config/database');
  const pool = createPool({ timeouts: false });
  migrate(pool)
    .then((ran) => {
      console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date');
    })
    .catch((error) => {
      console.error('Migration failed', { migration: error.migration, ...errorFields(error) });
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
