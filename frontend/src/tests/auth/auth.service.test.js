import { fetchCurrentUser, login, logout } from '../../services/auth.service.js';
import { getToken } from '../../services/api.js';

function respond(status, body) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

describe('auth.service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores the token on login and clears it on logout', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(200, { token: 'abc', user: { id: 'u1' } })));

    expect(await login({ email: 'a@example.com', password: 'pw' })).toEqual({ id: 'u1' });
    expect(getToken()).toBe('abc');

    logout();
    expect(getToken()).toBeNull();
  });

  it('skips the network when no token is saved', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchCurrentUser()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops an expired token', async () => {
    localStorage.setItem('companion.authToken', 'expired');
    vi.stubGlobal('fetch', vi.fn(() => respond(401, { error: 'Token expired' })));

    expect(await fetchCurrentUser()).toBeNull();
    expect(getToken()).toBeNull();
  });

  it('sends the saved token to /auth/me', async () => {
    localStorage.setItem('companion.authToken', 'good');
    const fetchMock = vi.fn(() => respond(200, { user: { id: 'u1' } }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchCurrentUser()).toEqual({ id: 'u1' });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer good');
  });
});
