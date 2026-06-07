---
id: 0071
title: Outcome measurement — did the fix actually reduce frustration? (close the loop)
role: architect
priority: P1
owner:
started:
status: inbox
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
