// ============================================================================
// FILE: backend/models/user.model.js
// User persistence (Postgres)
// ============================================================================

const COLUMNS = 'id, email, password_hash, display_name, tier, created_at';

function toUser(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    tier: row.tier,
    createdAt: row.created_at
  };
}

class UserRepository {
  constructor({ pool } = {}) {
    this.pool = pool || require('../config/database');
  }

  /**
   * Insert a user. Returns null if the email is already taken.
   */
  async create({ email, passwordHash, displayName }) {
    const { rows } = await this.pool.query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING
       RETURNING ${COLUMNS}`,
      [email, passwordHash, displayName]
    );
    return toUser(rows[0]);
  }

  async findByEmail(email) {
    const { rows } = await this.pool.query(`SELECT ${COLUMNS} FROM users WHERE email = $1`, [email]);
    return toUser(rows[0]);
  }

  async findById(id) {
    const { rows } = await this.pool.query(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
    return toUser(rows[0]);
  }
}

module.exports = { UserRepository };
