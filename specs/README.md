# Specs — How We Build

This project uses **spec-driven development**: no feature code is written until its spec is approved, and every change to behavior starts as a change to the spec.

## Where things live

```
specs/
  README.md            ← this file (the process)
  BACKLOG.md           ← ordered list of specs to write, with status
  _templates/          ← starting points for each spec document
  NNN-feature-name/
    requirements.md    ← WHAT and WHY: user stories + acceptance criteria
    design.md          ← HOW: architecture, interfaces, data, error handling
    tasks.md           ← STEPS: small, ordered, testable implementation tasks
```

Product-level context (vision, principles, safeguards) lives in `docs/` — especially
`docs/phase1-responsible-mvp.md`. Specs reference those docs rather than restating them.

## The workflow (three gates)

| Phase | Output | Gate |
|---|---|---|
| 1. Requirements | `requirements.md` | Approved by Austin before design starts |
| 2. Design | `design.md` | Approved by Austin before tasks are written |
| 3. Tasks | `tasks.md` | Approved by Austin before any code is written |
| 4. Implement | Code + tests, one task at a time | Each task: tests pass, task checked off |
| 5. Verify | Every acceptance criterion traced to a passing test or manual check | Spec status → `Done` |

Each document carries a status line at the top: `Draft` → `Approved` → (`Done` for the whole spec).

## Rules

1. **Spec first.** No implementation code without an approved `tasks.md`. Exploratory spikes are allowed but are thrown away, not merged.
2. **Acceptance criteria use EARS format** so they are testable:
   - *Ubiquitous:* `The system shall …`
   - *Event:* `WHEN <trigger>, the system shall …`
   - *State:* `WHILE <state>, the system shall …`
   - *Unwanted:* `IF <condition>, THEN the system shall …`
   - *Optional:* `WHERE <feature is enabled>, the system shall …`
3. **Every criterion has an ID** (`R2.3` = requirement 2, criterion 3). Tests name the IDs they cover, e.g. `test('R2.3: returns 404 JSON for unknown routes', …)`.
4. **Tasks trace back.** Each task in `tasks.md` lists the criterion IDs it satisfies.
5. **Change the spec, then the code.** If implementation reveals the spec is wrong, stop, update the spec (and get it re-approved if requirements change), then continue.
6. **Safeguard specs need extra review.** Anything touching crisis detection, mood, or wellbeing messaging must note which parts need review by a mental health professional before launch (see `docs/phase1-responsible-mvp.md`).
7. **Out of scope is written down.** Each requirements doc says what it deliberately does *not* cover.
