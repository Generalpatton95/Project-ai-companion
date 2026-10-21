# 017 — Usage-Limit Concurrency: Design

**Status:** Approved (2026-10-21; amended after review round 1 for D3–D5, approved 2026-10-21)
**Requirements:** ./requirements.md

## Overview
There are three independent parts:

1. **Reserve, then refund (R1).** The usage middleware takes a slot in Redis with one Lua script that compares the count with the limit and adds one only if there's room. If the request fails, the client goes away, or the background analysis fails, the slot is given back to the day it came from. This uses the same approach as the rate limiters' count script from 016.
2. **Postgres time limits (R2).** The pool gets `connectionTimeoutMillis: 2000` and `statement_timeout: 5000`, plus a slightly longer client-side `query_timeout` as a backstop. A shared check recognises "the store is unavailable" errors. The global error handler turns those into the existing 503 from `utils/unavailable.js`, and chat's own handler adds the crisis resources.
3. **Outage-aware Redis logging (R3).** `config/redis.js` keeps a small outage record. The first connection failure is logged, later ones are only counted, and `ready` logs the recovery.

## Architecture

### R1 — Usage slots
```
POST /api/agent/analyze
  rateLimit('analyze')
  usageLimitMiddleware ── usageService.reserveAnalysis(user, { override })   (one EVAL)
     │  denied    → 429 (as today; nothing taken)
     │  store fails / times out → 503 (fail closed; nothing started)
     │  granted   → req.usageSlot = slot
     │              res 'finish' with status ≥ 400 → slot.release()
     │              res 'close' before the response finished → slot.release()
     ▼
  route → agentController.handleAnalysis(body, user, { onFailed: () => req.usageSlot.release() })
              orchestrator.startTask(task) → { taskId, done }
              done.then(result => result?.status !== 'completed' && onFailed())
```

**`services/safeguards/usage.service.js`**
- `RESERVE_SCRIPT` (exported). `KEYS[1]` is the day key; `ARGV` holds the cap and the TTL in seconds:
  ```lua
  local count = tonumber(redis.call('GET', KEYS[1]) or '0')
  if count >= tonumber(ARGV[1]) then
    return {0, count}
  end
  count = redis.call('INCR', KEYS[1])
  if redis.call('TTL', KEYS[1]) < 0 then
    redis.call('EXPIRE', KEYS[1], ARGV[2])
  end
  return {1, count}
  ```
  The comparison happens before the increment, so a refused request never changes the count.
- `RELEASE_SCRIPT` (exported). It decrements only while the count is above zero (R1.5):
  ```lua
  local count = tonumber(redis.call('GET', KEYS[1]) or '0')
  if count > 0 then
    return redis.call('DECR', KEYS[1])
  end
  return 0
  ```
- `reserveAnalysis(user, { override }, now)` → `{ granted, count, limit, hardLimit, message?, slot? }`.
  - Free tier: cap = `FREE_DAILY_LIMIT` (5), hard limit.
  - Paid tier without `override`: cap = `SOFT_DAILY_LIMIT` (10). A denial is overridable.
  - Paid tier with `override`: the cap is effectively unlimited (`Number.MAX_SAFE_INTEGER`). `message` is set when the new count is above 10, which is what sets the header today.
  - If the reply isn't a two-element array of integers, it throws `ServiceUnavailableError`, so the check fails closed, as `countRequest` does in 016.
  - `slot` is `{ key, release() }`. `key` is fixed at reservation time, which handles the midnight rollover (R1.5). `release()` runs `RELEASE_SCRIPT` once: a `released` flag makes later calls do nothing, and `release()` never throws. A failure is logged as `usage_release_failed` with `errorFields` (R1.6).
- `checkAnalysis` stays as the read-only status for `GET /api/safeguards/usage` (R1.7). `recordAnalysis` is removed because the reservation replaces it.

**`middleware/safeguards.middleware.js` — `usageLimitMiddleware`**
- It calls `withTimeout(usageService.reserveAnalysis(...))`. If that throws, it logs `usage_limit_unavailable` and calls `sendUnavailable(res)`, as today.
- If the slot isn't granted, it answers 429 with the same body as today.
- If the slot is granted, it sets `req.usageSlot` and adds the header when `message` is set. It then listens for `res.on('finish')`, and when `res.statusCode >= 400` it calls `slot.release()`. It also listens for `res.on('close')`: if `!res.writableFinished` and the slot hasn't been marked started, it calls `slot.release()`. The route calls `slot.markStarted()` just before `handleAnalysis`, so from then on a disconnect leaves the slot used, and only `onFailed` or a failing response (≥ 400) gives it back (D4). Both paths can fire, and the `released` flag means the slot is given back only once (R1.4).

