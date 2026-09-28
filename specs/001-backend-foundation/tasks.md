# 001 — Backend Foundation: Tasks

**Status:** Done (2026-09-28)
**Design:** ./design.md (Approved 2026-09-28)

Each task is small enough to finish and test in one sitting. Check it off only when its tests pass.
Work happens in `backend/`. Test titles start with the criterion ID they cover.

- [x] 1. Test harness and dependencies — _covers R6.1, R6.2 (setup)_
  - [x] 1.1 Remove `jest`, add `vitest` and `supertest` (dev), upgrade `express` to `^5`
  - [x] 1.2 Add `vitest.config.js` (node environment, `tests/**/*.test.js`, sets `NODE_ENV=test`)
  - [x] 1.3 Scripts: `"test": "vitest run"`, `"test:watch": "vitest"`
  - [x] 1.4 Add one trivial passing test, then run `npm test` → exit 0; temporarily make it fail → exit 1 (record the result in the Verification section; R6.1). Remove the trivial test.

- [x] 2. Clean out dead files — _covers R5.2, R5.4_
  - [x] 2.1 Delete every empty file under `backend/` (outside `node_modules`)
  - [x] 2.2 Delete `express-basics.js` and `setup-files.js`
  - [x] 2.3 Keep the `agent/orhestrator.js` deletion

- [x] 3. Typed errors — _covers R3.2_
  - [x] 3.1 Write `tests/unit/errors.test.js`: each subclass has the right status/code, is `instanceof AppError`; `ConfigError` carries `keys`
  - [x] 3.2 Implement `utils/errors.js`

- [x] 4. Config loader — _covers R1.1, R1.2, R1.3 (unit), R1.4_
  - [x] 4.1 Write `tests/unit/config.test.js`: defaults (incl. `PORT` 3001, per-env `LOG_LEVEL` and `CORS_ORIGINS`), parsing of CSV origins and body limit, optional keys pass through, multiple bad keys all reported, error message contains key names but never values, result is frozen
  - [x] 4.2 Implement `loadConfig(env)` in `config/index.js`

- [x] 5. `.env.example` — _covers R1.5_
  - [x] 5.1 Add a test to `config.test.js`: every key in the design's config table appears in `.env.example`
  - [x] 5.2 Write `backend/.env.example` with placeholders and one-line comments

- [x] 6. Logger and request logging — _covers R4.1–R4.4_
  - [x] 6.1 Write `tests/unit/logger.test.js` with a capturing transport: levels exist; request line has method, path, status, durationMs; no body, `authorization` header or query string; `info` suppressed under test level
  - [x] 6.2 Implement `utils/logger.js` (`createLogger(config)` + default `logger`)
  - [x] 6.3 Implement `middleware/request-logger.js`

- [x] 7. App factory, middleware and routes — _covers R2.1–R2.6, R3.1, R3.3–R3.5_
  - [x] 7.1 Write `tests/integration/app.test.js` (Supertest against `createApp(testConfig)`), including test-only routes that throw `ValidationError`, throw a plain `Error` and reject asynchronously; assert 500 bodies contain no internal message or stack, and that a 5xx is logged with stack, method and path
  - [x] 7.2 Implement `middleware/not-found.js` and `middleware/error-handler.js`; delete `middleware/error.middleware.js`
  - [x] 7.3 Implement `routes/health.routes.js`
  - [x] 7.4 Implement `app.js` with the middleware order from the design

- [x] 8. Entry point — _covers R1.3 (startup), NFR1_
  - [x] 8.1 Write `tests/integration/startup.test.js`: `PORT=abc` → non-zero exit, stderr names `PORT` but not `abc`; valid config → "listening" log within 2 s, then kill the process
  - [x] 8.2 Rewrite `server.js` as in the design

- [x] 9. Convert remaining modules to ESM — _covers R5.1, R5.3_
  - [x] 9.1 Write `tests/integration/esm.test.js`: no `require(` / `module.exports` / `exports.` in any backend `.js` file; every file passes `node --check`; deleted files are gone
  - [x] 9.2 Convert `agent/`, `tools/`, `integrations/`, `config/redis.js`, `middleware/auth.middleware.js`, `middleware/rate-limit.middleware.js`, `controllers/agent.controller.js` and `routes/agent.routes.js` with logic unchanged; confirm `app.js` imports none of them

- [x] 10. Checkpoint — ask Austin to review the diff and approve a commit

## Implementation notes
- `createApp(config, { logger, routes })` takes an optional `routes` array of extra routers mounted before the 404 handler. Tests use it to add routes that throw errors.
- Converted modules whose config fields no longer exist carry `TODO(spec NNN)` comments: `config/redis.js` (host/port/password), `integrations/claude.js` (maxTokens), `integrations/riot-games.js` (`riotGames` → `riot`). These modules aren't wired in; the spec that wires each one fixes it.
- `middleware/rate-limit.middleware.js` imported config without using it; that import was dropped.
- Cleanup also deleted the empty `backend/.env.example` (recreated in task 5) and an empty local `backend/.env` (gitignored).

## Verification
- [x] Every acceptance criterion (R1.1–R6.3) maps to a passing test, or to the manual check recorded here
  - R1.1–R1.5 → `unit/config.test.js`, `integration/startup.test.js` · R2.1–R2.6, R3.1, R3.3–R3.5 → `integration/app.test.js` · R3.2 → `unit/errors.test.js` · R4.1–R4.4 → `unit/logger.test.js` · R5.1–R5.4 → `integration/esm.test.js` · R6.1 → manual check below · R6.2 → `app.test.js` runs `createApp()` with no port · R6.3 → every test title starts with its ID · NFR1 → `startup.test.js`
- [x] R6.1 manual check: failing test → `npm test` exit code 1 (passing → 0), 2026-09-28
- [x] `npm test` passes: 117 tests, 2026-09-28
- [x] `npm start` serves `/health` and `/api/v1/status` locally. Smoke-checked 2026-09-28: also saw 404 `NOT_FOUND` and 400 `INVALID_JSON`, and one request log line per call.
- [x] Spec status set to `Done` and BACKLOG updated
