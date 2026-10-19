// ============================================================================
// FILE: frontend/src/components/safeguards/WelcomeScreen.jsx
// First-run screen that sets expectations (docs/phase1-responsible-mvp.md)
// ============================================================================

const ACK_KEY = 'companion.welcomeAcknowledged';

export function hasAcknowledgedWelcome() {
  try {
    return localStorage.getItem(ACK_KEY) === 'true';
  } catch {
    return false;
  }
}

function acknowledgeWelcome() {
  try {
    localStorage.setItem(ACK_KEY, 'true');
  } catch {
    // Storage unavailable: the welcome screen will simply show again next time
  }
}

const EXPECTATIONS = [
  "I'm an AI assistant, not a human",
  "I can't replace real friendships",
  'I encourage healthy gaming habits',
  "I'll celebrate your wins and support you through losses"
];

export default function WelcomeScreen({ onContinue }) {
  const handleContinue = () => {
    acknowledgeWelcome();
    onContinue();
  };

  return (
    <section className="card welcome" aria-labelledby="welcome-title">
      <h1 id="welcome-title">Welcome to Your Gaming Companion</h1>
      <p>
        I'm here to help you improve at League and make gaming more enjoyable
        and less lonely.
      </p>

      <h2>A few things to know</h2>
      <ul className="checklist">
        {EXPECTATIONS.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <p>
        <strong>My goal:</strong> help you grow as a player while maintaining
        balance in life.
      </p>

      <button type="button" className="button primary" onClick={handleContinue}>
        Let's Get Started
      </button>

      <p className="fine-print">
        I'm not a therapist or a crisis service. If you're struggling, you can
        call or text <strong>988</strong> (US) any time.
      </p>
    </section>
  );
}
