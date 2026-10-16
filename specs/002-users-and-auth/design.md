# 002 — Users & Auth: Design

**Status:** Approved (2026-09-28)
**Requirements:** ./requirements.md (Approved 2026-09-28)

## Overview
Accounts use **email + password**, with **server-side sessions** stored in PostgreSQL. The browser
holds only an opaque random token in an `HttpOnly` cookie. The database stores only a SHA-256 hash of
that token, so a leaked database can't be replayed as live sessions. There are no JWTs: server-side
sessions make "log out" and "log out everywhere" (R3) actually revoke access immediately, which
stateless JWTs can't do without a denylist.

Main choices, with rejected options at the end:
- **`pg` + plain SQL, no ORM.** The schema is small, SQL is a skill worth practising, and query code stays visible.
- **Forward-only SQL migrations with a small in-repo runner.** Numbered `.sql` files, applied in a transaction, recorded in a `schema_migrations` table.
- **argon2id via `@node-rs/argon2`.** It's the OWASP-recommended algorithm, and the library ships prebuilt binaries (Windows included), so no compiler is needed.
- **`zod` for request validation** (NFR1), as deferred from spec 001.
- **CSRF defence (R2.6):** `SameSite=Lax` cookies plus an `Origin` check on every state-changing request.
- **Rate limits in memory** for the beta, behind a small interface so a later spec can move them to Redis.

## Architecture

```
backend/
  db/
    pool.js                   createPool(config) → pg.Pool
    migrate.js                runMigrations(pool), pendingMigrations(pool)
    migrations/
      0001_users_and_sessions.sql
  auth/
    passwords.js              hashPassword, verifyPassword, checkPasswordRules
    sessions.js               createSession, getSessionUser, endSession, endAllSessions
    rate-limiter.js           createRateLimiter({ limit, windowMs }) (in-memory)
    common-passwords.txt      breached-password list (see Password rules)
  repositories/
    users.repo.js             SQL for users
    sessions.repo.js          SQL for sessions
  middleware/
    require-auth.js           createRequireAuth({ db, ... }) → sets req.userId (R4)
    origin-check.js           rejects unsafe methods from unlisted origins (R2.6)
    validate.js               validate(zodSchema) → parsed req.body or ValidationError
  routes/
    auth.routes.js            /api/v1/auth/*
    me.routes.js              /api/v1/me*
  scripts/
    migrate.js                npm run db:migrate
    reset-password.js         npm run user:reset-password (D3 stopgap)
```

`createApp(config, { logger, db })` gains a `db` dependency. The request pipeline becomes:
request-logger → cors (now `credentials: true`) → cookie parser → json → **origin-check** → routes → not-found → error handler.

`middleware/auth.middleware.js` and the `jsonwebtoken` dependency are deleted (R4.4).
`routes/agent.routes.js` imports that middleware, but it isn't wired in. Its import switches to `require-auth.js`,
and the agent spec will finish wiring it.

## Data model

```sql
-- 0001_users_and_sessions.sql
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL UNIQUE,          -- stored normalized: trimmed + lowercased (R1.2)
  display_name      text NOT NULL,
  password_hash     text NOT NULL,                  -- argon2id PHC string (R1.7)
  age_confirmed_at  timestamptz NOT NULL,           -- R1.5 (18+, D2)
  terms_version     text NOT NULL,                  -- R1.6
  terms_accepted_at timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id           text PRIMARY KEY,                    -- hex SHA-256 of the cookie token, never the token
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- R4.3, R6.2
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL                 -- created_at + 30 days (R2.4)
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
```

**Deletion contract (R6.2):** every future table holding user data must reference `users(id) ON DELETE CASCADE`.
The per-spec requirements template gains a line reminding authors of this.
Deleting the user row frees the email for sign-up again (R6.3).

No IP addresses or user agents are stored on sessions. We don't need them yet, and not storing them fits the privacy bar.

## Interfaces

