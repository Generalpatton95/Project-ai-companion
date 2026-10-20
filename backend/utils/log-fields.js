// ============================================================================
// FILE: backend/utils/log-fields.js
// Safe error fields for log calls
// ============================================================================

/**
 * The parts of an error that are safe to log: its name, code and HTTP status.
 * Messages, details, stacks and response bodies from Postgres, Redis, Claude
 * or Riot can carry the values that were sent, so they are never returned.
 */
function errorFields(err) {
  if (!err) {
    return {};
  }

  const fields = {
    errorName: err.name,
    errorCode: err.code,
    status: err.status ?? err.statusCode
  };

  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

module.exports = { errorFields };
