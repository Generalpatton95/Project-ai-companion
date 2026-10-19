// ============================================================================
// FILE: backend/config/database.js
// Postgres connection pool
// ============================================================================

const { Pool } = require('pg');
const config = require('./index');
const logger = require('../utils/logger');

const pool = config.database.url
  ? new Pool({ connectionString: config.database.url })
  : new Pool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.user,
      password: config.database.password
    });

pool.on('error', (err) => {
  logger.error('Postgres pool error', { error: err.message });
});

module.exports = pool;
