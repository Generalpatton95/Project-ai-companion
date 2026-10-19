# 016 — Safeguard Hardening: Design

**Status:** Approved (2026-10-19)
**Requirements:** ./requirements.md

## Overview
Every check that guards a request (IP rate limit, per-user rate limit, daily analysis limit) will **answer 503 when it can't run**, never pass the request through (R1–R3). Store calls get a short app-level time limit, so an unreachable Redis can't hold a request for about 10 seconds (R1.2). Every log call goes through one helper that keeps only an error's name, code and status (R4). A source scan test makes sure that stays true (R4.3). The other three fixes (R5–R7) are one-line changes in the files they name.

## Architecture
| Area | File | Change |
|---|---|---|
| Fail-closed helper | `backend/utils/unavailable.js` (new) | `withTimeout(promise, ms)` and `sendUnavailable(res, { crisisResources })` |
| Log helper | `backend/utils/log-fields.js` (new) | `errorFields(err)` returns `{ errorName, errorCode, status }` |
| Rate limits | `middleware/rate-limit.middleware.js` | Store is injectable (`{ store = redis }`), calls are wrapped in `withTimeout`, and `catch` calls `sendUnavailable` |
| Usage limit | `middleware/safeguards.middleware.js` | `checkAnalysis` is wrapped in `withTimeout`, and `catch` calls `sendUnavailable` |
| Redis client | `config/redis.js` | Add `maxRetriesPerRequest: 1`. Keep `lazyConnect`, and export `connectRedis()` |
| Startup | `server.js` | After `listen`, call `connectRedis()`, which logs success or `errorFields` and never throws |
| Error middleware | `middleware/error.middleware.js` | Log `errorFields(err)` with path and method. Remove `stack` and `message` from logs |
| Log call sites | ~20 calls (agent, chat, config, integrations, middleware, tools) | Replace `{ error: error.message }` with `errorFields(error)` |
| Query log | `controllers/agent.controller.js:37` | Log `{ userId, queryLength }` instead of `query` |
| Request log | `server.js:29` | Log `method` and `path` only, without `ip` (R4.4) |
| Error responses | `middleware/error.middleware.js` | Only errors with a `statusCode` send their message. Remove the `'not found'` substring match; everything else gets a generic 500 (R4.5) |
| Chat outage UI | `frontend/src/pages/Chat.jsx:121-124` | WHEN a send fails with `err.data.resources`, show the existing `SupportResources` under the error message (R2.2). This is a visible change, so it needs a screenshot for sign-off |
| Atomic counting (round 1) | `middleware/rate-limit.middleware.js` | Both limiters count with one `MULTI` (`INCR` + `EXPIRE key ttl NX`) and compare the result, so a count can never be left without an expiry and simultaneous requests can't share one slot. The user limiter moves from get-then-set to count-then-compare, the same as the IP limiter |
| Redis timeouts (round 1) | `config/redis.js` | Add `commandTimeout: 1500` and `connectTimeout: 2000`; `withTimeout` stays as the backstop. Remove the duplicate success log |
| Chat 429 (round 1) | `middleware/rate-limit.middleware.js` | With `crisisResourcesOnOutage`, the 429 also carries `resources` (R2.4). Rename the option to `crisisResources` |
| Task errors (round 1) | `agent/orchestrator.js:90-97`, `integrations/riot-games.js` | Store and return `error.statusCode ? error.message : TASK_FAILED_MESSAGE`. Riot methods throw `new Error('Failed to fetch <thing>')` without the outside message, and log only `region` and `errorFields` (R4.1, R4.6) |
| Request logger (round 1) | `middleware/request-log.middleware.js` (new) | Move the request log out of `server.js` so it can be tested (R4.4) |
| Stale script | `backend/setup-files.js` | Delete (R8.1) |
| Missing query | `controllers/agent.controller.js:34` | `throw new ValidationError('query is required')` |
| Match count | `tools/game-api.tool.js:80` | `clampCount(extraParams.count)`: integer, clamped to 1–20, default 20 |

`sendUnavailable` imports `CRISIS_RESOURCES` from `services/safeguards/messages.js`, where it already lives.

## Interfaces
**503 response (R1.1, R2.1, R3.1)**
```
HTTP/1.1 503 Service Unavailable
Retry-After: 30
{ "error": "Service temporarily unavailable. Please try again shortly." }
```
For chat (R2.2), the body also has `"resources": CRISIS_RESOURCES`. The chat route turns this on with `rateLimitMiddleware('chat', { crisisResourcesOnOutage: true })`, so the setting is visible at the route instead of being hidden in a table.

**Module exports**
- `utils/unavailable.js`: `withTimeout(promise, ms = 1500)` rejects with `ServiceUnavailableError` after `ms`, and its timer is `unref`'d. `sendUnavailable(res, { crisisResources = false })`.
- `utils/log-fields.js`: `errorFields(err)` returns `{ errorName: err.name, errorCode: err.code, status: err.status ?? err.statusCode }`, leaving out undefined keys.
- `config/redis.js`: the default export stays the client, and adds `connectRedis()`.

