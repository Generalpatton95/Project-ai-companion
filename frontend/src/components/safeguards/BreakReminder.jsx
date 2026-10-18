// ============================================================================
// FILE: frontend/src/components/safeguards/BreakReminder.jsx
// Healthy gaming reminder shown during long sessions (Safeguard 1)
// ============================================================================

import { formatDuration } from '../../utils/formatters.js';

export const SNOOZE_MINUTES = 30;

export default function BreakReminder({ reminder, elapsedMinutes, onSnooze, onEndSession }) {
  if (!reminder) {
    return null;
  }

  const wrapUp = reminder.level === 'wrap_up';

  return (
    <section
      className={`card reminder ${wrapUp ? 'reminder-wrap-up' : ''}`}
      role="alert"
      aria-labelledby="reminder-title"
    >
      <h2 id="reminder-title">{reminder.title}</h2>
      <p>{reminder.message}</p>
      <p className="muted">You've been playing for {formatDuration(elapsedMinutes)}.</p>

      <div className="actions">
        <button type="button" className="button primary" onClick={onEndSession}>
          {wrapUp ? 'Wrap up for today' : 'Take a break'}
        </button>
        <button type="button" className="button ghost" onClick={() => onSnooze(SNOOZE_MINUTES)}>
          Remind me in {SNOOZE_MINUTES} min
        </button>
      </div>
    </section>
  );
}
