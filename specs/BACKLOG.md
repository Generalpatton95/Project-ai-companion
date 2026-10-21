# Spec Backlog — Phase 1

Ordered by dependency, following the roadmap in `docs/phase1-responsible-mvp.md`.
Status: `—` not started · `Req` requirements drafted · `Design` · `Tasks` · `Build` · `Done`
· `Built, no spec`: code is on `main` (PR noted) but has no approved spec in `specs/`
· `Unverified`: some code exists, but nobody has checked what it covers

> **Reconciliation note (2026-10-19):** PRs #1–#9 were merged to `main` from cloud sessions without specs in this folder. Specs 001 and 002 were written and approved (2026-09-28) on the `spec/001-backend-foundation` and `spec/002-users-and-auth` branches, but the code no longer matches them. For example, 001 specifies ESM, and the backend uses CommonJS. Item **R1** below covers bringing them back in line. Until then, the specs for rows marked `Built, no spec` should be written to describe the existing code, then gaps fixed through the normal gates.

| # | Spec | Roadmap | Status | Notes |
|---|---|---|---|---|
| 001 | Backend foundation | Pre-req | Built, spec out of date | Spec on branch `spec/001-backend-foundation`; ESM, config, logging, errors, health, test harness |
| 002 | Users & auth | Pre-req | Built, spec out of date | Spec on branch `spec/002-users-and-auth`; email + password login merged in PR #4 |
| 002b | Email verification & password reset | Before public launch | — | Deferred from 002 (D3); needs a transactional email service |
| 003 | Usage tracking & limits | Wk 1–2 | Built, no spec | PR #2; Safeguard 6; the 5 analyses/day limit. 016 makes it fail closed |
| 004 | Crisis detection & response | Wk 1–2 | Built, no spec | PR #2; Safeguard 2; **needs professional review** |
| 005 | Mood check-ins | Wk 1–2 | Built, no spec | PR #3; Core feature 5 |
| 006 | Healthy gaming reminders | Wk 1–2 | Built, no spec | PR #3; Safeguard 1; break reminders |
| 007 | Riot match data integration | Wk 3–4 | Unverified | `integrations/riot-games.js` and `tools/game-api.tool.js` come from the initial scaffold |
| 008 | Match analysis | Wk 3–4 | Built, no spec | PRs #6–#8; Core feature 1; "strengths first", background tasks |
| 009 | Progress dashboard | Wk 3–4 | Unverified | `frontend/src/pages/Dashboard.jsx` exists |
| 010 | Conversational chat | Wk 5–6 | Built, no spec | PR #5; Core feature 2; Claude API, streaming |
| 011 | Personality modes | Wk 5–6 | Built, no spec | PR #5; Core feature 3 |
| 012 | Tilt detection | Wk 7–8 | — | Safeguard 4 |
| 013 | "I'm AI" reminders & human connection prompts | Wk 7–8 | — | Safeguards 3 & 5 |
| 014 | Onboarding, settings, resources pages | Wk 7–8 | Unverified | Welcome screen in PR #3; `Settings.jsx` and `Profile.jsx` exist |
| 015 | Deployment | Wk 11–12 | — | Neon (DB), Vercel (frontend), long-running backend host (Railway/Render/Fly); move rate limits to shared storage; `trust proxy`; secrets; rate-limit `/health` and the 404 handler (016 review); add the deploy workflow (the empty `deploy.yml` placeholder was removed 2026-10-21 because it failed every push) |
| 016 | Safeguard hardening | Before public launch | Done (PR #11) | From the PR #9 review: fail-closed limits, no user content or IPs in logs, no error leaks. **Blocks release until PR #11 merges** |
| 017 | Usage-limit concurrency | Before public launch | Done (PR #14) | Spec `specs/017-usage-limit-concurrency/`, done 2026-10-21. From the 016 review: simultaneous `/analyze` requests can pass the daily cap (check happens before the count is recorded); needs reserve-then-refund. Also Postgres `connectionTimeoutMillis` / `statement_timeout`. Also: while Redis is down, `Redis error` is logged on every reconnect attempt (about every 2s); log only the first failure and the recovery |
| 018 | Limit and outage wording | Before public launch | — | From the 016 sign-off: kinder wording than 'Rate limit exceeded' and the outage message (and, from 017 D3, the chat 'The companion is unavailable right now…' message), and a short line introducing the crisis resources. Needs the mental-health review (README rule 6) |
| 019 | Outage follow-ups | Before public launch | — | Left from the 017 review (017 D6): a fixed `reason` on `store_unavailable` (pool wait vs connect vs read vs statement timeout) and log the route pattern instead of `req.path` (also in `request-log.middleware.js`); skip `ROLLBACK` after pg's client-side read timeout (a hung network takes ~12s instead of ~6s to fail); `crypto.randomUUID()` task ids instead of `Math.random`; decide whether timed-out analyses should still refund their slot (Claude-cost exposure, capped by the rate limit); errors from outside services that carry socket codes are logged as `store_unavailable` |
| 018b | Crisis response during outages | Before public launch | — | From the 017 safeguards review: during a Redis or Postgres outage, a chat message with crisis language gets the outage 503 + resources, not the crisis response, and the conversation isn't ended. Also (017 manual check, owner decision 2026-10-21): with Postgres down, the app's start-up check (`GET /api/auth/me`) fails and the whole page shows "Couldn't reach the server." with no resources, so chat can't be reached; list the existing resources there. Changing the crisis flow **needs professional review** (README rule 6) |
| D1 | Dev-tool upgrades | Before public launch | — | `npm audit` findings left after PR #12, dev tools only (not shipped): backend `jest` 30 and `nodemon`; frontend `vitest` 5. Major upgrades, so each needs its own test run |
| R1 | Reconcile specs 001–015 with `main` | Next | — | Bring 001/002 from their branches up to date with the code; write specs for `Built, no spec` rows; check `Unverified` rows |

Frontend work for each feature goes in the same spec as its backend work, so each spec covers the whole feature end to end.