All bodies are JSON and validated with strict `zod` schemas, so unknown fields are rejected (NFR1).
Errors use the spec-001 shape. `user` below is always `{ id, email, displayName, createdAt }` (R5.1).

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/v1/auth/signup` | `{ email, password, displayName, ageConfirmed: true, termsVersion }` | 201 `{ user }` + session cookie | 400 `VALIDATION_ERROR`, 409 `SIGNUP_FAILED`, 429 `TOO_MANY_ATTEMPTS` |
| POST | `/api/v1/auth/login` | `{ email, password }` | 200 `{ user }` + session cookie | 400, 401 `INVALID_CREDENTIALS`, 429 |
| POST | `/api/v1/auth/logout` | — | 204, cookie cleared | — (idempotent) |
| POST | `/api/v1/auth/logout-all` | — | 204, cookie cleared | 401 |
| GET | `/api/v1/me` | — | 200 `{ user }` | 401 |
| PATCH | `/api/v1/me` | `{ displayName }` | 200 `{ user }` | 400, 401 |
| POST | `/api/v1/me/password` | `{ currentPassword, newPassword }` | 204 | 400, 401 `INVALID_CREDENTIALS` |
| DELETE | `/api/v1/me` | `{ password }` | 204, cookie cleared | 401 `INVALID_CREDENTIALS` |

**Sign-up details:**
- `ageConfirmed` must be the literal `true`. With any other value, the request fails validation before anything touches the database, so nothing is stored (R1.5).
- `termsVersion` must equal the server constant `CURRENT_TERMS_VERSION` (`"2026-09-beta"`). The terms and privacy text themselves are written in spec 014; this spec records the version and the time (R1.6).
- A duplicate email (caught by the unique-constraint violation, not a pre-check, to avoid races) → 409 `SIGNUP_FAILED`, "We couldn't create an account with those details" (R1.3).

**New error classes** in `utils/errors.js`: `ConflictError` (409), `TooManyRequestsError` (429; sets `Retry-After`).
`UnauthorizedError` gains an optional `code` argument so it can produce `INVALID_CREDENTIALS`.

## Sessions (R2, R3, R4)
- **Token:** 32 bytes from `crypto.randomBytes`, base64url-encoded. The DB `id` is `sha256(token)` in hex.
- **Cookie `sid`:** `HttpOnly; SameSite=Lax; Path=/; Max-Age=30d`, plus `Secure` when `NODE_ENV=production` (R2.5).
- **Validity:** a session is valid while `now < expires_at` **and** `now < last_seen_at + 7 days` (R2.4).
  `last_seen_at` is updated at most once an hour per session, so we don't write on every request.
- **require-auth:** reads the cookie, hashes it, and runs one query joining to `users`. If the session is
  missing, expired, idle or orphaned → `UnauthorizedError` (R4.2, R4.3). Otherwise it sets `req.userId` (R4.1).
  Every `/me` query is `WHERE id = req.userId`; no route takes a user ID from the client (R5.4).
- **Logout** deletes the session row (R3.1). **Logout-all** deletes every row for the user (R3.2).
  **Password change** deletes every row except the current one (R5.3). **Account deletion** cascades.
- **Session fixation:** every login and sign-up issues a new token. Any incoming `sid` is ended first.

## Passwords (R1.4, R1.7, R2.2)
- argon2id with the OWASP minimum parameters: memory 19 MiB, 2 iterations, parallelism 1. That's roughly 50–100 ms per hash, which fits NFR4.
- **Rules:** 12–128 characters, counted in Unicode code points, and not on the common list (case-insensitive).
  Each failure gives a specific message, e.g. "Password must be at least 12 characters", "This password is too common".
- **Common-password list:** derived from SecLists' `Pwdb_top-1000000` (MIT licence), keeping only entries
  12–128 characters long (anything shorter is already rejected). It's committed as `auth/common-passwords.txt`
  with its source and licence noted in the file header, and loaded into a `Set` at startup.
- **Timing (R2.2):** when the email doesn't exist, login still verifies against a fixed dummy argon2 hash,
  so response time doesn't reveal whether an account exists.

## Rate limiting (R1.8, R2.3)
`createRateLimiter({ limit, windowMs })` is a fixed-window counter in a `Map`, with lazy expiry and a size cap.
- **Login:** key = normalized email. A failed attempt increments the count. Once there are 5 failures in 15 minutes,
  every attempt for that email gets 429 until the window ends, *checked before the password is verified*.
  The response is identical whether or not the account exists. A successful login clears the key.
- **Sign-up:** key = `req.ip`. There are 10 attempts per hour, counted before validation.
- **Known limits:** counters reset on restart and aren't shared across instances. That's acceptable for a
  single-instance beta; moving them to Redis comes with the deployment work. `app.set('trust proxy', …)`
  is left unset until deployment, because setting it wrongly would let clients spoof `req.ip`.

## CSRF (R2.6)
- `SameSite=Lax` stops the browser sending the cookie on cross-site `POST`/`PATCH`/`DELETE` requests.
- `origin-check` adds a second layer. For unsafe methods, IF an `Origin` header is present and not in
  `config.corsOrigins` (or the server's own origin), THEN it responds 403 `FORBIDDEN_ORIGIN`.
  Requests with no `Origin` (curl, scripts) pass. Browsers always send `Origin` on these methods, and
  non-browser clients have no ambient cookie to exploit.

## Database lifecycle (R7)
- **Where it runs (D4, revised 2026-09-28):** the developer's local PostgreSQL on port 5432, with two
  databases created once by hand: `gaming_companion` (dev) and `gaming_companion_test` (tests).
  The one-time setup commands go in `backend/README.md`. Real credentials live only in the gitignored
  `backend/.env`; `.env.example` holds placeholders. The SQL uses only core Postgres features
  (`gen_random_uuid()` is built in from Postgres 13), so the same migrations will run on Neon later.
- **Config:** `DATABASE_URL` becomes required (R7.3). `TEST_DATABASE_URL` is used only by the test setup,
  which reads it from `backend/.env`. `JWT_SECRET` is removed. The spec-001 config tests are updated to
  pass a `DATABASE_URL`.
- **Safety check:** the test setup refuses to run unless the test database name ends in `_test`, so a
  misconfigured `TEST_DATABASE_URL` can never wipe the dev database.
- **Migrations:** `npm run db:migrate` applies pending files in order, each in its own transaction (R7.2).
- **Startup (R7.5):** before `listen()`, `server.js` runs `SELECT 1` and checks for pending migrations.
  - Database unreachable → logs "Database unreachable" with the error *code* only (no URL or host) and exits 1.
  - Migrations pending → logs "Pending migrations: run npm run db:migrate" and exits 1.
    The server doesn't migrate itself: applying schema changes stays a deliberate step.
- **Tests (R7.4):** Vitest `globalSetup` drops and recreates the `public` schema of the test database and
  runs every migration. DB tests truncate `users` (which cascades) in `beforeEach`. Test files run
  sequentially (`fileParallelism: false`) so truncation can't race. Tests fail with a clear
  "test database unreachable: check TEST_DATABASE_URL and that PostgreSQL is running" message if it isn't reachable.

## Manual password reset (D3 stopgap)
`npm run user:reset-password -- <email>` prompts for a new password twice (input hidden), applies the
R1.4 rules, updates the hash and ends all of that user's sessions. It's a CLI script, not an HTTP
endpoint, and runs only where `DATABASE_URL` is available. A short runbook goes in `backend/README` section "Beta support".

## Frontend (D5)
The frontend is currently all empty files, so this spec bootstraps it minimally:
- **Tooling:** Vite + React 19 + `@vitejs/plugin-react`, `"type": "module"`, and `react-router` for three routes.
- **Dev proxy:** Vite proxies `/api` → `http://localhost:3001`. The browser then sees one origin, so the
  cookie is first-party with no CORS involved. CORS with credentials is still configured for non-proxied use (NFR5).
