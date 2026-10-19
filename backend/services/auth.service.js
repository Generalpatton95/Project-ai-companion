// ============================================================================
// FILE: backend/services/auth.service.js
// Email + password accounts, JWT issuance
// ============================================================================

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { UserRepository } = require('../models/user.model');
const { ValidationError, AuthenticationError, ConflictError } = require('../utils/errors');

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72; // bcrypt ignores anything past 72 bytes
const DISPLAY_NAME_MAX_LENGTH = 40;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 12;

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    tier: user.tier,
    createdAt: user.createdAt
  };
}

class AuthService {
  constructor({ users = new UserRepository(), jwtSecret = config.jwt.secret, bcryptRounds = BCRYPT_ROUNDS } = {}) {
    this.users = users;
    this.jwtSecret = jwtSecret;
    this.bcryptRounds = bcryptRounds;
    this.dummyHash = null;
  }

  issueToken(user) {
    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET is not configured');
    }
    return jwt.sign({ id: user.id, tier: user.tier }, this.jwtSecret, {
      expiresIn: config.jwt.expiresIn
    });
  }

  validatePassword(password) {
    if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
      throw new ValidationError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
    }
    if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
      throw new ValidationError('Password is too long');
    }
  }

  async register({ email, password, displayName, ageConfirmed } = {}) {
    const normalizedEmail = normalizeEmail(email);
    if (!EMAIL_PATTERN.test(normalizedEmail) || normalizedEmail.length > 254) {
      throw new ValidationError('Enter a valid email address');
    }
    this.validatePassword(password);
    if (ageConfirmed !== true) {
      throw new ValidationError('You must be 13 or older to create an account');
    }

    const name = (typeof displayName === 'string' ? displayName.trim() : '') ||
      normalizedEmail.split('@')[0];
    if (name.length > DISPLAY_NAME_MAX_LENGTH) {
      throw new ValidationError(`Display name must be ${DISPLAY_NAME_MAX_LENGTH} characters or fewer`);
    }

    const passwordHash = await bcrypt.hash(password, this.bcryptRounds);
    const user = await this.users.create({ email: normalizedEmail, passwordHash, displayName: name });
    if (!user) {
      throw new ConflictError('An account with that email already exists');
    }

    return { token: this.issueToken(user), user: publicUser(user) };
  }

  async login({ email, password } = {}) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || typeof password !== 'string' || !password) {
      throw new AuthenticationError();
    }

    const user = await this.users.findByEmail(normalizedEmail);

    // Compare against a dummy hash when the user doesn't exist so response
    // time doesn't reveal which emails have accounts
    if (!this.dummyHash) {
      this.dummyHash = await bcrypt.hash('dummy-password', this.bcryptRounds);
    }
    const matches = await bcrypt.compare(password, user ? user.passwordHash : this.dummyHash);

    if (!user || !matches) {
      throw new AuthenticationError();
    }

    return { token: this.issueToken(user), user: publicUser(user) };
  }

  async getCurrentUser(userId) {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new AuthenticationError('Account not found');
    }
    return publicUser(user);
  }
}

module.exports = { AuthService, PASSWORD_MIN_LENGTH };
