import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';

function Shell() {
  const { user, status, logout, retry } = useAuth();

  if (status === 'loading') {
    return <p className="muted" role="status">Loading…</p>;
  }

  if (status === 'error') {
    return (
      <section className="card" role="alert">
        <p>Couldn't reach the server.</p>
        <button type="button" className="button primary" onClick={retry}>
          Try again
        </button>
      </section>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <>
      <header className="app-header">
        <span>
          Signed in as <strong>{user.displayName}</strong>
        </span>
        <button type="button" className="link-button" onClick={logout}>
          Sign out
        </button>
      </header>
      <Home />
    </>
  );
}

export default function App() {
  return (
    <main className="app">
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </main>
  );
}
