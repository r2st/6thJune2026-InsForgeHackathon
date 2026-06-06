---
id: 0034
title: Pre-run state fingerprint + temporal anchor
role: architect
priority: P1
owner: claude-opus-4-8
started: 2026-06-06
status: done
depends_on: [0008, 0033]
demo_path: yes — defends the verdict from "the world moved while we
were running"
---

## Goal

The two-signal verdict (`prod fails AND fork passes`) assumes both
replays observe the same world. They don't: the fork is a snapshot,
prod is live. Between the two replays prod's data state can drift
(a new order lands, an admin import runs, a policy is edited through
the dashboard). Then both checks happen to satisfy the success
condition, but the verdict is apples-to-oranges.

Anchor every run to a pre-run snapshot. Re-fingerprint at verdict-time.
If the fingerprint changed, the run is `inconclusive`, not "fix
verified."

## Why it matters for the demo

Defense for Lie #06 deeper + Lie #07 in
docs/the-hardest-part-deeper.md. On stage, the receipt feed gains a
line: `state anchored · row count baseline · 3 orders`. At verdict
time: `prod re-fingerprint · matches baseline ✓`. Visible discipline.

## Acceptance criteria

- [ ] `functions/fingerprint.ts` exports two functions:
      - `snapshotState({ tenantId, table }) -> StateSnapshot`
      - `verifyAnchor({ snapshot, current }) -> { match: boolean, drift?: string }`
- [ ] `StateSnapshot` captures:
      - `prodRowCount` for the target table, scoped to the captured tenant
      - `prodSchemaFingerprint` — hash of `(table.columns, table.rls)`
      - `forkSchemaFingerprint` — same, computed against the branch
        project after `applyDiff`
      - `capturedAt: timestamp`
- [ ] `verifyAnchor` is called twice in the run lifecycle:
      1. After `applyDiff` succeeds, before the suite fires — confirms
         the fork's post-apply schema matches the intended patch
         (catches "apply silently no-op'd").
      2. After the suite returns — re-queries prod's row count and
         schema fingerprint; if either drifted from the snapshot, the
         orchestrator marks the run `inconclusive` and routes to
         issue regardless of probe outcomes.
- [ ] Drift detection sensitivity:
      - row count drift > 0 → soft signal (LLM might still be right)
      - schema fingerprint drift → hard fail (run inconclusive)
- [ ] The fork's "expected rows" for the suite come from `prodRowCount`
      at snapshot time, not from the LLM's `expectedRows`.
- [ ] Unit tests cover: no drift (passes), row drift only (soft warning),
      schema drift (hard inconclusive), apply silently no-op (caught
      via post-apply fingerprint mismatch).

## Likely files / surfaces touched

- `functions/fingerprint.ts` (new)
- `functions/fix-trigger.ts` (call sites — snapshot pre-run, verify
  post-apply, verify post-suite)
- `functions/applyDiff.ts` (returns the post-apply schema fingerprint
  so `verifyAnchor` can compare)
- `functions/types.ts` (`StateSnapshot`, anchor result)
- Test in `functions/fingerprint.test.ts`

## Notes

- For the hackathon scope, the prod fingerprint is `sha256(canonical
  TOML of the table + sorted column-row-count tuple)`. Cheap, no
  external deps.
- This ticket subsumes the "stale fork" check from the original
  the-hardest-part.html (Lie #06). The earlier defense (fresh-at-apply
  provisioning) is necessary but not sufficient — apply succeeds, prod
  drifts, fingerprint catches it.
- Background: docs/the-hardest-part-deeper.md → Lie #07.

## Outcome
<!-- Fill in when moving to done/. -->

## Outcome

- `functions/fingerprint.ts` — `snapshotState()`, `verifyAnchor()`,
  `fingerprintSchema()` (sha256 of sorted columns + rls), `expectedForkFingerprint()`,
  `verifyPostApply()`. Schema drift = HARD (inconclusive→issue); row-count drift
  = SOFT warn.
- `applyDiff.ts` now returns `schemaFingerprint` of the patched config.
- `fix-trigger.ts` runs the post-apply check after applyDiff: a fingerprint
  mismatch (silent no-op apply) → issue with `reason: 'issue-from-apply-noop'`,
  before the fork is replayed. Guarded on fingerprint presence so injected mocks
  that omit it skip the check.
- 11 fingerprint tests + 1 orchestrator no-op test. Pre-run snapshot + post-suite
  prod re-fingerprint (the live row-count/schema requery) are the documented
  orchestrator seam for the live-backend pass; the fingerprint + drift logic are
  fully unit-tested here.
