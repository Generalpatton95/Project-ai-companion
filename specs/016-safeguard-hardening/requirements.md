# 016 — Safeguard Hardening: Requirements

**Status:** Approved (2026-10-19; R4.4, R4.5, R8 added and approved the same day; R2.4, R4.6 added after review round 1, approved 2026-10-19)
**Related docs:** `docs/phase1-responsible-mvp.md` (Safeguard 6: usage limits), user-level security standards (public endpoints fail closed; logs carry no user content)

## Introduction
The review of PR #9 found that several protections switch themselves off when the service behind them fails, and that some logs can capture what users type. On a companion app where users may share distress, both have to be fixed before any public release.

When Redis is down, the login and registration rate limit lets every request through, so nothing limits password guessing. The daily analysis limit (Safeguard 6) does the same when its store is down. The agent controller logs the user's raw query, and about 20 error logs record raw `error.message` from Postgres, Claude, Redis and Riot. Those messages can carry the values that were sent. This spec makes each check refuse the request when it can't run, keeps user content out of logs, and fixes three smaller correctness issues found in the same files.

## Requirements

### R1 — Public rate limit fails closed
**User story:** As the owner, I want login and registration to refuse requests when the rate limit can't be checked, so that an outage can't be used to brute-force accounts.

**Acceptance criteria**
- R1.1 — IF the IP rate limiter cannot read or update its counter, THEN the system shall respond `503` with `{ "error": "Service temporarily unavailable. Please try again shortly." }` and a `Retry-After` header, and shall not run the login or registration handler.
- R1.2 — IF the rate-limit store is unreachable, THEN the system shall respond within 2 seconds rather than waiting through the client's full retry cycle.
- R1.3 — WHEN R1.1 happens, the system shall log only an event name and an error code (no IP, no request body, no `error.message`).

### R2 — Signed-in rate limits fail closed
**User story:** As the owner, I want the query, analysis and chat limits to hold during an outage, so that cost and usage controls can't be bypassed.

**Acceptance criteria**
- R2.1 — IF the per-user rate limiter cannot read or update its counter, THEN the system shall respond `503` as in R1.1 and shall not run the handler.
- R2.2 — IF R2.1 happens on the chat endpoint, THEN the response shall also include `resources: CRISIS_RESOURCES` (the existing list in `services/safeguards/messages.js`), and the chat screen shall show them, so that a user who is struggling during an outage still sees where to get help.
- R2.3 — The time and logging limits in R1.2 and R1.3 shall also apply here.
- R2.4 — WHEN a user goes over the chat rate limit (429), the response shall include `resources: CRISIS_RESOURCES` and the chat screen shall show them, so that someone in a long crisis conversation is never cut off without help.

### R3 — Daily analysis limit fails closed (Safeguard 6)
**User story:** As a player, I want the daily analysis limit to always apply, so that the healthy-use safeguard is real rather than best-effort.

**Acceptance criteria**
- R3.1 — IF usage cannot be checked, THEN the system shall respond `503` and shall not start the analysis.
- R3.2 — IF recording a completed analysis fails, THEN the system shall log the event name and an error code only.

### R4 — No user content in logs
**User story:** As a player, I want what I type to stay out of server logs, so that private or crisis messages aren't stored where they shouldn't be.

**Acceptance criteria**
- R4.1 — The system shall not log request text: query, chat content, email, password or any other request-body field. That includes identifiers a user supplies for an outside service (e.g. summoner names) and identifiers that service returns (e.g. Riot PUUIDs).
- R4.2 — WHEN logging an error from Postgres, Redis, Claude or Riot, the system shall record only the error's name, code and HTTP status (where present) plus internal ids. It shall never record `error.message`, `error.detail` or response bodies.
- R4.3 — The system shall have an automated test that fails if a log call in `backend/` (excluding tests) passes `error.message` or a known request-text field.
- R4.4 — The system shall not log client IP addresses.
- R4.5 — IF an error that isn't one of the app's own error classes (those with a `statusCode`) reaches the error handler, THEN the system shall respond `500 { "error": "Internal server error" }` and shall not send the error's message to the client.
- R4.6 — IF a background analysis fails with an error that isn't one of the app's own error classes, THEN the task status shall report `The analysis couldn't be completed. Please try again.` and shall never store or return the error's message. Errors raised from an outside service's failure shall not carry that service's message.

### R5 — Missing query is a client error
**Acceptance criteria**
- R5.1 — WHEN `POST /api/agent/query` is called without a `query`, the system shall respond `400` using the existing `ValidationError`, not a `500`.

### R6 — Redis problems visible at startup
**Acceptance criteria**
- R6.1 — WHEN the server starts, the system shall try to connect to Redis and log success, or failure with an error code only.
- R6.2 — IF Redis is unreachable at startup, THEN the server shall still start, and the checks in R1–R3 shall fail closed until Redis recovers.
- R6.3 — Requiring `config/redis.js` from tests shall still not open a connection or keep Jest running.

### R7 — Bounded match-history requests
**Acceptance criteria**
- R7.1 — WHEN the game-API tool fetches match history, the system shall convert `count` to an integer, clamp it to 1–20 and default to 20 when it's missing or invalid.

### R8 — Remove the stale scaffolding script
**Acceptance criteria**
- R8.1 — The repository shall not contain `backend/setup-files.js` (an old generator holding outdated copies of modules, referenced nowhere).

## Non-functional requirements
- NFR1 — No new data is collected and no new outside service is used.
- NFR2 — Tests name the criterion IDs they cover (e.g. `test('R1.1: …')`).
- NFR3 — No change to crisis-detection wording or logic. R2.2 reuses the existing `CRISIS_RESOURCES` list, so no new mental-health review is needed (README rule 6). 

## Out of scope
- Moving rate limits to shared storage, `trust proxy`, and other deployment hardening (spec 015).
- Adding crisis screening to `/analyze` (it takes a `task_type`, not free text).
- Bringing the unmerged spec branches 001/002 in line with `main` (separate decision).

## Decisions (2026-10-19)
- D1 (was Q1): When chat can't check its rate limit, it answers 503 with `resources: CRISIS_RESOURCES` (R2.2).
- D2 (was Q2): This spec is numbered 016 and goes in `BACKLOG.md` as a hardening spec.
- D3 (was Q3): Match history is capped at 1–20, defaulting to 20 (R7.1).
- D4: Client IPs are no longer logged (R4.4).
- D5: Only the app's own errors send their message to clients (R4.5).
- D6: `backend/setup-files.js` is deleted (R8.1).
- D7 (review round 1): Failed analyses show a generic message (R4.6).
- D8 (review round 1): The chat 429 also includes crisis resources (R2.4).
- D9 (review round 1): The usage-limit race (simultaneous requests can pass the daily cap) goes to a follow-up spec, 017, not 016.
- D10 (screenshot sign-off): The crisis-resource web link uses the app's accent colour, so it can be read on the dark card (contrast 1.52:1 before, 5.76:1 after; light theme 4.56:1). The 503 and 429 screens are otherwise approved.
- D11 (screenshot sign-off): The wording of the limit and outage messages, and a line introducing the resources, go to a follow-up spec with a mental-health review (018), not 016.
