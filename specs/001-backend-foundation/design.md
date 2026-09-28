# 001 — Backend Foundation: Design

**Status:** Approved (2026-09-28)
**Requirements:** ./requirements.md (Approved 2026-09-28)

## Overview
The work splits the backend into three layers: a **pure config loader**, an **app factory** that builds
the Express app from a config object, and a thin **entry point** that loads `.env`, builds the app,
and calls `listen()`. Because the app is built from a config object and never opens a port itself,
tests can run it in-process with any configuration (R6.2). They never touch a real `.env` or a network port.

Key decisions:
- **Upgrade to Express 5.** Express 5 passes errors from async handlers (rejected promises) to the
  error handler automatically, which satisfies R3.5 without wrapping every route. Express 4 would
  need an `asyncHandler()` wrapper on each route, which is easy to forget. The routes that Express 5's
  path-syntax changes affect (`routes/agent.routes.js`) aren't wired in by this spec.
- **No new validation library.** Config validation is a small hand-written function. Request
  validation (and possibly `zod`) is decided in the first spec that accepts user input (002).

## Architecture

```
backend/
  server.js                 entry: import 'dotenv/config' → loadConfig → createApp → listen
  app.js                    createApp(config, { logger }) → Express app (no listen)
  config/index.js           loadConfig(env) → frozen config object | throws ConfigError
  utils/logger.js           createLogger(config) → winston logger (console only)
  utils/errors.js           AppError + subclasses, ConfigError
  middleware/
    request-logger.js       logs method, path, status, durationMs on response finish
    not-found.js            → throws NotFoundError
    error-handler.js        maps any error to { error: { code, message } }
  routes/health.routes.js   GET /health, GET /api/v1/status
  tests/
    unit/config.test.js
    unit/errors.test.js
    unit/logger.test.js
    integration/app.test.js
    integration/startup.test.js
    integration/esm.test.js
  vitest.config.js
```

Order of middleware in `createApp`:
1. `request-logger`
2. `cors(allowlist)`
3. `express.json({ limit })`
4. routes
5. `not-found`
6. `error-handler` (always last)

## Interfaces

### Config: `loadConfig(env = process.env)`
A pure function with no side effects, so it's easy to test with plain objects. It collects **all**
problems before throwing one `ConfigError` whose `keys` array names each bad key (never its value).

| Key | Type | Default | Required now | Rule |
|---|---|---|---|---|
| `NODE_ENV` | enum | `development` | no | one of `development`, `test`, `production` |
| `PORT` | int | `3001` | no | integer 1–65535 |
| `LOG_LEVEL` | enum | `debug` (dev), `info` (prod), `error` (test) | no | one of `error`, `warn`, `info`, `debug` |
| `CORS_ORIGINS` | CSV list | `http://localhost:5173` in dev, **empty** otherwise | no | each entry a valid `http(s)` origin |
| `JSON_BODY_LIMIT` | string | `100kb` | no | matches `^\d+(b\|kb\|mb)$` |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `RIOT_API_KEY`, `RIOT_API_REGION`, `REDIS_URL`, `DATABASE_URL`, `JWT_SECRET` | string | — | no (R1.4) | passed through untouched; the spec that uses each one makes it required |

Returned shape (frozen):
```js
{ env, port, logLevel, corsOrigins: string[], jsonBodyLimit,
  anthropic: { apiKey, model }, riot: { apiKey, region },
  redis: { url }, database: { url }, jwt: { secret } }
```
The old `config/index.js` defaults (`agent.costLimits`, `rateLimit` and so on) are dropped. The spec
that needs each one brings it back with validation.

### Entry point: `server.js`
```js
import 'dotenv/config';
try { config = loadConfig(); } catch (e) {
  if (e instanceof ConfigError) { console.error(`Invalid config: ${e.keys.join(', ')}`); process.exit(1); }
  throw e;
}
const logger = createLogger(config);
createApp(config, { logger }).listen(config.port, () => logger.info('Server listening', { port }));
```
At this point the config is invalid, so no logger has been built yet. That's why this one path uses
`console.error`. It prints key names only (R1.3).

### Endpoints
| Method | Path | 200 response |
|---|---|---|
| GET | `/health` | `{ status: "healthy", service: "AI Gaming Companion", timestamp, uptime }` |
| GET | `/api/v1/status` | `{ version: "v1", status: "operational" }` |

The old `features` array in `/api/v1/status` is dropped: it advertised features that don't exist yet.

### Errors: `utils/errors.js`
```js
class AppError extends Error { constructor(message, { status, code, expose = true }) }
class ValidationError   extends AppError   // 400 VALIDATION_ERROR
class UnauthorizedError extends AppError   // 401 UNAUTHORIZED
class NotFoundError     extends AppError   // 404 NOT_FOUND
class ConfigError       extends Error      // carries keys: string[]; never sent over HTTP
```

### Error handler mapping
| Error | Status | Code | Message sent to client |
|---|---|---|---|
| `AppError` subclass | its status | its code | its message |
| body-parser `entity.parse.failed` | 400 | `INVALID_JSON` | "Request body is not valid JSON" |
| body-parser `entity.too.large` | 413 | `PAYLOAD_TOO_LARGE` | "Request body is too large" |
| anything else | 500 | `INTERNAL_ERROR` | "Something went wrong" (R3.3: never `err.message` or stack) |

