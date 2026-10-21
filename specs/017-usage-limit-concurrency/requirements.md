# 017 — Usage-Limit Concurrency: Requirements

**Status:** Approved (2026-10-21)
**Related docs:** `docs/phase1-responsible-mvp.md` (Safeguard 6: usage limits), `specs/016-safeguard-hardening/` (fail-closed checks, log hygiene), user-level security standards (checks fail closed; logs carry codes, not messages)

## Introduction
The spec 016 review found three problems that 016 left for later.

First, the daily analysis limit (Safeguard 6) can be passed. `usageLimitMiddleware` reads today's count, lets the request through if it is under the cap, and only adds one to the count after the `202` has been sent. Requests that arrive together all read the same count, so a free user who sends ten at once gets ten analyses, not five. The only thing stopping more is the 10-per-15-minutes rate limit.

Second, the Postgres pool has no time limits. While the database is unreachable or stuck, login, registration and chat wait without end instead of failing quickly.

Third, while Redis is down, ioredis raises an `error` event on every reconnect attempt, so the log gets a `Redis error` line about every 2 seconds. That buries the one line that matters, and it never says when Redis came back.

## Requirements

### R1 — The daily analysis limit holds under simultaneous requests (Safeguard 6)
**User story:** As a player, I want the daily limit to mean exactly what it says, so that the healthy-use safeguard can't be got around by sending several requests at once.

**Acceptance criteria**
- R1.1 — The system shall take an analysis slot and check it against the limit in one atomic step, before the analysis starts.
- R1.2 — WHEN any number of `POST /api/agent/analyze` requests from a free-tier user arrive at the same time, the system shall start at most 5 analyses for that user that day (UTC) and shall answer the rest `429` as it does today.
- R1.3 — WHEN a paid-tier user is at or over the soft limit of 10 and sends a request without `override`, the system shall answer `429` (overridable) and shall not use up a slot. WHEN the request has `override: true`, the system shall take a slot and set the `X-Safeguard-Usage-Reminder` header, as it does today.
- R1.4 — IF a request that took a slot ends with a status of `400` or above, or the client disconnects before a response is sent, THEN the system shall give the slot back exactly once.
- R1.5 — WHEN a slot is given back, the system shall return it to the same day it was taken from, even if midnight UTC has passed since then, and the count shall never go below 0.
- R1.6 — IF a slot can't be taken because Redis fails or doesn't answer in time, THEN the system shall answer `503` and shall not start the analysis (as R3.1 of 016). IF giving a slot back fails, THEN the system shall log the event name and an error code only, and the slot stays used.
- R1.7 — `GET /api/safeguards/usage` shall report today's count and limit without taking a slot.
- R1.8 — IF an analysis that was accepted (`202`) later fails, THEN the system shall give its slot back, as in R1.4 and R1.5.

### R2 — Postgres time limits
**User story:** As a player, I want login and chat to tell me quickly when the database is having trouble, instead of hanging.

**Acceptance criteria**
- R2.1 — IF a connection to Postgres can't be made within 2 seconds, THEN the system shall give up on that query.
- R2.2 — IF a query runs longer than 5 seconds, THEN Postgres shall cancel it. Database migrations (`npm run migrate`) shall not have this limit.
- R2.3 — IF a request fails because of R2.1 or R2.2, or because Postgres is unreachable, THEN the system shall answer `503` with the existing outage body and `Retry-After` header from 016 (`utils/unavailable.js`), not `500`.
- R2.4 — IF R2.3 happens on a chat endpoint, THEN the response shall also include `resources: CRISIS_RESOURCES`, as for chat's other `503` (016 D1), and the chat screen shall show them.
- R2.5 — WHEN R2.3 happens, the system shall log the event name, the error's name and code, the method and the path only (016 R4.2).
- R2.6 — A transaction that fails because of R2.1 or R2.2 shall be rolled back and its connection returned to the pool.

### R3 — Redis outages are logged once, with recovery
**User story:** As the owner, I want one clear log line when Redis goes down and one when it comes back, so that I can see outages without the noise.

**Acceptance criteria**
- R3.1 — WHEN Redis becomes unreachable, the system shall log `redis_unavailable` with the error's name and code once, and shall not log again for later reconnect failures in the same outage.
- R3.2 — WHEN Redis is reachable again after R3.1, the system shall log `redis_recovered` once, with how long the outage lasted in seconds and how many reconnect attempts failed.
- R3.3 — WHEN an error that isn't a connection failure happens while Redis is connected, the system shall still log it (name and code only).
- R3.4 — The startup log from 016 R6.1 (`redis_connected` / `redis_connect_failed`) shall stay as it is, and a failed startup connection shall count as the start of an outage for R3.2.

## Non-functional requirements
- NFR1 — No new data is collected and no new outside service is used.
- NFR2 — Tests name the criterion IDs they cover (e.g. `test('R1.2: …')`). R1.2 is tested against a real Redis in CI as well as with a fake store.
- NFR3 — No change to the wording of the limit, outage or crisis messages (that is spec 018). R2.4 reuses the existing `CRISIS_RESOURCES` list, so no new mental-health review is needed (README rule 6).
- NFR4 — The fail-closed behaviour from 016 stays: if a check can't run, the request is refused.

## Out of scope
- The per-15-minute rate limits (their atomic count already shipped in 016).
- Wording of the limit and outage messages (spec 018).
- Postgres connection-pool sizing and moving to a hosted database (spec 015).
- Retrying failed queries.

## Decisions (2026-10-21)
- D1 (was Q1): When an accepted analysis fails later in the background, the user gets the slot back (R1.8). The 10-per-15-minutes rate limit still caps how often failures can repeat.
- D2 (was Q2): Postgres gives up connecting after 2 seconds and cancels queries after 5 seconds (R2.1, R2.2). Migrations are not limited.
