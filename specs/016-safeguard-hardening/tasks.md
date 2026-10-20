# 016 — Safeguard Hardening: Tasks

**Status:** Done (2026-10-19), implemented in PR #11
**Design:** ./design.md

Each task is small enough to finish and test in one sitting. Check it off only when its tests pass. Tests name the criterion IDs they cover. Run backend tests with `npm test` (serial). Use only a disposable test database.

## Foundations
- [x] 1. `utils/log-fields.js`: `errorFields(err)` returns `{ errorName, errorCode, status }` and leaves out undefined keys. _Covers R4.2._
  - [x] 1.1 Write failing tests: `message`, `detail` and `stack` are never returned; `status` falls back to `statusCode`; an empty object comes back for `undefined`.
  - [x] 1.2 Implement.
- [x] 2. `utils/unavailable.js`: `withTimeout(promise, ms = 1500)` (rejects with `ServiceUnavailableError`, timer `unref`'d) and `sendUnavailable(res, { crisisResources })`. _Covers R1.1, R1.2, R2.2._
  - [x] 2.1 Write failing tests with Jest fake timers: resolves pass through; a never-resolving promise rejects at 1500ms; the 503 body and `Retry-After: 30`; `resources` equals `CRISIS_RESOURCES` only when asked for.
  - [x] 2.2 Implement.

## Fail closed
- [x] 3. IP rate limiter fails closed: the store can be injected (`{ store = redis }`), store calls go through `withTimeout`, and `catch` calls `sendUnavailable` and logs `rate_limit_unavailable` + `errorFields`. _Covers R1.1, R1.2, R1.3._
  - [x] 3.1 Write failing tests: a rejecting `incr` gives 503 and the handler isn't called; a hanging store gives 503 in ≤1.5s; the logger spy sees no IP, body or `message`.
  - [x] 3.2 Implement. Existing auth route tests still pass.
- [x] 4. Per-user rate limiter fails closed, with `{ crisisResourcesOnOutage }`; the chat route passes `true`. _Covers R2.1, R2.2, R2.3._
  - [x] 4.1 Write failing tests: query/analyze give a plain 503; chat gives 503 + `resources`; a hanging store gives 503 in ≤1.5s.
  - [x] 4.2 Implement, and update `routes/chat.routes.js:14`.
- [x] 5. Chat page shows resources when sending fails: in `Chat.jsx`, WHEN `err.data.resources` is present, render `SupportResources` under the error. _Covers R2.2 (UI)._
  - [x] 5.1 Write a failing Vitest test: a rejected send with `{ status: 503, data: { error, resources } }` shows the error and the `Support resources` region.
  - [x] 5.2 Implement. Take a screenshot for owner sign-off.
- [x] 6. Daily analysis limit fails closed: `checkAnalysis` goes through `withTimeout`, and `catch` calls `sendUnavailable` (no `next()`); the record-failure log uses `usage_record_failed` + `errorFields`. _Covers R3.1, R3.2._
  - [x] 6.1 Write failing tests: a rejecting or hanging `checkAnalysis` gives 503 and `next` isn't called; the record-failure log has no `message`.
  - [x] 6.2 Implement.
- [x] 7. Redis startup visibility: set `maxRetriesPerRequest: 1` and keep `lazyConnect`; export `connectRedis()` (logs `redis_connected` or `redis_connect_failed` + `errorFields`, never throws); `server.js` calls it after `listen`. _Covers R6.1, R6.2, R6.3._
  - [x] 7.1 Write failing tests: `connectRedis` with a rejecting `connect` logs the failure and resolves; with a resolving one it logs success.
  - [x] 7.2 Implement. The full suite still exits on its own with no open handles.

## Logs and error responses
- [x] 8. Error middleware: log `errorFields(err)` + path + method (no `message`, no `stack`); send the message only for errors with a `statusCode`; remove the `'not found'` substring match; everything else gets a generic 500. _Covers R4.2, R4.5._
  - [x] 8.1 Write failing tests: a plain `Error('relation x not found')` gives 500 `Internal server error`; `NotFoundError` gives 404 with its message; `ValidationError` gives 400; the logger spy has no `message` or `stack`.
  - [x] 8.2 Implement. Check that no existing route relied on the substring match (grep for `throw new Error(` with "not found" in the backend); convert any that did to `NotFoundError`.
- [x] 9. Log hygiene scan test (`tests/unit/log-hygiene.test.js`): scans `backend/**/*.js` (excluding `node_modules`, `tests`) for logger calls containing `.message`, `.stack`, `req.body`, `req.ip`, or `query`/`content`/`email`/`password` as values. _Covers R4.3._
  - [x] 9.1 Write the test. It fails at first and lists the offending lines, which is expected.
- [x] 10. Fix every call site the scan flags: replace `{ error: error.message }` with `errorFields(error)` (~20 sites); log `{ userId, queryLength }` at `agent.controller.js:37`; drop `ip` from the request log at `server.js:29`. _Covers R4.1, R4.2, R4.4._
  - [x] 10.1 Implement. The task 9 scan passes and the existing tests still pass.
- [x] 11. Delete `backend/setup-files.js`. _Covers R8.1._
  - [x] 11.1 Confirm nothing refers to it (grep the repo, `package.json` scripts and docs), then delete it. Lint and tests pass.

## Smaller fixes
- [x] 12. Missing query gives 400: `throw new ValidationError('query is required')` in `handleQuery`. _Covers R5.1._
  - [x] 12.1 Write a failing route test: `POST /api/agent/query {}` gives 400.
  - [x] 12.2 Implement.
- [x] 13. Bounded match history: `clampCount(value)` in `tools/game-api.tool.js`. _Covers R7.1._
  - [x] 13.1 Write failing tests: `undefined, 0, -5, '7', 500, 'abc'` give `20, 1, 1, 7, 20, 20`.
  - [x] 13.2 Implement and use it in the `match_history` case.

## Review round 1 (2026-10-19)
- [x] 14. Riot identifiers out of logs and errors: drop `summonerName`/`puuid` (error and debug) in `riot-games.js` and `player_id` in `game-api.tool.js:62`; Riot methods throw without the outside message. _Covers R4.1, R4.6._ **Blocker.**
- [x] 15. Failed analyses show the generic message (`orchestrator.js:90-97`). _Covers R4.6._
  - [x] 15.1 Write a failing test: a plain `Error` gives the generic message in the stored state and in `getTaskStatus`; an app error keeps its message.
- [x] 16. Widen the log scan (rules listed in the design); narrow `.length` to `query`/`content`; fixture test for each new rule. _Covers R4.3._
- [x] 17. Atomic counting in both limiters (one Lua script: `INCR`, then set the expiry if the key has none); rename the option to `crisisResources`; the chat 429 carries `resources`. _Covers R1.1, R2.1, R2.4._
  - [x] 17.1 Write failing tests: the expiry is set in the same call as the count; two simultaneous first requests count 2; chat 429 has `resources`, query 429 doesn't.
- [x] 18. Chat page shows resources on the 429 (Vitest). _Covers R2.4 (UI)._
- [x] 19. Redis `commandTimeout: 1500`, `connectTimeout: 2000`; remove the duplicate success log. _Covers R1.2, R6.1._
- [x] 20. Request logger moved to `middleware/request-log.middleware.js` with a test that it logs `method` and `path` only. _Covers R4.4._
- [x] 21. Route wiring tests for auth (`ipRateLimitMiddleware('auth')`) and agent (`query`, `analyze`, `usageLimitMiddleware`). _Covers R1.1, R2.1, R3.1._
- [x] 22. Nits: add the criterion ID to the Chat test "shows no support resources for an error without them"; add the missing newline at the end of `game-api.tool.js`.

## Review round 2 (2026-10-19)
- [x] 23. Real-Redis integration test for the count script and fail-fast client; put the Redis service and `REDIS_URL` back in `.github/workflows/test.yml`; the test skips without `REDIS_URL`. _Covers R1.1, R1.2, R2.1._
- [x] 24. `task_type` is checked against the known task types before it's logged or used (unknown → 400 `ValidationError`), so only fixed values reach the logs. _Covers R4.1, R5.1._
- [x] 25. Scanner: whole-error rule also covers `e`, `ex`, `reason`; request-text rule adds `summonerName`, `puuid`, `player_id`, `playerId`, `summonerId`, `matchId`, `task_type`; property rule for `req.query`, `req.params`, `req.headers`, `req.url`, `req.originalUrl`. Fixture test for each. _Covers R4.3._
- [x] 26. Limiter treats a count that isn't an integer as unavailable (503). _Covers R1.1, R2.1._

## Screenshot sign-off (2026-10-19)
- [x] 27. Crisis-resource link uses `var(--color-primary)` (`.support a`), so it meets 4.5:1 contrast in both themes. Frontend tests and build pass; new screenshot of the chat 503. _Covers R2.2, R2.4 (UI); D10._

## Verification
- [x] Every acceptance criterion (R1.1–R8.1) maps to a passing test or a recorded manual check.
- [x] Backend `npm run lint` and `npm test` pass, and Jest exits on its own. Frontend `npm test` and `npm run build` pass. CI passes, including the Postgres suites.
  - CI on PR #11: 27/27 suites (real Redis and Postgres included), 210/210 tests.
- [x] Manual check: stop Redis locally. Login gets 503 within about 1.5s, chat send gets 503 and the page shows the support resources, and the server log has no IPs, message text or `error.message`.
  - Done 2026-10-19 on a scratch stack (Postgres 16, Redis 7 containers). Redis paused: login, chat, query and analyze each 503 in ~1.51s, only chat with resources. Redis stopped: login 503 in 0.09s, chat 0.4s. Redis restarted: login 200 without a server restart. Chat 429 has resources, query 429 doesn't. Outage log: event names, error name/code, method and path only (0 hits for IPs, email, message text, `message`, `stack`).
- [x] Code, security and performance reviews are done and their blocking findings are fixed and re-checked. Screenshot of task 5 is signed off by the owner.
- [x] `BACKLOG.md` has 016, and the spec status is set to `Done`.