## Data model
No change.

## Error handling
| Failure | What the caller sees | What gets logged |
|---|---|---|
| Redis down or erroring on the auth limiter | 503 + `Retry-After` within ≤1.5s | `rate_limit_unavailable` + `errorFields` |
| Redis down on query/analyze limiter | 503 | same |
| Redis down on chat limiter | 503 + `resources` | same |
| Usage store down | 503, analysis not started | `usage_limit_unavailable` + `errorFields` |
| Recording usage fails after success | No change (the response has already been sent) | `usage_record_failed` + `errorFields` (R3.2) |
| Redis unreachable at boot | Server starts; guarded routes return 503 | `redis_connect_failed` + `errorFields` (R6.1–R6.2) |
| Query missing | 400 `{ error: 'query is required' }` | Logged as a client error (no 500) |

## Security & privacy
- Never logged: request bodies or any field from them, `error.message`, `error.detail`, stacks, outside-service response bodies, tokens.
- Logged: event names, error name, code and status, user and task ids, path, method, `queryLength`.
- Unchanged: crisis detection logic and wording, and auth.

## Testing strategy
| Criteria | Test |
|---|---|
| R1.1, R1.3 | Unit: IP limiter with a store whose `incr` rejects returns 503 + `Retry-After`, the handler isn't called, and the logger spy sees no IP or body |
| R1.2, R2.3 | Unit: a store that never resolves gives a 503 in ≤1.5s (Jest fake timers) |
| R2.1, R2.2 | Unit: per-user limiter returns 503; with `crisisResourcesOnOutage` the body has `resources` matching `CRISIS_RESOURCES` |
| R2.2 (UI) | Vitest: `Chat` with a send that rejects `{ status: 503, data: { error, resources } }` renders the error and a `Support resources` region listing each resource |
| R3.1, R3.2 | Unit: `usageLimitMiddleware` with a failing `checkAnalysis` returns 503 and `next` isn't called |
| R4.1, R4.2 | Unit: `errorFields` drops `message`, `detail` and `stack`; the error middleware logger spy gets no `message` or `stack` |
| R4.3 (round 1 widening) | The scan also covers `console.*`, `logger[...]` and aliases, and flags a whole error passed as a value (`error`, `err`, `${error}`, `String(error)`), `.detail` and `.response`. The `.length` exception only applies to `query` and `content`. Each new rule has a fixture test |
| R2.4 | Unit: chat limiter over the limit returns 429 + `resources`; query/analyze 429 has none. Vitest: the chat page shows resources on that 429 |
| R4.6 | Unit: a task failing with a plain `Error('secret detail')` stores and returns the generic message; an app error keeps its own |
| Route wiring (round 1) | Unit: the auth and agent routes use the fail-closed limiters and `usageLimitMiddleware` by default (`isolateModules`, as in the chat wiring test) |
| R4.3 | Unit: a source scan of `backend/**/*.js` (excluding `node_modules`, `tests`) fails on a logger call containing `.message`, `.stack`, `req.body`, or a value of `query`, `content`, `email`, `password` |
| R5.1 | Route test: `POST /api/agent/query {}` returns 400 |
| R6.1, R6.2 | Unit: `connectRedis()` with a client whose `connect` rejects logs `redis_connect_failed` and resolves |
| R6.3 | The existing suite exits on its own (no open handles) |
| R4.4 | Unit: the request-log spy gets no `ip` key; the R4.3 scan also flags `req.ip` in logger calls |
| R4.5 | Unit: error middleware with a plain `Error('relation x not found')` returns 500 `Internal server error`; a `NotFoundError` still returns 404 with its message |
| R8.1 | Check: the file is gone and `npm test` and lint still pass |
| R7.1 | Unit: `clampCount` with `undefined`, `0`, `-5`, `'7'`, `500`, `'abc'` returns `20, 1, 1, 7, 20, 20` |

## Alternatives considered
- **ioredis `commandTimeout` alone for R1.2:** rejected. It doesn't reliably cover commands waiting in the offline queue while reconnecting, while an app-level `withTimeout` is easy to test with fake timers. `maxRetriesPerRequest: 1` is still set, so queued commands get dropped quickly.
- **Calling `next(new ServiceUnavailableError())` and letting the error middleware respond:** rejected. That needs `Retry-After` and `resources` support in the error middleware just for this case. Sending the response directly in the limiter is simpler.
- **A logger wrapper that strips fields:** rejected. Stripping silently hides mistakes, while the scan test (R4.3) catches them at review time.

## Decisions (2026-10-19)
- Q4 → stop logging IPs (R4.4). Q5 → fix error leaks here (R4.5). Q6 → delete `setup-files.js` (R8.1).