- **Code:**
  - `src/services/api.js`: a `fetch` wrapper with `credentials: 'include'` that turns error bodies into thrown errors carrying `code`.
  - `src/context/AuthContext.jsx`: loads `GET /api/v1/me` on start and exposes `user`, `signup`, `login`, `logout`.
- **Pages:**
  - `/signup`: email, display name, password, an "I am 18 or older" checkbox, and an "I agree to the Terms and Privacy Notice" checkbox (links to a placeholder page until spec 014).
  - `/login`
  - `/`: shows "Signed in as {displayName}" and a Log out button, or links to log in or sign up.
- **Accessibility:** labelled inputs, errors announced via `role="alert"`, keyboard-only usable.
- **Tests:** Vitest + React Testing Library + jsdom, with `fetch` mocked:
  - forms submit the right payloads
  - server errors are shown
  - the auth context reflects sign-in and sign-out
- **Cleanup:** the other empty files in `frontend/` are deleted, for the same reason as spec 001 R5.2.
  *This is the one scope addition in this design; say if you'd rather keep them.*

## Security & privacy
- Never logged: passwords, hashes, cookie tokens, session IDs, emails (NFR2). Auth code logs only
  `userId` and event names (e.g. `login_failed` with no identifier, `account_deleted` with `userId`).
