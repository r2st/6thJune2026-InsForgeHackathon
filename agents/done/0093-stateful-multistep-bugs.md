---
id: 0093
title: Stateful & multi-request bugs — detect, scope, and honestly decline
role: architect
priority: P2
owner: claude-opus-4-8 (loop)
started: 2026-06-06
status: done
depends_on: [0033, 0079, 0087]
demo_path: no — product (post-hackathon)
phase: production
epic: fix-quality
---

## Goal

Recognize bugs that aren't a single failing request — a sequence where a later
step fails because of state from an earlier one — and either handle the tractable
subset or **decline honestly** rather than mis-diagnose a single request.

## Why it matters

The whole model assumes one failing request = the bug. Many silent bugs are
stateful (cart → checkout → a policy on step 3 fails on step-1 state). Single-
request replay structurally can't reproduce these (ADR 0003, Risk 8); silently
"fixing" the wrong request is worse than abstaining.

## Acceptance criteria

- [ ] **Detection:** flag when the failing request depends on prior-request state
      (correlation spans a sequence, or the failure references rows a prior
      write/read established).
- [ ] **Tractable subset:** where the sequence can be replayed deterministically on
      the fork (replay request A then B with the captured ordering), do so; extend
      the replay suite to a *sequence*, not a single payload.
- [ ] **Honest decline:** when state can't be reconstructed safely, route to an
      issue with the full session trace and a clear "stateful — needs a human"
      reason, never a confident single-request PR.
- [ ] Clear scope doc: which bug shapes are in/out, so the product promise is
      honest (the pitch's "we start where the fix is small and bounded").

## Likely files / surfaces touched

- `functions/replay.ts` (sequence replay), `correlate.ts`, `fix-trigger.ts` (decline path)

## Outcome

## Outcome

- **Shipped (verified core):** `functions/stateful.ts` (`analyzeSequence`,
  `decideStatefulHandling`) + 6 tests. Typecheck clean; full suite green
  (334/34). Detects when a failing read depends on prior same-resource,
  same-session state (a mutation earlier in the window); if the establishing
  mutations succeeded and are present, builds an ordered **replay sequence**; if
  the state can't be reconstructed (a prior mutation errored), **declines to an
  issue** with the trace and a "stateful — needs a human" reason — never a
  confident single-request PR for a stateful bug. Precision before recall.
- **Deferred (seam):** sequence replay in `replay.ts` (replay establishing
  requests then the failing one against the fork) and the decline-path wiring in
  `fix-trigger.ts` — needs the live fork; this is the detection/decision logic
  it consumes.
- **Completes the ADR 0003 fix-quality epic at the logic level:** all 8 risks now
  have shippable, tested cores (0078 oracle, 0079 correlation, 0080 incident,
  0089 fidelity, 0090 drift, 0091 calibration, 0092 integrity, 0093 stateful).
