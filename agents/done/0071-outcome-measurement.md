---
id: 0071
title: Outcome measurement — did the fix actually reduce frustration? (close the loop)
role: architect
priority: P1
owner: claude-opus-4-8 (loop)
started: 2026-06-07
status: in-progress
depends_on: [0050, 0057]
demo_path: no — product (post-hackathon)
phase: production
epic: operate-trust-grow
---

## Goal

For every shipped fix, measure whether the real-world signal it targeted actually
went away — fewer rage-clicks / empty pages / failing requests on that route —
and surface that as the product's ROI and a feedback signal.

## Why it matters

"We opened a PR" is an output; "the customer stopped leaving" is the outcome that
justifies the product and retention. It also closes the learning loop honestly: a
fix that merges but doesn't move the signal is a weak fix.

## Acceptance criteria

- [ ] Baseline + post-fix comparison of the targeted signal (frustration rate,
      empty-result rate, error rate) per route/policy, over a defined window.
- [ ] A per-fix "impact" score on the run + dashboard ([[0054]]): signal before
      vs after, statistically meaningful or "inconclusive — too little traffic".
- [ ] Workspace-level ROI rollup: bugs caught, fixes shipped, frustration averted,
      support tickets likely avoided.
- [ ] Feed impact back into Memoir/confidence ([[0043]]) and regression watch
      ([[0069]]) — a high-confidence fix with no impact is a learning signal.
- [ ] Honest "not enough data" states — never fabricate an impact number.

## Likely files / surfaces touched

- `functions/outcome.ts` (new, scheduled), request_log/signal aggregation
- `infra/insforge.toml` (impact metrics), `apps/dashboard/` (ROI view)

## Outcome

Shipped the **pure outcome-measurement core** in `functions/outcome.ts` (+ 15
tests, `functions/outcome.test.ts`, tsc clean):

- **measureImpact(before, after)** — compares the targeted signal's rate across a
  baseline vs post-fix window with a real **two-proportion z-test** (`|z| ≥ 1.96`
  ⇒ p < 0.05). Verdict is `improved` / `no_change` / `worsened`, and explicitly
  `inconclusive` when either window has < `MIN_OBSERVATIONS` (30) — it never
  fabricates an impact number from thin traffic.
- **isCalibrationMiss(confidence, impact)** — a high-confidence fix (≥80) that
  shipped with no measurable improvement is a learning signal fed back to
  [[0043]]/Memoir confidence and [[0069]] regression watch; `inconclusive` is
  never counted as a miss.
- **workspaceRoi(outcomes)** — ROI rollup: bugs caught, fixes shipped, fixes with
  *proven* impact, frustration averted (baseline volume × proven relative
  reduction), and support tickets likely avoided (10% escalation heuristic). Only
  significant `improved` fixes contribute — honest numbers only.

**Seam (deferred):** the scheduled `outcome` aggregator that builds the windows
from request_log/signal aggregation, persisting impact metrics in
`infra/insforge.toml`, and the dashboard ROI view [[0054]]. These depend on the
site connector [[0050]] and observability [[0057]] — external, stay open there.

How to verify: `pnpm -F @hush/functions test outcome.test.ts`.