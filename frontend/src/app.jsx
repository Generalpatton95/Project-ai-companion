import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Home from './pages/Home.jsx';
import Chat from './pages/Chat.jsx';
import Login from './pages/Login.jsx';

const TABS = [
  { id: 'session', label: 'Session' },
  { id: 'chat', label: 'Chat' }
];

function Shell() {
  const { user, status, logout, retry } = useAuth();
  const [tab, setTab] = useState('session');

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
      <nav className="tabs" aria-label="Main">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="tab"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {/* Both stay mounted so the play session keeps sending heartbeats while chatting */}
      <div hidden={tab !== 'session'}>
        <Home />
      </div>
      <div hidden={tab !== 'chat'}>
        <Chat />
      </div>
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
