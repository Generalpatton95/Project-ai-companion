# 002 — Users & Auth: Tasks

**Status:** Approved (2026-09-28)
**Design:** ./design.md (Approved 2026-09-28)

Each task: write the failing test(s) first, then implement, then check it off when `npm test` passes.
Test titles start with the criterion ID they cover. Work happens on branch `spec/002-users-and-auth`.

### Backend — database
- [ ] 1. Local Postgres — _covers R7.1 (setup), D4 (revised)_
  - [x] 1.0 Remove the Docker setup (container, volume, `docker-compose.yml`, init script) — D4 revised 2026-09-28
  - [ ] 1.1 Austin creates `gaming_companion` and `gaming_companion_test` on local Postgres and puts `DATABASE_URL` / `TEST_DATABASE_URL` in `backend/.env`
  - [ ] 1.2 Confirm both databases accept connections and record the server version

- [ ] 2. Config changes — _covers R7.3, R4.4 (partly)_
  - [ ] 2.1 Update `unit/config.test.js`: `DATABASE_URL` required (missing → `ConfigError` naming it); `JWT_SECRET` gone; `.env.example` test updated (`DATABASE_URL`, `TEST_DATABASE_URL`, no `JWT_SECRET`)
  - [ ] 2.2 Implement in `config/index.js` and `.env.example`; update the other spec-001 tests to pass a `DATABASE_URL`

- [ ] 3. Pool, migrations and test DB harness — _covers R7.2, R7.4_
  - [ ] 3.1 Write `integration/migrate.test.js`: applies in order, records in `schema_migrations`, re-running is a no-op, a failing migration rolls back entirely
  - [ ] 3.2 Implement `db/pool.js`, `db/migrate.js`, `scripts/migrate.js`, `npm run db:migrate`
  - [ ] 3.3 Vitest `globalSetup` (fresh schema + migrate on the test DB, clear message if unreachable), a shared `resetDb()` helper, `fileParallelism: false`
  - [ ] 3.4 Write `0001_users_and_sessions.sql`; add the cascade-deletion reminder line to `specs/_templates/requirements.md` (R6.2)

- [ ] 4. Startup checks — _covers R7.5_
  - [ ] 4.1 Extend `integration/startup.test.js`: unreachable DB → exit 1, output has no URL or host; pending migrations → exit 1 with the migrate hint; healthy DB → listening
  - [ ] 4.2 Implement in `server.js`; `createApp` takes `db`

### Backend — auth building blocks
- [ ] 5. Errors — _covers R1.3, R2.2, R2.3 (error types)_
  - [ ] 5.1 Extend `unit/errors.test.js`: `ConflictError` 409, `TooManyRequestsError` 429 carrying `retryAfterSeconds`, `UnauthorizedError` with a custom code
  - [ ] 5.2 Implement; the error handler sets `Retry-After` for 429s

- [ ] 6. Passwords — _covers R1.4, R1.7, NFR4_
  - [ ] 6.1 Build `auth/common-passwords.txt` from SecLists `Pwdb_top-1000000` (entries 12–128 chars, source and licence header)
  - [ ] 6.2 Write `unit/passwords.test.js`: length bounds in code points, common list (case-insensitive), specific messages, `$argon2id$` prefix, verify true/false, hash + verify < 500 ms
  - [ ] 6.3 Implement `auth/passwords.js` (add `@node-rs/argon2`)

- [ ] 7. Rate limiter — _covers R1.8, R2.3 (mechanism)_
  - [ ] 7.1 Write `unit/rate-limiter.test.js` with fake timers: counts within the window, blocks at the limit, resets after the window, `clear(key)`, size cap
  - [ ] 7.2 Implement `auth/rate-limiter.js`

- [ ] 8. Validation middleware — _covers NFR1_
  - [ ] 8.1 Write `unit/validate.test.js`: valid body is parsed; unknown field, wrong type and missing field → `ValidationError` with a field-specific message
  - [ ] 8.2 Implement `middleware/validate.js` (add `zod`)

- [ ] 9. Origin check — _covers R2.6_
  - [ ] 9.1 Write `integration/origin-check.test.js`: unsafe method + unlisted Origin → 403 `FORBIDDEN_ORIGIN`; listed Origin passes; no Origin passes; GET is never blocked
  - [ ] 9.2 Implement `middleware/origin-check.js`; wire into `app.js`; enable `credentials: true` in CORS

- [ ] 10. Repositories and sessions — _covers R2.4, R4.1–R4.3_
  - [ ] 10.1 Write `integration/sessions.test.js`: create → DB row holds the hash, not the token; expired, idle and orphaned sessions are invalid; `last_seen_at` is touched at most hourly; end one / end all / end all except current
  - [ ] 10.2 Implement `repositories/users.repo.js`, `repositories/sessions.repo.js` (explicit columns, parameterized) and `auth/sessions.js`
  - [ ] 10.3 Write `integration/require-auth.test.js` (R4.1–R4.3), implement `middleware/require-auth.js`

