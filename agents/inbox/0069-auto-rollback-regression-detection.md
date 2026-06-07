---
id: 0069
title: Auto-rollback & post-fix regression detection
role: architect
priority: P1
owner:
started:
status: inbox
depends_on: [0051, 0071]
demo_path: no — product (post-hackathon)
phase: production
epic: operate-trust-grow
---

## Goal

If a merged Hush fix makes things worse — new frustration signals, a new failing
request shape, an access-widening regression — Hush detects it fast and proposes
a revert, so an auto-fixer can never quietly break prod.

## Why it matters

The scariest objection to an agent that ships code is "what if its fix is wrong?"
The answer can't only be the pre-merge safety rail; it must include post-merge
monitoring and a fast, automatic undo.

## Acceptance criteria

- [ ] After a fix merges, watch the same policy/route for: a rise in frustration
      signals, new empty/wrong-row request shapes, or a safety-rail violation that
      slipped through.
- [ ] On regression, open a **revert PR** (or draft) with the evidence and a
      verdict from a fresh fork replay showing the regression.
- [ ] A "blast radius" check post-merge: confirm the fix didn't widen access on
      *other* tenants/queries (re-run the differential suite [[0033]]).
- [ ] Configurable auto-revert vs. alert-only per workspace.
- [ ] Tie into outcome measurement ([[0071]]) — a fix that doesn't reduce
      frustration is flagged even without a hard regression.

## Likely files / surfaces touched

- `functions/regressionWatch.ts` (new, scheduled), `replay.ts`, `safety.ts`
- `infra/insforge.toml` (post-merge watch table + schedule)

## Outcome
