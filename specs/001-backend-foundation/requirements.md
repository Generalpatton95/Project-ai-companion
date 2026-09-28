# 001 — Backend Foundation: Requirements

**Status:** Approved (2026-09-28)
**Related docs:** `docs/setup-guide.md`, `docs/agentic-ai-tech-spec.md`

## Introduction
The backend was just reset to a minimal Express server using ES modules (`"type": "module"`).
The rest of `backend/` (config, logger, middleware, agents, integrations) still uses CommonJS
`require()`, and about 90 scaffold files are empty. This spec defines the baseline that every later
feature builds on: a server that starts reliably, reads validated config, logs safely, returns
consistent errors, and has a working test harness. It adds **no product features**.

## Requirements

### R1 — Server startup & configuration
**User story:** As a developer, I want the server to load its configuration from one place and fail fast when something is wrong, so that misconfiguration shows up at startup instead of mid-request.

**Acceptance criteria**
- R1.1 — The system shall load all configuration from environment variables (via `.env` in development) through a single config module.
- R1.2 — The system shall listen on the port given by `PORT`, defaulting to 3001.
- R1.3 — IF a required configuration value is missing or invalid at startup, THEN the system shall log which key is wrong (never its value) and exit with a non-zero code.
- R1.4 — Only config needed by *implemented* features shall be required. Keys for unbuilt features (Riot, Anthropic, Redis, DB, JWT) shall be optional until the spec that uses them makes them required.
- R1.5 — The system shall provide a `backend/.env.example` listing every config key with a comment and no real secrets.

### R2 — HTTP baseline
**User story:** As an API client, I want predictable JSON responses for health, unknown routes, and bad input, so that the frontend can handle every case the same way.

**Acceptance criteria**
- R2.1 — WHEN `GET /health` is requested, the system shall respond 200 with `{ status, service, timestamp, uptime }`.
- R2.2 — WHEN `GET /api/v1/status` is requested, the system shall respond 200 with the API version and status.
- R2.3 — WHEN a request targets an unknown route, the system shall respond 404 with `{ error: { code: "NOT_FOUND", message } }`.
- R2.4 — IF a request body is malformed JSON, THEN the system shall respond 400 with `{ error: { code: "INVALID_JSON", message } }`.
- R2.5 — The system shall accept cross-origin requests only from origins listed in config (`CORS_ORIGINS`).
- R2.6 — The system shall reject JSON request bodies larger than a configured limit (default 100 kb) with a 413.

### R3 — Error handling
**User story:** As a user, I want errors to be clear without exposing internals, so that I'm never shown stack traces or sensitive details.

**Acceptance criteria**
- R3.1 — The system shall return all errors in one shape: `{ error: { code, message } }`.
- R3.2 — The system shall provide typed application errors (e.g. `ValidationError` → 400, `NotFoundError` → 404, `UnauthorizedError` → 401) that route handlers can throw.
- R3.3 — IF an unexpected error occurs, THEN the system shall respond 500 with a generic message and shall not include the error message or stack trace in the response.
- R3.4 — WHEN any 5xx error occurs, the system shall log it with the stack trace and request method and path.
- R3.5 — The system shall catch errors thrown from async route handlers and route them to the error handler.

### R4 — Logging
**User story:** As a developer, I want structured logs that are safe by default, so that I can debug without leaking user data or secrets.

**Acceptance criteria**
- R4.1 — The system shall log through one logger module with levels `error`, `warn`, `info` and `debug`.
- R4.2 — The system shall log each request's method, path, status code and duration.
- R4.3 — The system shall never log request bodies, auth headers, API keys or config secrets.
- R4.4 — WHILE `NODE_ENV=test`, the system shall suppress log output below `error`.

### R5 — Module system consistency
**User story:** As a developer, I want the whole backend to use one module system, so that importing any file never crashes the server.

**Acceptance criteria**
- R5.1 — Every non-empty `.js` file in `backend/` that is kept shall use ES module syntax (`import`/`export`).
- R5.2 — Empty placeholder files shall be deleted. A later spec recreates a file when it needs one.
- R5.3 — Files whose code belongs to a later spec (agents, integrations, auth, rate limiting) shall be converted to ESM but not wired into the server. They shall not block startup.
- R5.4 — Stray or learning files (`backend/express-basics.js`) shall be removed from `backend/`.

### R6 — Test harness
**User story:** As a developer, I want a working test setup, so that every later spec can prove its acceptance criteria.

**Acceptance criteria**
- R6.1 — `npm test` in `backend/` shall run all tests and exit non-zero on any failure.
- R6.2 — The Express app shall be exported separately from the code that calls `listen()`, so tests can make HTTP requests without opening a port.
- R6.3 — Every acceptance criterion in R2 and R3 shall have at least one automated test named with its ID.

## Non-functional requirements
- NFR1 — The server shall start in under 2 seconds on a dev machine with no external services running.
- NFR2 — No secrets shall be committed. `.env` stays gitignored (it is today).

## Out of scope
- Database, Redis, authentication, rate limiting, the Claude API and the Riot API (each gets its own spec)
- Agent orchestration
- Frontend changes
- Docker, deployment and CI

## Decisions (resolved 2026-09-28)
- **D1 — Test runner:** Vitest + Supertest.
- **D2 — File logging:** Console only; file transports deferred to a later ops spec.
- **D3 — Anthropic SDK version:** Left as is; updated in spec 010.
- **D4 — Language:** JavaScript with JSDoc types where helpful.
