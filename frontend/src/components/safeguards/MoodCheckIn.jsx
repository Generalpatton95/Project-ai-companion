// ============================================================================
// FILE: frontend/src/components/safeguards/MoodCheckIn.jsx
// Before/after session mood selector
// ============================================================================

import { useState } from 'react';
import { recordMood } from '../../services/safeguards.service.js';
import SupportResources from './SupportResources.jsx';

const MOODS = [
  { value: 'good', emoji: '😊', label: 'Feeling good' },
  { value: 'okay', emoji: '😐', label: 'Okay' },
  { value: 'low', emoji: '😔', label: 'Not great' }
];

const QUESTIONS = {
  pre: 'How are you feeling?',
  post: 'How was that session for you?'
};

const ACKNOWLEDGEMENTS = {
  good: "Love that! Let's make the most of it.",
  okay: "Got it. Let's keep things steady.",
  low: "Thanks for telling me. It's okay to feel frustrated or down - I'll keep things encouraging."
};

export default function MoodCheckIn({ phase, onComplete }) {
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const choose = async (mood) => {
    setSelected(mood);
    setSaving(true);
    setError(null);
    try {
      setResult(await recordMood(phase, mood));
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const done = selected && !saving;

  return (
    <section className="card mood" aria-labelledby={`mood-${phase}-title`}>
      <h2 id={`mood-${phase}-title`}>{QUESTIONS[phase]}</h2>

      <div className="mood-options" role="group" aria-label="Choose your mood">
        {MOODS.map((mood) => (
          <button
            key={mood.value}
            type="button"
            className="mood-option"
            aria-pressed={selected === mood.value}
            disabled={saving || Boolean(done)}
            onClick={() => choose(mood.value)}
          >
            <span className="mood-emoji" aria-hidden="true">{mood.emoji}</span>
            {mood.label}
          </button>
        ))}
      </div>

      {done && (
        <div className="mood-response" role="status">
          <p>{ACKNOWLEDGEMENTS[selected]}</p>
          {error && <p className="muted">I couldn't save this check-in, but that's okay.</p>}
          {result && result.support && (
            <SupportResources
              message={result.support.message}
              resources={result.support.resources}
            />
          )}
        </div>
      )}

      <div className="actions">
        {done ? (
          <button type="button" className="button primary" onClick={() => onComplete(result)}>
            Continue
          </button>
        ) : (
          <button
            type="button"
            className="button ghost"
            disabled={saving}
            onClick={() => onComplete(null)}
          >
            Skip for now
          </button>
        )}
      </div>
    </section>
  );
}
