// ============================================================================
// FILE: backend/services/safeguards/index.js
// Mental-health safeguards (see docs/phase1-responsible-mvp.md)
// ============================================================================

const { detectCrisis, buildSafeguardResponse } = require('./crisis-detection.service');
const { MoodService } = require('./mood.service');
const { UsageService } = require('./usage.service');
const { SessionService } = require('./session.service');

module.exports = {
  detectCrisis,
  buildSafeguardResponse,
  MoodService,
  UsageService,
  SessionService
};
