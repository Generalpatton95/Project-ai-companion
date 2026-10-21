# 017 — Usage-Limit Concurrency: Tasks

**Status:** Approved (2026-10-21)
**Design:** ./design.md

Each task is small enough to finish and test in one sitting. Check it off only when its tests pass. Tests name the criterion IDs they cover.

## R1 — Usage slots
- [ ] 1. `MemoryStore.eval` runs `RESERVE_SCRIPT` and `RELEASE_SCRIPT` (matched by identity with the exported constants) as well as the rate-limit count script, each in one step. _(test support for R1.1–R1.5)_
- [ ] 2. `UsageService.reserveAnalysis` + `RESERVE_SCRIPT`. _Covers R1.1, R1.2, R1.3, R1.6 (reply guard)_
  - [ ] 2.1 Failing tests: 10 parallel free-tier reservations → exactly 5 granted. Paid at 10, no override → overridable denial with the count unchanged. With override → granted, `message` set, count 11. A non-integer-pair reply → `ServiceUnavailableError`.
  - [ ] 2.2 Implement.
- [ ] 3. `slot.release()` + `RELEASE_SCRIPT`: once only, never throws, logs `usage_release_failed` with `errorFields`, uses the key from reservation time, never goes below 0. _Covers R1.5, R1.6_
  - [ ] 3.1 Failing tests (including reserve 23:59:59Z → release after midnight, and release at 0).
  - [ ] 3.2 Implement. Remove `recordAnalysis`. `checkAnalysis` stays read-only (R1.7 test: `GET /usage` leaves the count unchanged).
- [ ] 4. `usageLimitMiddleware` uses the reservation: 503 on failure or timeout, 429 on denial, `req.usageSlot`, release on `finish` ≥ 400 and on `close` before finish. _Covers R1.4, R1.6_
  - [ ] 4.1 Failing tests: 400 and 500 release; `close` before finish releases; `finish` + `close` release once; 202 doesn't release; reserve rejects or times out → 503 and the handler isn't run.
  - [ ] 4.2 Implement.
- [ ] 5. `handleAnalysis(body, user, { onFailed })` and the route passes `req.usageSlot.release`. _Covers R1.8_
  - [ ] 5.1 Failing tests: `done` resolving `failed`, `undefined` or a timeout result → one release. `completed` → none.
  - [ ] 5.2 Implement.
- [ ] 6. Real-Redis integration (`tests/integration/redis/usage.redis.test.js`, skipped without `REDIS_URL`): 10 parallel reservations → 5 granted. 10 simultaneous requests through the middleware → 5 pass, 5 × 429. Release decrements, and stays at 0 at 0. _Covers R1.2 (NFR2)_

## R2 — Postgres
- [ ] 7. `config/database.js`: `DB_TIMEOUTS`, `createPool({ timeouts })`, shared pool unchanged for callers; `db/migrate.js` CLI uses `createPool({ timeouts: false })`. _Covers R2.1, R2.2_
  - [ ] 7.1 Failing unit tests on the pool options.
  - [ ] 7.2 Implement.
  - [ ] 7.3 Postgres integration (CI only): `SELECT pg_sleep(6)` → `57014` on the app pool, succeeds on the migration pool.
- [ ] 8. `utils/store-errors.js` `isStoreUnavailable`. Confirm pg's fixed timeout and termination strings against the locked pg 8.23.1 and pg-pool 3.14.0 source, and record where each comes from in a test comment. _Covers R2.3_
  - [ ] 8.1 Failing tests for every code and string, plus negatives (`23505`, `ValidationError`, a plain `Error`).
  - [ ] 8.2 Implement.
- [ ] 9. Error middleware: store-unavailable → log `store_unavailable` (errorFields, method, path) → `sendUnavailable(res)`. A `ServiceUnavailableError` no longer sends its own message. _Covers R2.3, R2.5_
- [ ] 10. Chat router error handler and streamed `error` event with `resources`; export `UNAVAILABLE_MESSAGE`. _Covers R2.4_
- [ ] 11. Frontend: `chat.service.js` attaches `data` to streamed errors; `Chat.jsx` shows resources on send, open and list failures. Vitest tests. _Covers R2.4_
- [ ] 12. Transaction cleanup in `ChatRepository.appendMessages` and `migrate()`: rollback in its own try/catch, original error rethrown, `client.release(err)` for broken connections. _Covers R2.6_

## R3 — Redis logging
- [ ] 13. `attachLogging(client, { now })` in `config/redis.js` with the outage record. `connectRedis` start-up flag. _Covers R3.1–R3.4_
  - [ ] 13.1 Failing tests with an `EventEmitter` and fake clock: 5 connection errors → one `redis_unavailable`; `ready` → `redis_recovered { outageSeconds, failedAttempts: 5 }`; a non-connection error → `redis_error`; a startup failure → only `redis_connect_failed`, then `redis_recovered`; a healthy startup → only `redis_connected`.
  - [ ] 13.2 Implement. Existing 016 R6 tests stay green.

## Verification
- [ ] 14. `npm test` (backend) and `npx vitest run` (frontend) pass; backend `npx eslint .` is clean; the log-hygiene scan is green.
- [ ] 15. Manual check (throwaway Docker Postgres and Redis on non-default ports, as in 016):
  - 10 parallel `/analyze` calls for a free user → 5 × 202, 5 × 429.
  - `docker pause` Postgres → login and chat send → 503 in about 2–6 s, and chat shows the resources (screenshot for sign-off).
  - Stop and restart Redis → exactly one `redis_unavailable` and one `redis_recovered` in the log.
  - The logs hold no messages, bodies, IPs or email.
- [ ] 16. Every acceptance criterion maps to a passing test or a recorded manual check; CI green (including real Redis and Postgres); `BACKLOG.md` updated; spec status → `Done`.
