# Spec Backlog — Phase 1

Ordered by dependency, following the roadmap in `docs/phase1-responsible-mvp.md`.
Status: `—` not started · `Req` requirements drafted · `Design` · `Tasks` · `Build` · `Done`

| # | Spec | Roadmap | Status | Notes |
|---|---|---|---|---|
| 001 | Backend foundation | Pre-req | Done | ESM, config, logging, errors, health, test harness |
| 002 | Users & auth | Pre-req | — | Identity is needed for per-user limits and mood history |
| 003 | Usage tracking & limits | Wk 1–2 | — | Safeguard 6; the 5 analyses/day limit |
| 004 | Crisis detection & response | Wk 1–2 | — | Safeguard 2; needs professional review |
| 005 | Mood check-ins | Wk 1–2 | — | Core feature 5 |
| 006 | Healthy gaming reminders | Wk 1–2 | — | Safeguard 1; break reminders |
| 007 | Riot match data integration | Wk 3–4 | — | Riot API, caching, rate limits |
| 008 | Match analysis | Wk 3–4 | — | Core feature 1; "strengths first" |
| 009 | Progress dashboard | Wk 3–4 | — | Core feature 4 |
| 010 | Conversational chat | Wk 5–6 | — | Core feature 2; Claude API, context |
| 011 | Personality modes | Wk 5–6 | — | Core feature 3 |
| 012 | Tilt detection | Wk 7–8 | — | Safeguard 4 |
| 013 | "I'm AI" reminders & human connection prompts | Wk 7–8 | — | Safeguards 3 & 5 |
| 014 | Onboarding, settings, resources pages | Wk 7–8 | — | Frontend |

Frontend work for each feature goes in the same spec as its backend work, so each spec covers the whole feature end to end.
