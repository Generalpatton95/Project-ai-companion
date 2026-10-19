// ============================================================================
// FILE: frontend/src/pages/Home.jsx
// Session flow: welcome -> mood check-in -> play (with break reminders)
// -> post-session check-in
// ============================================================================

import { useState } from 'react';
import WelcomeScreen, { hasAcknowledgedWelcome } from '../components/safeguards/WelcomeScreen.jsx';
import MoodCheckIn from '../components/safeguards/MoodCheckIn.jsx';
import BreakReminder from '../components/safeguards/BreakReminder.jsx';
import { usePlaySession } from '../hooks/usePlaySession.js';
import { formatDuration } from '../utils/formatters.js';

export default function Home({ heartbeatMs }) {
  const [step, setStep] = useState(() => (hasAcknowledgedWelcome() ? 'pre-mood' : 'welcome'));
  const [summary, setSummary] = useState(null);
  const { session, error, start, snooze, end } = usePlaySession({ heartbeatMs });

  const beginSession = async () => {
    const status = await start();
    if (status) {
      setStep('playing');
    }
  };

  const finishSession = async () => {
    const result = await end();
    setSummary(result);
    setStep('post-mood');
  };

  if (step === 'welcome') {
    return <WelcomeScreen onContinue={() => setStep('pre-mood')} />;
  }

  if (step === 'pre-mood') {
    return (
      <>
        <MoodCheckIn phase="pre" onComplete={beginSession} />
        {error && (
          <p className="error" role="alert">
            Couldn't start your session. Check your connection and try again.
          </p>
        )}
      </>
    );
  }

  if (step === 'playing') {
    return (
      <>
        <section className="card session" aria-labelledby="session-title">
          <h2 id="session-title">Session in progress</h2>
          <p className="muted">
            {session ? `Playing for ${formatDuration(session.elapsedMinutes)}` : 'Session ended'}
          </p>
          <button type="button" className="button ghost" onClick={finishSession}>
            End session
          </button>
        </section>
        {session && (
          <BreakReminder
            reminder={session.reminder}
            elapsedMinutes={session.elapsedMinutes}
            onSnooze={snooze}
            onEndSession={finishSession}
          />
        )}
      </>
    );
  }

  if (step === 'post-mood') {
    return (
      <>
        {summary && summary.elapsedMinutes !== undefined && (
          <p className="muted">You played for {formatDuration(summary.elapsedMinutes)}.</p>
        )}
        <MoodCheckIn phase="post" onComplete={() => setStep('done')} />
      </>
    );
  }

  return (
    <section className="card" aria-labelledby="done-title">
      <h2 id="done-title">Nice session</h2>
      <p>Take a few minutes away from the screen before your next one.</p>
      <button type="button" className="button primary" onClick={() => setStep('pre-mood')}>
        Start another session
      </button>
    </section>
  );
}