### Backend — endpoints
- [ ] 11. Sign-up — _covers R1.1–R1.8, R2.5, NFR2, NFR3_
  - [ ] 11.1 Write `integration/auth.signup.test.js` (cookie flags; normalized email; duplicate → 409 generic; age/terms failures store nothing; 11th attempt in an hour → 429; unknown fields → 400; no email, password or token in logs)
  - [ ] 11.2 Implement the signup route in `routes/auth.routes.js`

- [ ] 12. Login — _covers R2.1–R2.3, NFR2–NFR3_
  - [ ] 12.1 Write `integration/auth.login.test.js` (identical 401 body for wrong email vs wrong password; dummy-hash path used for unknown emails; lockout after 5 failures for real and fake emails, identical responses; success clears the counter; new token on every login)
  - [ ] 12.2 Implement

- [ ] 13. Logout — _covers R3.1, R3.2_
  - [ ] 13.1 Write `integration/auth.logout.test.js` (a copied old cookie → 401 after logout; logout-all ends other devices; logout is idempotent)
  - [ ] 13.2 Implement

- [ ] 14. Profile — _covers R5.1–R5.4_
  - [ ] 14.1 Write `integration/me.test.js` (no hash or session data in the response; display name trimmed, 1–40 chars, control characters rejected; password change needs the current password, applies the rules, keeps the current session, ends the others; no route accepts a user ID)
  - [ ] 14.2 Implement `routes/me.routes.js` (GET, PATCH, POST password)

- [ ] 15. Account deletion — _covers R6.1–R6.3_
  - [ ] 15.1 Write `integration/me.delete.test.js` (wrong password → 401 and nothing deleted; success → user and sessions gone, cookie cleared, email reusable)
  - [ ] 15.2 Implement `DELETE /api/v1/me`

- [ ] 16. Remove old JWT auth — _covers R4.4_
  - [ ] 16.1 Extend `integration/esm.test.js`: `middleware/auth.middleware.js` is gone; no source imports `jsonwebtoken`
  - [ ] 16.2 Delete the file, switch `routes/agent.routes.js` to `require-auth.js`, remove `jsonwebtoken`

- [ ] 17. Manual reset script — _covers D3_
  - [ ] 17.1 Write `integration/reset-password.test.js` against the exported function: applies the password rules, updates the hash, ends all sessions, fails cleanly for an unknown email
  - [ ] 17.2 Implement `scripts/reset-password.js` (hidden prompt) + `npm run user:reset-password`; write the "Beta support" runbook in `backend/README.md`

### Frontend
- [ ] 18. Bootstrap — _covers D5, NFR5_
  - [ ] 18.1 Delete the empty placeholder files in `frontend/` (design scope addition)
  - [ ] 18.2 Vite + React 19 + `@vitejs/plugin-react` + `react-router`, `"type": "module"`, dev proxy `/api` → `:3001`, `index.html`, `src/main.jsx`
  - [ ] 18.3 Vitest + React Testing Library + jsdom; a smoke test renders the app

- [ ] 19. API client and auth context — _covers D5_
  - [ ] 19.1 Write tests: `api.js` sends `credentials: 'include'` and throws errors carrying `code`; `AuthContext` loads `/me` on start, and `login` / `signup` / `logout` update `user`
  - [ ] 19.2 Implement `src/services/api.js`, `src/context/AuthContext.jsx`

- [ ] 20. Pages — _covers D5 (and the UI side of R1.5, R1.6)_
  - [ ] 20.1 Write tests: sign-up sends the right payload (including `termsVersion`), can't submit without both checkboxes, shows server errors via `role="alert"`; login shows the generic error; home shows the display name and logs out
  - [ ] 20.2 Implement `/signup`, `/login`, `/`, and a placeholder terms/privacy page

### Wrap-up
- [ ] 21. End-to-end smoke check — _covers NFR5_
  - [ ] 21.1 With the DB, backend and `npm run dev` frontend running: sign up, reload (still signed in), log out, log in, check the cookie flags in the browser. Record the result below.

- [ ] 22. Checkpoint — ask Austin to review the diff and approve a commit

## Verification
- [ ] Every acceptance criterion (R1.1–R7.5, NFR1–NFR5) and decision D3/D5 maps to a passing test or a recorded manual check
- [ ] `npm test` passes in `backend/` and `frontend/`
- [ ] Manual smoke check (task 21): ___
- [ ] Spec status set to `Done` and BACKLOG updated
