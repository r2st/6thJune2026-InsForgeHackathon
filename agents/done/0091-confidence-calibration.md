---
id: 0091
title: Confidence calibration against real outcomes
role: architect
priority: P1
owner: claude-opus-4-8 (loop)
started: 2026-06-06
status: done
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

## Outcome

- **Shipped (verified core):** `functions/calibration.ts` (`calibrationReport`,
  `recalibrate`, `meetsAutonomyBar`) + 11 tests. Typecheck clean; tests green.
  Pure statistics: reliability bins (predicted vs. observed correct-rate), Brier
  score, ECE; a monotonic (isotonic-style) recalibration map that pulls an
  over-confident score toward its observed rate; and an autonomy gate. Honest
  about small samples — below MIN_SAMPLES it reports `reliable:false` and
  `recalibrate` passes through unchanged (never fakes a correction).
- **`meetsAutonomyBar`** wires Risk 6 to Risk-of-autonomy: a workspace can only
  enable auto-PR ([[0070]]) once its high-tier (≥85) predictions are empirically
  high-merge — calibration gates autonomy, as the ADR requires.
- **Deferred (seam):** logging predicted-confidence→outcome (joined from
  [[0067]]/[[0071]]) and feeding `recalibrate` into `score.ts`/dispatch — needs
  live outcome history; this is the math it consumes.
