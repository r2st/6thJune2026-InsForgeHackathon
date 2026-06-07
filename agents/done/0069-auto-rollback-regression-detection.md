---
id: 0069
title: Auto-rollback & post-fix regression detection
role: architect
priority: P1
owner: claude-opus-4-8 (loop)
started: 2026-06-07
status: in-progress
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

Shipped the **pure regression-detection core** in `functions/regressionWatch.ts`
(+ 20 tests, `functions/regressionWatch.test.ts`, tsc clean):

- **detectRegression(window)** compares a baseline window to the post-merge window
  for the same (policy, route) and flags four kinds: `frustration_rise` (>50%
  per-session jump, with a min-sample guard so 1 session can't trip it),
  `new_failing_shape` (an empty/wrong-row request shape absent pre-merge),
  `safety_violation` (a widening that slipped the pre-merge rail), and
  `access_widened` (the 0033 differential suite re-run shows leakage on other
  tenants). Counts only — no raw rows.
- **regressionSeverity** — security regressions (safety/widening) dominate to
  `critical`; a new failing shape is `high`; frustration-only scales with the rate
  ratio.
- **decideRollback(finding, mode)** honors per-workspace `auto_revert` vs
  `alert_only`, but **never sits on a live leak**: a security regression opens a
  revert PR in auto mode and at least a draft revert in alert-only mode.
- **isIneffective(window, finding)** — ties to [[0071]]: a non-regression fix that
  still didn't drop frustration (≥20% relative) is flagged, not reverted.

**Seam (deferred):** the scheduled `regressionWatch` edge function that builds the
windows from the request log, the fresh fork-replay re-run feeding `accessWidened`
(reuses `replay.ts`/`safety.ts`), and the post-merge watch table + schedule in
`infra/insforge.toml`. These need the customer-backend connector [[0051]] and the
outcome-measurement metrics [[0071]] — external, stay open there.

How to verify: `pnpm -F @hush/functions test regressionWatch.test.ts`.