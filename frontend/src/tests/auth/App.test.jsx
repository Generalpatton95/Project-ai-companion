import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../app.jsx';
import * as authService from '../../services/auth.service.js';

vi.mock('../../services/auth.service.js', () => ({
  fetchCurrentUser: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn()
}));

vi.mock('../../services/chat.service.js', () => ({
  listConversations: vi.fn(() => Promise.resolve([]))
}));
vi.mock('../../services/safeguards.service.js', () => ({
  getMoodSummary: vi.fn(() => Promise.resolve({ latest: null }))
}));

const user = { id: 'u1', email: 'player@example.com', displayName: 'Player', tier: 'free' };

describe('App auth gate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authService.fetchCurrentUser.mockResolvedValue(null);
  });

  it('shows sign-in when there is no saved session', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('goes straight to the app with a valid saved session', async () => {
    authService.fetchCurrentUser.mockResolvedValue(user);
    render(<App />);
    expect(await screen.findByText('Player')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome to Your Gaming Companion' })).toBeInTheDocument();
  });

  it('switches between the session and chat tabs', async () => {
    authService.fetchCurrentUser.mockResolvedValue(user);
    render(<App />);

    await screen.findByText('Player');
    expect(screen.getByRole('heading', { name: 'Chat with your companion', hidden: true })).not.toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(screen.getByRole('heading', { name: 'Chat with your companion' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-current', 'page');
  });

  it('signs in, then signs out', async () => {
    authService.login.mockResolvedValue(user);
    render(<App />);

    await userEvent.type(await screen.findByLabelText('Email'), 'player@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(authService.login).toHaveBeenCalledWith({ email: 'player@example.com', password: 'correct horse' });
    expect(await screen.findByText('Player')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(authService.logout).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows the server error on a failed sign-in', async () => {
    authService.login.mockRejectedValue(Object.assign(new Error('Invalid email or password'), { status: 401 }));
    render(<App />);

    await userEvent.type(await screen.findByLabelText('Email'), 'player@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('creates an account with the age confirmation', async () => {
    authService.register.mockResolvedValue(user);
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: 'Create an account' }));
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Email'), 'player@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse');
    await userEvent.type(screen.getByLabelText(/Display name/), 'Player');
    await userEvent.click(screen.getByLabelText("I'm 13 or older"));
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(authService.register).toHaveBeenCalledWith({
      email: 'player@example.com',
      password: 'correct horse',
      displayName: 'Player',
      ageConfirmed: true
    });
    expect(await screen.findByText('Player')).toBeInTheDocument();
  });

  it('offers a retry when the server is unreachable', async () => {
    authService.fetchCurrentUser.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null);
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