Every 5xx is logged at `error` level with `{ err.stack, method, path }` (R3.4). 4xx errors aren't
logged by the handler, because the request logger already records their status.
If headers have already been sent, the handler passes the error on to Express's default handler.

## Logging
- winston with a single Console transport (D2). In development the format is colorized and simple;
  otherwise it's JSON with a timestamp.
- The level comes from `config.logLevel`. It defaults to `error` under `NODE_ENV=test` (R4.4).
- The request logger writes one `info` line per request on the response `finish` event:
  `{ method, path: req.path, status, durationMs }`. It uses `req.path`, **not** `req.originalUrl`,
  so query strings (which may carry PII later) are never logged (R4.3). It never reads `req.body`
  or `req.headers`.
- Logger calls elsewhere must pass explicit fields. Passing whole `req`, `config` or error-plus-request
  objects is not allowed. The logger test enforces this for the request logger. Later specs follow the rule.

## Module conversion (R5)
| File | Action |
|---|---|
| `utils/logger.js`, `config/index.js`, `middleware/error.middleware.js`, `server.js` | Rewritten as described above (`error.middleware.js` → `error-handler.js`) |
| `agent/orchestrator.js`, `agent/state-manager.js`, `tools/*.js`, `integrations/claude.js`, `integrations/riot-games.js`, `config/redis.js`, `middleware/auth.middleware.js`, `middleware/rate-limit.middleware.js`, `controllers/agent.controller.js`, `routes/agent.routes.js` | Mechanically converted to ESM, logic unchanged, **not imported** by `app.js` (R5.3). Imports of `../utils/logger` switch to a default logger export (see below). |
| `express-basics.js`, `setup-files.js` | Deleted (R5.4). `setup-files.js` is a one-time CommonJS scaffold generator whose output already exists. |
| 54 empty files under `backend/` (including the empty `tests/*.js`) | Deleted (R5.2) |
| `agent/orhestrator.js` | Deletion kept (duplicate) |

`utils/logger.js` exports both `createLogger(config)` and a default `logger` built from `loadConfig()`,
so that the converted-but-unwired modules can keep calling `logger.info(...)`. `app.js` itself only
uses the logger that's passed in, so tests stay isolated.

Converted modules aren't executed by this spec. Some of them connect to Redis or need API keys as
soon as they're imported. `integration/esm.test.js` checks them **statically** instead: no
`require(`, `module.exports` or `exports.` in any `.js` file under `backend/` outside `node_modules`,
and every file passes `node --check`.

## Dependencies
- **Upgrade:** `express` → `^5`
- **Add (dev):** `vitest`, `supertest`
- **Remove (dev):** `jest`
- **Unchanged:** `cors`, `dotenv`, `winston`, and the rest (the Anthropic SDK stays pinned per D3)
- **Scripts:** `"test": "vitest run"` and `"test:watch": "vitest"`. `lint` is left as is; ESLint
  setup isn't part of this spec.

## Security & privacy
- `.env` stays gitignored (already true). `.env.example` gets every key from the config table with
  placeholder values and one-line comments (R1.5).
- Config errors name keys, never values.
- 500 responses never include internal messages or stacks, whatever the environment. (The old handler
  leaked stacks in development. That's dropped, because the dev logs already show them.)
- CORS: requests without an `Origin` header (curl, server-to-server) are allowed. Browser origins
  must match `corsOrigins` exactly. A mismatched origin gets no CORS headers, so the browser blocks it.
- Body size is capped (R2.6).

## Testing strategy
| Criteria | Test |
|---|---|
| R1.1, R1.2, R1.4 | `unit/config.test.js`: defaults, parsing, optional keys pass through |
| R1.3 | `unit/config.test.js` (throws with all bad keys, message has no values) and `integration/startup.test.js` (spawns `node server.js` with `PORT=abc`, expects exit code ≠ 0 and stderr naming `PORT` but not `abc`) |
| R1.5 | `unit/config.test.js`: every key in the config table appears in `.env.example` |
| R2.1–R2.6 | `integration/app.test.js` via Supertest against `createApp(testConfig)` |
| R3.1–R3.5 | `integration/app.test.js`, using test-only routes added to the app in the test, e.g. an async route that rejects and a route that throws `ValidationError` |
| R3.2 | `unit/errors.test.js` |
| R4.1–R4.4 | `unit/logger.test.js` with a capturing transport: request line fields present, no body, auth header or query string; test level suppresses `info` |
| R5.1–R5.4 | `integration/esm.test.js`: static scan + `node --check` + asserts deleted files are gone |
| R6.1 | Manual: a deliberately failing test makes `npm test` exit 1 (recorded once in tasks.md) |
| R6.2, R6.3 | Covered by the structure above; every test title starts with its criterion ID |
| NFR1 | `integration/startup.test.js`: time from spawn to the "listening" log line < 2 s |

## Alternatives considered
- **Stay on Express 4 + `asyncHandler` wrapper.** Rejected: it has to be applied by hand to every
  async route, and a missed one hangs the request. Express 5 is the current stable line.
- **`zod` for config.** Reasonable, but it adds a dependency for five keys. We'll revisit it in 002,
  where request validation makes it worthwhile.
- **Keep the unwired modules as CommonJS by renaming them `.cjs`.** Rejected: that defers the problem
  and violates R5.1.
- **Delete the unwired modules and rewrite them in their own specs.** Tempting, since they'll likely
  change a lot, but they hold useful thinking (orchestrator loop, Riot client). Converting them is cheap.
