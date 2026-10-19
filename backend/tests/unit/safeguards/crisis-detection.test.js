const {
  detectCrisis,
  buildSafeguardResponse
} = require('../../../services/safeguards/crisis-detection.service');

describe('detectCrisis', () => {
  test.each([
    'I want to die',
    'honestly i just wanna die',
    'I’ve been thinking about killing myself',
    'I feel suicidal',
    "I don't want to live anymore",
    'sometimes I think about self-harm',
    'no one would miss me',
    'I want to END IT ALL'
  ])('flags crisis language: %s', (text) => {
    expect(detectCrisis(text).level).toBe('crisis');
  });

  test.each([
    'I hate myself for that throw',
    'nobody cares about me',
    "I'm so alone",
    'i feel worthless'
  ])('flags distress language: %s', (text) => {
    expect(detectCrisis(text).level).toBe('distress');
  });

  test.each([
    'What should I build against this team?',
    'I died to the jungler three times',
    'how do I kill the dragon faster',
    "I'm going to die in this lane matchup, any tips?",
    'nobody warded river',
    ''
  ])('ignores ordinary gaming talk: %s', (text) => {
    expect(detectCrisis(text).level).toBe('none');
  });

  test('handles missing input', () => {
    expect(detectCrisis(undefined).level).toBe('none');
    expect(detectCrisis(null).level).toBe('none');
  });
});

describe('buildSafeguardResponse', () => {
  test('crisis ends the conversation and includes 988', () => {
    const response = buildSafeguardResponse('crisis');
    expect(response.conversationEnded).toBe(true);
    expect(response.resources.map((r) => r.contact).join(' ')).toContain('988');
  });

  test('distress keeps the conversation open with resources', () => {
    const response = buildSafeguardResponse('distress');
    expect(response.conversationEnded).toBe(false);
    expect(response.resources.length).toBeGreaterThan(0);
  });
});
