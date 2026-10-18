process.env.JWT_SECRET = 'test-secret';

const express = require('express');
const { createAuthRouter } = require('../../../routes/auth.routes');
const { errorMiddleware } = require('../../../middleware/error.middleware');
const { AuthService } = require('../../../services/auth.service');

class FakeUsers {
  constructor() {
    this.users = [];
  }

  async create(data) {
    if (this.users.some((u) => u.email === data.email)) {
      return null;
    }
    const user = { id: `u${this.users.length + 1}`, tier: 'free', createdAt: new Date(), ...data };
    this.users.push(user);
    return user;
  }

  async findByEmail(email) {
    return this.users.find((u) => u.email === email) || null;
  }

  async findById(id) {
    return this.users.find((u) => u.id === id) || null;
  }
}

describe('auth routes', () => {
  let server;
  let baseUrl;

  async function call(method, path, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body && JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }

  beforeEach(async () => {
    const authService = new AuthService({ users: new FakeUsers(), jwtSecret: 'test-secret', bcryptRounds: 4 });
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter({ authService, rateLimit: (req, res, next) => next() }));
    app.use(errorMiddleware);
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(() => new Promise((resolve) => server.close(resolve)));

  const account = { email: 'player@example.com', password: 'correct horse', ageConfirmed: true };

  test('register -> me -> login', async () => {
    const registered = await call('POST', '/api/auth/register', account);
    expect(registered.status).toBe(201);
    expect(registered.body.user.email).toBe('player@example.com');

    const me = await call('GET', '/api/auth/me', undefined, registered.body.token);
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(registered.body.user.id);

    const login = await call('POST', '/api/auth/login', { email: account.email, password: account.password });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeDefined();
  });

  test('status codes for bad input', async () => {
    expect((await call('POST', '/api/auth/register', { ...account, password: 'short' })).status).toBe(400);

    await call('POST', '/api/auth/register', account);
    const duplicate = await call('POST', '/api/auth/register', account);
    expect(duplicate.status).toBe(409);

    const badLogin = await call('POST', '/api/auth/login', { email: account.email, password: 'wrong password' });
    expect(badLogin.status).toBe(401);
    expect(badLogin.body.error).toBe('Invalid email or password');
    expect(badLogin.body).not.toHaveProperty('token');
  });

  test('me requires a valid token', async () => {
    expect((await call('GET', '/api/auth/me')).status).toBe(401);
    expect((await call('GET', '/api/auth/me', undefined, 'garbage')).status).toBe(401);
  });
});
