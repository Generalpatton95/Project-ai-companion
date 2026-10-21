// ============================================================================
// FILE: backend/config/database.js
// Postgres connection pool
// ============================================================================

const { Pool } = require('pg');
const config = require('./index');
const logger = require('../utils/logger');
const { errorFields } = require('../utils/log-fields');

// While Postgres is unreachable or stuck, requests fail quickly (503, see
// utils/store-errors.js) instead of waiting without end:
// - connectionTimeoutMillis: give up connecting after 2s (R2.1)
// - statement_timeout: Postgres cancels a query after 5s (57014) (R2.2)
// - query_timeout: the client's backstop for a network that hangs, where the
//   server never gets to cancel the query
const DB_TIMEOUTS = {
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000,
  query_timeout: 6000
};

/**
 * Build a pool from the app's config. With `timeouts: false` (migrations,
 * which can run long) only the connect limit is kept; 0 means no limit.
 */
function createPool({ timeouts = true } = {}) {
  const limits = timeouts
    ? DB_TIMEOUTS
    : { connectionTimeoutMillis: DB_TIMEOUTS.connectionTimeoutMillis, statement_timeout: 0, query_timeout: 0 };

  const pool = config.database.url
    ? new Pool({ connectionString: config.database.url, ...limits })
    : new Pool({
        host: config.database.host,
        port: config.database.port,
        database: config.database.name,
        user: config.database.user,
        password: config.database.password,
        ...limits
      });

  pool.on('error', (err) => {
    logger.error('Postgres pool error', errorFields(err));
  });

  return pool;
}

// The app's shared pool; createPool and DB_TIMEOUTS ride along as properties
module.exports = createPool();
module.exports.createPool = createPool;
module.exports.DB_TIMEOUTS = DB_TIMEOUTS;
