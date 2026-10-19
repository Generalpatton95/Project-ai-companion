// ============================================================================
// FILE: backend/services/safeguards/crisis-detection.service.js
// Crisis keyword detection (Safeguard 2)
//
// Two severities:
//   crisis   - self-harm / suicide language. The agent is not called and the
//              client is told to end normal chat.
//   distress - hopelessness / isolation language. The agent is not called for
//              that message, resources are shown, but chat can continue.
// Matching errs toward caution: a hyperbolic "I'd kill myself" still triggers.
// ============================================================================

const {
  CRISIS_RESOURCES,
  CRISIS_MESSAGE,
  DISTRESS_MESSAGE
} = require('./messages');

const CRISIS_PATTERNS = [
  /\b(want|wanna|wish)( to)? (die|be dead)\b/,
  /\bwish i (was|were) dead\b/,
  /\bkill(ing)? myself\b/,
  /\bsuicid(e|al)\b/,
  /\bend (my life|it all)\b/,
  /\b(don't|do not) want to (live|be alive|exist|be here anymore)\b/,
  /\bno (reason|point) (to|in) (live|living)\b/,
  /\bbetter off dead\b/,
  /\bself[- ]?harm(ing)?\b/,
  /\b(hurt|hurting|cut|cutting) myself\b/,
  /\bno ?one would (miss|care if) me\b/,
  /\bnobody would (miss|care if) me\b/
];

const DISTRESS_PATTERNS = [
  /\bhate myself\b/,
  /\b(nobody|no ?one) (cares|loves me)\b/,
  /\b(i'm|i am|i feel) (so |completely |totally )?(alone|worthless|hopeless)\b/
];

function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check free text for crisis or distress language.
 * Returns { level: 'none' | 'distress' | 'crisis' }.
 */
function detectCrisis(text) {
  if (!text) {
    return { level: 'none' };
  }

  const normalized = normalize(text);

  if (CRISIS_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { level: 'crisis' };
  }

  if (DISTRESS_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { level: 'distress' };
  }

  return { level: 'none' };
}

/**
 * Build the response sent to the client in place of an agent answer.
 */
function buildSafeguardResponse(level) {
  if (level === 'crisis') {
    return {
      safeguard: 'crisis',
      message: CRISIS_MESSAGE,
      resources: CRISIS_RESOURCES,
      conversationEnded: true
    };
  }

  return {
    safeguard: 'distress',
    message: DISTRESS_MESSAGE,
    resources: CRISIS_RESOURCES,
    conversationEnded: false
  };
}

module.exports = { detectCrisis, buildSafeguardResponse };
