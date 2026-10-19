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
| 015 | Deployment | Wk 11–12 | — | Neon (DB), Vercel (frontend), long-running backend host (Railway/Render/Fly); move rate limits to shared storage; `trust proxy`; secrets |
| 016 | Safeguard hardening | Before public launch | Build | From the PR #9 review: fail-closed limits, no user content or IPs in logs, no error leaks. **Blocks release** |
| R1 | Reconcile specs 001–015 with `main` | Next | — | Bring 001/002 from their branches up to date with the code; write specs for `Built, no spec` rows; check `Unverified` rows |

Frontend work for each feature goes in the same spec as its backend work, so each spec covers the whole feature end to end.
