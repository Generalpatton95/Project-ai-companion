const jwt = require('jsonwebtoken');
const { AuthService } = require('../../../services/auth.service');

class FakeUsers {
  constructor() {
    this.byEmail = new Map();
  }

  async create({ email, passwordHash, displayName }) {
    if (this.byEmail.has(email)) {
      return null;
    }
    const user = { id: `user-${this.byEmail.size + 1}`, email, passwordHash, displayName, tier: 'free', createdAt: new Date() };
    this.byEmail.set(email, user);
    return user;
  }

  async findByEmail(email) {
    return this.byEmail.get(email) || null;
  }

  async findById(id) {
    return [...this.byEmail.values()].find((u) => u.id === id) || null;
  }
}

describe('AuthService', () => {
  let service;
  const valid = { email: 'Player@Example.com ', password: 'correct horse', ageConfirmed: true };

  beforeEach(() => {
    service = new AuthService({ users: new FakeUsers(), jwtSecret: 'test-secret', bcryptRounds: 4 });
  });

  test('registers a user, normalizing email and hashing the password', async () => {
    const { token, user } = await service.register(valid);

    expect(user.email).toBe('player@example.com');
    expect(user.displayName).toBe('player');
    expect(user).not.toHaveProperty('passwordHash');

    const stored = await service.users.findByEmail('player@example.com');
    expect(stored.passwordHash).not.toBe('correct horse');

    const payload = jwt.verify(token, 'test-secret');
    expect(payload).toMatchObject({ id: user.id, tier: 'free' });
  });

  test.each([
    [{ ...valid, email: 'not-an-email' }, /valid email/],
    [{ ...valid, password: 'short' }, /at least 8/],
    [{ ...valid, password: 'x'.repeat(73) }, /too long/],
    [{ ...valid, ageConfirmed: false }, /13 or older/],
    [{ ...valid, displayName: 'x'.repeat(41) }, /40 characters/]
  ])('rejects invalid registration %#', async (input, message) => {
    await expect(service.register(input)).rejects.toThrow(message);
  });

  test('rejects a duplicate email with a conflict', async () => {
    await service.register(valid);
    await expect(service.register({ ...valid, email: 'player@example.com' }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  test('logs in with the right password', async () => {
    await service.register(valid);
    const { token, user } = await service.login({ email: 'PLAYER@example.com', password: 'correct horse' });
    expect(user.email).toBe('player@example.com');
    expect(jwt.verify(token, 'test-secret').id).toBe(user.id);
  });

  test('gives the same error for a wrong password and an unknown email', async () => {
    await service.register(valid);
    const wrongPassword = service.login({ email: 'player@example.com', password: 'nope nope nope' });
    const unknownEmail = service.login({ email: 'ghost@example.com', password: 'correct horse' });

    await expect(wrongPassword).rejects.toMatchObject({ statusCode: 401, message: 'Invalid email or password' });
    await expect(unknownEmail).rejects.toMatchObject({ statusCode: 401, message: 'Invalid email or password' });
  });

  test('refuses to issue tokens without a configured secret', async () => {
    const unconfigured = new AuthService({ users: new FakeUsers(), jwtSecret: undefined, bcryptRounds: 4 });
    await expect(unconfigured.register(valid)).rejects.toThrow('JWT_SECRET is not configured');
  });

  test('getCurrentUser returns the public profile', async () => {
    const { user } = await service.register(valid);
    expect(await service.getCurrentUser(user.id)).toEqual(user);
    await expect(service.getCurrentUser('missing')).rejects.toMatchObject({ statusCode: 401 });
  });
});