**`routes/agent.routes.js` / `controllers/agent.controller.js`**
- `handleAnalysis(body, user, { onFailed } = {})`: after `startTask`, `done.then((result) => { if (!result || result.status !== 'completed') onFailed?.(); })`. `done` already never rejects, because `startTask` catches its errors. A crashed run resolves `undefined`, and that counts as failed (R1.8).
- The route passes `onFailed: () => req.usageSlot && req.usageSlot.release()`.
- A validation error from `handleAnalysis` (for example, an unknown `task_type`) goes to the error handler. The response is a 400, so the `finish` listener gives the slot back.

### R2 — Postgres
**`config/database.js`**
- `DB_TIMEOUTS = { connectionTimeoutMillis: 2000, statement_timeout: 5000, query_timeout: 6000 }`. `statement_timeout` is enforced by the server (R2.2). `query_timeout` is the client's backstop for a network that hangs, where the server never gets to cancel the query.
- `createPool({ timeouts = true } = {})` builds the pool from the existing config. With `timeouts: false`, only `connectionTimeoutMillis` is kept (`statement_timeout` and `query_timeout` are 0). The module still exports the app's shared pool, `createPool()`, so `require('../config/database')` callers don't change. `createPool` and `DB_TIMEOUTS` are attached as properties.
- **`db/migrate.js`**: when run from the command line, it uses `createPool({ timeouts: false })`. `migrate(pool)` itself doesn't change, and tests still inject their own pool.

**`utils/store-errors.js`** (new): `isStoreUnavailable(err)`. It is true for:
- Node socket codes: `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`, `EHOSTUNREACH`, `EPIPE`, `ENETUNREACH`, `ENETDOWN`, `EHOSTDOWN`, `ECONNABORTED` (D5).
- ioredis errors with no code (D5, R2.8): `err.name === 'MaxRetriesPerRequestError'`, and the fixed messages `Connection is closed.` and `Command timed out`, confirmed against the locked ioredis 5.8.2.
- Postgres SQLSTATE codes: `57014` (`query_canceled`, raised by `statement_timeout`), `57P01`, `57P02`, `57P03`, `53300`, and any `08xxx` connection exception.
- pg's own timeout and termination errors, which have no `code`. These are matched by exact comparison with the library's fixed strings: `timeout exceeded when trying to connect` (pg-pool), `Connection terminated due to connection timeout`, `Connection terminated unexpectedly`, `Query read timeout`, `timeout expired`, `Client has encountered a connection error and is not queryable` and `Client was closed and is not queryable` (pg). The builder confirms these strings against the locked pg 8.23.1 and pg-pool 3.14.0 and records them in a test. The message is only compared, never logged or returned.

**`middleware/error.middleware.js`**
- Before the current mapping, `if (isStoreUnavailable(err))`: log `store_unavailable` with `errorFields(err)`, `method` and `path` (R2.5), then return `sendUnavailable(res)` (R2.3). `ServiceUnavailableError` is **not** a store outage (D3): it keeps the existing path (`err.statusCode` 503 with its own message), because the only one that reaches a handler is chat's Claude failure, whose wording must not change.

**`routes/chat.routes.js`**
- It gets a router-level error handler as its last `router.use`. For `isStoreUnavailable(err)`, it logs as above and returns `sendUnavailable(res, { crisisResources: true })` (R2.4). Anything else goes to `next(err)`.
- Claude failures (R2.7, D3): `chat.service.js` gives its existing `ServiceUnavailableError` a fixed `code: 'COMPANION_UNAVAILABLE'`. The chat error handler answers it with `sendUnavailable(res, { crisisResources: true, message: err.message })` (`sendUnavailable` gains an optional `message`, default `UNAVAILABLE_MESSAGE`), logs `companion_unavailable` with `errorFields`, and in the streaming path sends `event: error` with that message, `status: 503` and `resources`.
- In the streaming path, after streaming has begun, a store-unavailable error sends `event: error` with `{ error: UNAVAILABLE_MESSAGE, status: 503, resources: CRISIS_RESOURCES }`. Other errors are handled as today. `utils/unavailable.js` exports `UNAVAILABLE_MESSAGE` for this.