- `/me` responses never include `password_hash` or session data. The repository layer selects explicit columns, never `*`.
- All SQL uses parameterized queries. There's no string concatenation of user input.
- Setting a new password or deleting the account requires the current password (R5.3, R6.1).
- The cookie is `Secure` in production. There's no `Domain` attribute, so it's host-only.

## Testing strategy
| Criteria | Test |
|---|---|
| R1.1–R1.8 | `integration/auth.signup.test.js` against the real test DB, including a check that nothing is stored when age isn't confirmed, and that the stored hash starts with `$argon2id$` |
| R1.4 | `unit/passwords.test.js`: length bounds (including multi-byte characters), common list, case-insensitivity |
| R2.1–R2.6 | `integration/auth.login.test.js`: same body for wrong email vs wrong password; lockout after 5 failures for both real and fake emails; cookie flags; cross-origin POST → 403. The timing half of R2.2 is covered by the dummy-hash code path (asserted by a spy) rather than wall-clock timing, which would be flaky. |
| R2.4 | `integration/sessions.test.js` with timestamps set directly in the DB (expired, idle, fresh) |
| R3.1–R3.2 | `integration/auth.logout.test.js`: the old cookie gets 401 afterwards |
| R4.1–R4.4 | `integration/require-auth.test.js` + the spec-001 static scan extended to assert `auth.middleware.js` is gone |
| R5.1–R5.4 | `integration/me.test.js`: no hash in the response; a password change ends other sessions but not the current one |
| R6.1–R6.3 | `integration/me.delete.test.js`: rows gone, sessions gone, email reusable |
| R7.1–R7.5 | `integration/migrate.test.js` (idempotent, transactional) and `integration/startup.test.js` (unreachable DB → exit 1 with no URL in output; pending migrations → exit 1) |
| NFR1 | Unknown-field tests on each endpoint |
| NFR2 | Capturing-logger assertions across the auth tests: no password, email or token in any log line |
| NFR4 | `unit/passwords.test.js`: a hash + verify cycle is < 500 ms |
| D5 | `frontend/src/**/*.test.jsx` |
| D3 | `integration/reset-password.test.js` calls the script's exported function directly |

## Alternatives considered
- **JWT access tokens + refresh tokens.** Rejected: revocation (R3) needs server state anyway, and tokens in JS-readable storage fail R2.5.
- **An ORM (Prisma or Drizzle).** Reasonable later. For now it's an extra layer to learn on top of SQL, and Prisma adds a generate step and a binary engine.
- **`node-pg-migrate`.** Solid, but it's JS-migration-first. We only need forward-only SQL, which is about 40 lines we fully understand. We can revisit if we need down-migrations.
- **`bcrypt`.** Acceptable, but it silently truncates passwords at 72 bytes, which is awkward with a 128-character limit. argon2id is the current recommendation.
- **Have I Been Pwned range API** for breached passwords. It's stronger, but it adds a runtime network dependency and sends a hash prefix off-box on every sign-up. That's a candidate for 002b.
- **Database-backed rate limits.** Survive restarts, but add a write per login attempt. Redis is the intended home for them, later.
- **Running migrations automatically at startup.** Convenient, but it hides schema changes. Rejected in favour of an explicit command plus a startup check.
