---
id: 0030
title: Orchestrate diagnose → test → ship in functions/fix-trigger.ts
role: architect
priority: P0
owner:
started:
status: inbox
depends_on: [0005, 0008, 0011, 0018, 0020, 0021]
demo_path: yes — this is the function the receipt page is waiting on
---

## Goal

Fill in `functions/fix-trigger.ts` — the edge function that, given one
captured session, drives the whole loop:

1. `correlate.ts` → `capture.ts` → `ReplayPayload`
2. `toml.ts` extracts the table slice → `diagnose.ts` returns `Diagnosis`
3. `safety.ts` checks the diff doesn't widen access
4. Branch pull + `applyDiff.ts` + `forgeJwt.ts` + `replay.ts` → `Verdict`
5. `score.ts` → tier
6. `score`-driven branch: PR (0011) / draft PR / GitHub issue

Each step emits a Realtime event to `hush:session:<id>` so the receipt
page (0009 / 0015 / 0022) renders progress in real time.

## Why it matters for the demo

This is the single function that takes us from "session captured ✓" on
the receipt page to "shipped" in under 45 seconds. Every individual
stage already has its owning ticket. This ticket is the glue.

Without it, the demo shows isolated working subsystems instead of a loop.

## Acceptance criteria

- [ ] `fix-trigger.ts` is invoked by `ingest.ts` once `/capture` succeeds.
- [ ] Each stage runs with a timeout (per the budget table in
      `docs/architecture.md` §latency).
- [ ] Every stage publishes one Realtime event with `{ stage, status,
      timestamp }`. Failure publishes `{ stage, status: 'errored',
      error }` and stops the loop cleanly.
- [ ] Verdict.ok=false → drops to draft PR with the failing trace.
- [ ] Safety-rail violation → hard stop, drops to GitHub issue.
- [ ] Top-of-file comment documents the five stages and which tickets
      own each.

## Likely files / surfaces touched

- `functions/fix-trigger.ts` (the orchestrator)
- `functions/ingest.ts` (invokes fix-trigger asynchronously after `/capture`)
- `functions/types.ts` (the `StageEvent` payload type, if missing)

## Notes

The stage tickets (0005, 0008, 0011, 0018, 0020, 0021) all return strict
types from `functions/types.ts`. Don't reshape their outputs here — if
something needs reshaping, fix it in the owning stage. This function
should be ~100 LOC of glue, not business logic.

## Outcome
<!-- Fill in when moving to done/. -->
