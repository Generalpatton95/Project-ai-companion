# 002 — Users & Auth: Requirements

**Status:** Approved (2026-09-28)
**Related docs:** `docs/mvp-specification.md` (§1 User Authentication, Technology Stack), `docs/phase1-responsible-mvp.md` (Safeguard 6, Launch Checklist)
**Depends on:** 001 — Backend foundation (Done)

## Introduction
Every Phase 1 safeguard is per-person. The 5-analyses-a-day limit, mood history, break reminders
and tilt detection all need to know *who* is using the app. This spec gives the backend user
accounts: sign up, log in, log out, a protected-route mechanism, a basic profile, and account
deletion. It is also the first spec that stores data, so it introduces the database.

This app will later hold sensitive wellbeing data (mood check-ins, crisis-keyword events). The
account system is therefore held to a higher privacy bar than a typical hobby project. Users must be
able to leave and take their data with them (deletion now, export later). Nothing about an account
should leak through error messages or logs.

## Requirements

### R1 — Sign up
**User story:** As a new player, I want to create an account with my email and a password, so that the companion can remember me and my progress.

**Acceptance criteria**
- R1.1 — WHEN a visitor submits a valid email, password, display name, age confirmation and acceptance of the terms, the system shall create an account and start a signed-in session.
- R1.2 — The system shall treat emails as case-insensitive and ignore surrounding whitespace, so `Me@X.com` and `me@x.com ` are the same account.
- R1.3 — IF the email is already registered, THEN the system shall reject the sign-up with 409 `SIGNUP_FAILED` and a generic message that does not say the email is registered. *Known limitation:* a failed sign-up still implies that the account exists. Fully preventing that needs email delivery (Q3, spec 002b), so sign-up is rate-limited (R1.8) to slow down anyone probing for accounts.
- R1.8 — IF one client makes more than 10 sign-up attempts in an hour, THEN the system shall reject further attempts from it for the rest of that hour with 429 `TOO_MANY_ATTEMPTS`.
- R1.4 — IF the password is shorter than 12 characters or longer than 128 characters, or appears on a list of common breached passwords, THEN the system shall reject it with a `VALIDATION_ERROR` that says why.
- R1.5 — IF the visitor does not confirm they meet the minimum age (see Q2), THEN the system shall reject the sign-up and shall not store any of the submitted data.
- R1.6 — The system shall record which version of the terms and privacy notice the user accepted, and when.
- R1.7 — The system shall store passwords only as a salted hash produced by a slow, memory-hard algorithm, never in plain text or with reversible encryption.

### R2 — Log in and sessions
**User story:** As a returning player, I want to log in and stay logged in on my device, so that I don't have to re-enter my password every visit.

**Acceptance criteria**
- R2.1 — WHEN a user submits a correct email and password, the system shall start a signed-in session.
- R2.2 — IF the email or password is wrong, THEN the system shall respond 401 `INVALID_CREDENTIALS` with the same message and similar response time whichever one was wrong.
- R2.3 — IF there are 5 failed login attempts for one email within 15 minutes, THEN the system shall reject further attempts for that email for 15 minutes with 429 `TOO_MANY_ATTEMPTS`. The same response applies whether or not the account exists.
- R2.4 — A session shall stay valid for at most 30 days, with inactive sessions expiring after 7 days.
- R2.5 — The session credential shall not be readable by page JavaScript, to limit damage from cross-site scripting.
- R2.6 — The system shall protect session-authenticated state-changing requests against cross-site request forgery.

### R3 — Log out
**User story:** As a player, I want to log out, so that nobody else using my device can get into my account.

**Acceptance criteria**
- R3.1 — WHEN a signed-in user logs out, the system shall end that session immediately, so its credential no longer works even if it was copied.
- R3.2 — WHEN a signed-in user chooses "log out everywhere", the system shall end all of that user's sessions.

### R4 — Protected routes
**User story:** As a developer, I want a single, reliable way to require sign-in on a route, so that later features (usage limits, mood, analysis) can't accidentally skip it.

