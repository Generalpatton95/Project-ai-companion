// ============================================================================
// FILE: backend/services/safeguards/messages.js
// User-facing safeguard copy (see docs/phase1-responsible-mvp.md)
// ============================================================================

const CRISIS_RESOURCES = [
  { name: '988 Suicide & Crisis Lifeline (US)', contact: 'Call or text 988' },
  { name: 'Crisis Text Line', contact: 'Text HOME to 741741' },
  {
    name: 'International Association for Suicide Prevention',
    contact: 'https://www.iasp.info/resources/Crisis_Centres/'
  }
];

const CRISIS_MESSAGE =
  "I hear that you're really struggling, and I'm glad you felt you could share " +
  "that with me. But I need to be honest - I'm an AI gaming assistant, and what " +
  "you're describing is beyond what I can help with. This sounds like something " +
  'you should talk to a real person about. Please reach out to someone who can ' +
  'truly support you. Your life matters.';

const DISTRESS_MESSAGE =
  "It sounds like you're going through something hard right now, and that's " +
  "more important than any game. I'm an AI, so I can't give you the support you " +
  'deserve - but talking to someone you trust really can help. If things feel ' +
  'heavy, these people are there to listen any time.';

const LOW_MOOD_MESSAGE =
  "I'm noticing you've been struggling lately. That's okay - but it might help " +
  'to talk to someone you trust about how you\'ve been feeling.';

const BREAK_REMINDER = {
  level: 'break',
  title: "You've been playing for a while!",
  message:
    'Remember to stretch and move around, drink some water, take a 10-minute ' +
    'break, and check in with real-world responsibilities.'
};

const WRAP_UP_REMINDER = {
  level: 'wrap_up',
  title: "That's a solid session!",
  message:
    'Time to wrap up and do something else. Your brain needs rest to ' +
    'consolidate what you learned.'
};

const FREE_LIMIT_MESSAGE =
  "You've used all of today's analyses. Let what you learned sink in, and come " +
  'back tomorrow ready to apply it.';

const SOFT_LIMIT_MESSAGE =
  "Whoa, that's a lot of analyzing! I'm impressed by your dedication, but your " +
  'brain might be getting overloaded. How about we call it for today? Let what ' +
  'you learned sink in, and come back tomorrow ready to apply it. Quality > ' +
  'quantity when it comes to improvement!';

module.exports = {
  CRISIS_RESOURCES,
  CRISIS_MESSAGE,
  DISTRESS_MESSAGE,
  LOW_MOOD_MESSAGE,
  BREAK_REMINDER,
  WRAP_UP_REMINDER,
  FREE_LIMIT_MESSAGE,
  SOFT_LIMIT_MESSAGE
};
