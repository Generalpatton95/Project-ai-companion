// ============================================================================
// FILE: frontend/src/pages/Login.jsx
// Sign in / create account
// ============================================================================

import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const PASSWORD_MIN_LENGTH = 8;

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const isRegister = mode === 'register';

  const switchMode = () => {
    setMode(isRegister ? 'login' : 'register');
    setError(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (isRegister) {
        await register({ email, password, displayName, ageConfirmed });
      } else {
        await login({ email, password });
      }
    } catch (err) {
      setError(err.status ? err.message : "Couldn't reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  };

  return (
    <section className="card auth" aria-labelledby="auth-title">
      <h1 id="auth-title">{isRegister ? 'Create your account' : 'Sign in'}</h1>

      <form className="form" onSubmit={handleSubmit}>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <div className="field">
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            required
            minLength={isRegister ? PASSWORD_MIN_LENGTH : undefined}
            aria-describedby={isRegister ? 'password-hint' : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {isRegister && (
            <small id="password-hint" className="muted">At least {PASSWORD_MIN_LENGTH} characters</small>
          )}
        </div>

        {isRegister && (
          <>
            <label className="field">
              <span>Display name <span className="muted">(optional)</span></span>
              <input
                type="text"
                autoComplete="nickname"
                maxLength={40}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>

            <label className="checkbox">
              <input
                type="checkbox"
                required
                checked={ageConfirmed}
                onChange={(e) => setAgeConfirmed(e.target.checked)}
              />
              <span>I'm 13 or older</span>
            </label>
          </>
        )}

        {error && <p className="error" role="alert">{error}</p>}

        <button type="submit" className="button primary" disabled={submitting}>
          {submitting ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p className="muted">
        {isRegister ? 'Already have an account?' : 'New here?'}{' '}
        <button type="button" className="link-button" onClick={switchMode}>
          {isRegister ? 'Sign in' : 'Create an account'}
        </button>
      </p>
    </section>
  );
}