**Frontend** (`frontend/src/services/chat.service.js`): the `error` event handler attaches `data` to the thrown error (`Object.assign(new Error(data.error), { status: data.status, data })`). `Chat.jsx` already reads `err.data.resources` for the send path. It also gets the same handling in the two load paths (opening a conversation and listing conversations), so a 503 there shows the resources too.

**Transactions (R2.6)**: in `ChatRepository.appendMessages` and `migrate()`, the `catch` runs `ROLLBACK` inside its own `try/catch`. A failed rollback must not hide the original error. `finally` calls `client.release(err)` when the error is store-unavailable or the rollback failed, so pg throws the broken connection away instead of returning it to the pool.

### R3 — Redis logging
In **`config/redis.js`**, the module keeps `let outage = null` (`{ startedAt, failedAttempts }`) and these handlers:
- `isConnectionError(err)`: true for the socket codes above, and for ioredis connect timeouts (`ETIMEDOUT`).
- On `error`:
  - A connection error with no outage open starts one with `failedAttempts: 1`. It logs `redis_unavailable` with `errorFields(err)`, unless the startup connect is in progress (see below).
  - A connection error during an outage only increments `failedAttempts`.
  - Any other error is logged as `redis_error` with `errorFields(err)` (R3.3).
- On `ready`: if an outage is open, log `redis_recovered { outageSeconds, failedAttempts }` and clear it (R3.2). `outageSeconds` is whole seconds. The startup `ready` has no outage open, so it logs nothing, and `connectRedis` logs `redis_connected` as today.
- `connectRedis`: sets a `starting` flag while `client.connect()` runs, so that connection errors during startup open the outage without logging `redis_unavailable`. On failure it logs `redis_connect_failed` as today (R3.4) and leaves the outage open, so the eventual `ready` logs `redis_recovered`.
- The handlers are attached by an exported `attachLogging(client, { now })`, so unit tests can drive them with an `EventEmitter` and a fake clock. `createRedisClient` calls it.

## Interfaces
- No endpoint, request or response shape changes, except:
  - Postgres outages now answer `503` with the existing outage body and `Retry-After: 30`. Before this change they answered `500`, or waited indefinitely.
  - Chat endpoints add `resources` to that 503, and to a streamed `error` event caused by an outage.
- New exports:
  - `RESERVE_SCRIPT`, `RELEASE_SCRIPT` and `UsageService#reserveAnalysis`.
  - `createPool` and `DB_TIMEOUTS` on `config/database`.
  - `isStoreUnavailable` from `utils/store-errors`.
  - `UNAVAILABLE_MESSAGE` from `utils/unavailable`.
  - `attachLogging` from `config/redis`.
- Removed: `UsageService#recordAnalysis`.
- New log events: `usage_release_failed`, `store_unavailable`, `redis_unavailable`, `redis_recovered` and `redis_error`. These replace the old free-text `Redis error`. `usage_record_failed` goes away.

## Data model
- There is no new data. The usage key (`safeguards:usage:analyses:<userId>:<YYYY-MM-DD>`) and its 48-hour TTL are unchanged.

## Error handling
| Failure | Result |
|---|---|
| Reserve fails or doesn't answer within 1.5 s | 503 and no analysis (R1.6, 016 R3.1). If Redis applies the increment after the timeout, that slot stays used: the count can be too high, never too low. |
| Reserve reply isn't an integer pair | 503 (fail closed) |
| Request ends ≥ 400, or the client disconnects before the analysis starts | The slot is given back once (R1.4) |
| Client disconnects after the analysis started | The slot stays used (D4) |
| Claude fails in chat | 503 with the companion message plus resources; `companion_unavailable` logged (R2.7) |
| Redis unreachable on any request path | 503, plus resources on chat (R2.8) |
| Background task fails, times out or crashes | The slot is given back once (R1.8) |
| Giving a slot back fails | `usage_release_failed` is logged and the slot stays used (R1.6) |
| Postgres connection takes over 2 s, a query is cancelled at 5 s, or the socket fails | 503 plus `Retry-After`, and chat also returns resources (R2.3, R2.4) |
| Postgres fails mid-transaction | Rollback is attempted and the broken client is discarded (R2.6) |
| Redis is down, then comes back | One `redis_unavailable` line (or `redis_connect_failed` at startup) and one `redis_recovered` line (R3) |

