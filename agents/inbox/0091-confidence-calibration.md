---
id: 0091
title: Confidence calibration against real outcomes
role: architect
priority: P1
owner:
started:
status: inbox
depends_on: [0020, 0071, 0072]
demo_path: no — product (post-hackathon)
phase: production
epic: fix-quality
---

## Goal

A Hush "90% confidence" actually means ~90% of such fixes get merged / verified
correct — the score is measured against real outcomes and recalibrated, not just
a fixed heuristic weighting.

## Why it matters

An *uncalibrated* confidence number manufactures false trust and is worse than
none (ADR 0003, Risk 6). The tier routing (PR/draft/issue) and any autonomy
([[0070]]) are only safe if the thresholds map to reality.

## Acceptance criteria

- [ ] Log predicted confidence + signal breakdown per run, joined to the eventual
      outcome (merged / rejected / reverted / no-impact) from [[0071]] / [[0067]].
- [ ] Compute calibration (predicted vs. observed merge rate; reliability curve);
      surface mis-calibration per signal and overall.
- [ ] Recalibrate the scorer weights/thresholds from data (the weights in
      `score.ts` become *fitted*, not guessed) — versioned, reviewable changes.
- [ ] Gate autonomy ([[0070]]) on demonstrated calibration: a workspace can only
      enable auto-PR once its high-tier fixes are empirically high-merge.
- [ ] Per-workspace calibration where there's enough data; global prior otherwise.

## Likely files / surfaces touched

- `functions/score.ts` (fitted weights/thresholds), a calibration job + table
- `apps/dashboard/` (calibration/reliability view)

## Notes

- The composite + per-signal floor ([[0035]]) is the right shape to calibrate;
  this fits the numbers to outcomes instead of hand-tuning.

## Outcome