**Acceptance criteria**
- R4.1 — The system shall provide one middleware that, WHEN a request has a valid session, makes the current user's ID available to the handler.
- R4.2 — IF a request to a protected route has no session, or an expired or ended one, THEN the system shall respond 401 `UNAUTHORIZED` in the standard error shape from spec 001.
- R4.3 — IF the user behind a session has been deleted, THEN the system shall treat the session as invalid.
- R4.4 — The existing `middleware/auth.middleware.js` (JWT from spec-001 conversion) shall be replaced by this middleware or deleted.

### R5 — Profile
**User story:** As a player, I want to see and edit my basic profile, so that the companion addresses me the way I want.

**Acceptance criteria**
- R5.1 — WHEN a signed-in user requests their profile, the system shall return their ID, email, display name and account creation date, and never the password hash or session data.
- R5.2 — WHEN a signed-in user updates their display name, the system shall save it if it is 1–40 characters after trimming whitespace.
- R5.3 — WHEN a signed-in user changes their password, the system shall require their current password, apply the R1.4 rules, and end all their other sessions.
- R5.4 — A user shall only ever be able to read or change their own profile.

### R6 — Account deletion
**User story:** As a player, I want to permanently delete my account, so that I control my data, especially the wellbeing data later features will store.

**Acceptance criteria**
- R6.1 — WHEN a signed-in user requests deletion and re-enters their password, the system shall permanently delete the account and end all its sessions.
- R6.2 — The data model shall make deletion cascade, so every user-owned record added by later specs is deleted with the account. Each later spec that stores user data must state how it is deleted.
- R6.3 — WHEN an account is deleted, the email shall become available to sign up again.

### R7 — Data storage
**User story:** As a developer, I want a real database with versioned schema changes, so that accounts survive restarts and every later spec can add tables safely.

**Acceptance criteria**
- R7.1 — The system shall store users and sessions in PostgreSQL, which the tech stack in `docs/mvp-specification.md` already names.
- R7.2 — Schema changes shall be applied through versioned migration files kept in the repo, never by hand.
- R7.3 — `DATABASE_URL` shall become a required config key (per spec 001, R1.4).
- R7.4 — Automated tests shall run against a real PostgreSQL database that is isolated from development data and reset between test runs.
- R7.5 — IF the database is unreachable at startup, THEN the server shall log that clearly (without the connection string) and exit non-zero.

## Non-functional requirements
- **NFR1 — Input validation:** Every auth and profile endpoint shall validate its request body against a schema and reject unknown fields with `VALIDATION_ERROR`.
- **NFR2 — No sensitive logging:** Passwords, password hashes, session credentials and full email addresses shall never be logged. The 001 request logger already excludes bodies and headers; application logs must follow the same rule.
- **NFR3 — Limit account enumeration:** Login and lockout responses shall not reveal whether an email is registered (R2.2, R2.3). Sign-up can't fully hide it until email delivery exists, so it is limited by generic wording and rate limiting (R1.3, R1.8).
- **NFR4 — Performance:** Login shall respond in under 1 second on a dev machine, including password hashing.
- **NFR5 — Frontend-ready:** Endpoints shall work from the Vite dev origin under the spec-001 CORS allowlist, including credentials.

## Out of scope
- **Email delivery:** email verification, password reset by email and email change. See Q3.
- Social or third-party login (Google, Discord, Riot Sign-On)
- Linking a Riot account or summoner name (spec 007)
- Subscription tiers and payments (the free/paid split in Safeguard 6 is handled in spec 003)
- Roles and admin accounts
- Data export (a later privacy spec; deletion is covered here)
- Frontend screens: sign-up and login UI are built with spec 014 (onboarding), unless you want them here (Q5)

## Decisions (resolved 2026-09-28)
- **D1 — Build or buy:** Build it ourselves with vetted libraries; keep scope small.
- **D2 — Minimum age:** 18+ for the beta, confirmed by checkbox. Revisit after the professional review.
- **D3 — Email flows:** Deferred to spec 002b before public launch. Stopgap: a documented manual password-reset script for beta users.
- **D4 — Dev database:** ~~PostgreSQL in Docker Compose.~~ *Revised 2026-09-28:* the developer's local PostgreSQL install, with separate `gaming_companion` and `gaming_companion_test` databases. No Docker. Deployed environments (Neon for the database, Vercel for the frontend, a long-running host for the backend) are decided in the Deployment spec.
- **D5 — Frontend:** Minimal sign-up, login and logout screens plus an auth context in this spec; profile editing and deletion UI come with spec 014.