## Security & privacy
- Logs carry event names, `errorFields` (name, code, status), method, path, `outageSeconds` and `failedAttempts`. They never carry messages, bodies, IPs or email (016 R4). The log-hygiene source-scan test keeps covering the new files.
- `isStoreUnavailable` compares error messages with fixed library strings but never logs or returns them.
- Fail closed is unchanged: a reservation that can't be made refuses the request. A refund that can't be made leaves the count high.
- The usage key is built from the server-side `user.id` and today's date, never from client input.

## Testing strategy
| Criteria | Test |
|---|---|
| R1.1, R1.2 | Unit: `usage.service.test.js` with `MemoryStore`, where 10 parallel `reserveAnalysis` calls for a free user give exactly 5 grants. `MemoryStore.eval` is extended to run `RESERVE_SCRIPT` and `RELEASE_SCRIPT` (matched by identity with the exported constants, still in one step). **Integration (real Redis, CI):** the same check against Redis, and a middleware-level test with 10 simultaneous requests giving 5 × pass and 5 × 429. |
| R1.3 | Unit: paid tier at 10 with no override gets an overridable 429 and the count is unchanged. With override it is granted, the header is set and the count is 11. |
| R1.4 | Unit (middleware): `finish` with 400 or 500 gives the slot back, `close` before finish gives it back, and `finish` followed by `close` gives it back only once. A 202 doesn't give it back. `close` after `markStarted()` doesn't give it back (D4). |
| R1.5 | Unit: reserve on 23:59:59Z and release after midnight decrements the earlier day's key. Release on 0 stays at 0. |
| R1.6 | Unit: reserve rejects or times out, giving 503, and the handler isn't called. A release failure logs `usage_release_failed` with name and code only. |
| R1.7 | Unit: `GET /usage` leaves the count unchanged. |
| R1.8 | Unit (controller and route): `done` resolving `failed`, `undefined` or a timeout result gives the slot back once. `completed` doesn't. |
| R2.1, R2.2 | Unit: the pool built by `createPool()` has the three timeouts, and `createPool({ timeouts: false })` has no statement or query timeout. **Integration (Postgres, CI):** `SELECT pg_sleep(6)` on the app pool rejects with `57014`, and the same query on the migration pool succeeds. |
| R2.3, R2.5 | Unit: `isStoreUnavailable` for each code and string, plus negative cases (`23505`, a `ValidationError`). Error middleware gives 503 with `Retry-After` and logs `store_unavailable` with no message. A `ServiceUnavailableError` no longer leaks its message. |
| R2.4 | Unit (chat routes): a store-unavailable failure on JSON paths gives 503 plus `resources`. In the streaming path after start, the `error` event has `resources`. Frontend (Vitest): the streamed error carries `data`, and Chat shows the resources for send, open and list failures. |
| R2.6 | Unit with a fake client: a failure mid-transaction gives a `ROLLBACK` attempt. A failed rollback still rethrows the original error, and `release` gets an error argument. |
| R3.1–R3.4 | Unit (`tests/unit/config/redis.test.js`), with `attachLogging` on an `EventEmitter` and a fake clock: 5 connection errors log one `redis_unavailable`, then `ready` logs `redis_recovered { outageSeconds, failedAttempts: 5 }`. A non-connection error logs `redis_error`. A startup failure gives only `redis_connect_failed`, then `redis_recovered`. |
| NFR1–NFR4 | Log-hygiene scan stays green. The criterion IDs appear in test names. |
| Manual | Throwaway Docker Postgres and Redis, as in 016:<br>• 10 parallel `/analyze` calls for a free user give 5 × 202 and 5 × 429.<br>• `docker pause` on Postgres: login and chat give 503 within about 2–5 s, and chat includes the resources.<br>• Stopping and restarting Redis gives exactly one `redis_unavailable` and one `redis_recovered`. |

## Alternatives considered
- **`WATCH`/`MULTI` optimistic transaction** instead of Lua. It needs retries under contention, and the codebase already uses `EVAL` (016).
- **INCR first, then DECR if over the cap.** This is atomic too, but the count is briefly too high and a refused request touches the counter. Checking first avoids both.
- **Counting at the end of the background task** instead of reserving. Simultaneous requests would still all pass the check, so it doesn't fix R1.2.
- **Wrapping every pool method so that errors become `ServiceUnavailableError` at the source.** This means more surface to get right (`pool.query`, `pool.connect`, every `client.query`). Classifying in the two error handlers covers every path with one function.
- **Turning off ioredis reconnect errors entirely** (removing the listener). Node would then crash on an unhandled `error` event, and real failures would go unseen.
