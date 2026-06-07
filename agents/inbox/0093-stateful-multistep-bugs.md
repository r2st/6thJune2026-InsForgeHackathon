---
id: 0093
title: Stateful & multi-request bugs — detect, scope, and honestly decline
role: architect
priority: P2
owner:
started:
status: inbox
depends_on: [0033]
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
      (the correlation the signal-triage ticket spans a sequence, or the failure references rows a
      prior write/read established).
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
