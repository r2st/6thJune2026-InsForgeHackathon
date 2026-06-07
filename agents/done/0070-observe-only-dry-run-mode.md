---
id: 0070
title: Observe-only / dry-run mode + graduated trust onboarding
role: builder
priority: P0
owner: claude-opus-4-8 (loop)
started: 2026-06-07
status: in-progress
depends_on: [0050, 0054, 0068]
demo_path: no — product (post-hackathon)
phase: production
epic: operate-trust-grow
---

## Goal

A new customer can run Hush in "watch only" — it captures, diagnoses, and shows
what it *would* ship, without touching their repo — then graduate to draft-PRs,
then auto-PRs, as they build confidence.

## Why it matters

No team flips on an autonomous code-fixer cold. Observe-only is the zero-risk way
to prove value first ("look what it caught this week"), which is the actual
adoption path and a strong sales motion.

This is a first-customer blocker, not polish. The production default must be
observe-only until the customer has seen real findings, reviewed them, and
explicitly graduated Hush to draft or auto PRs.

## Acceptance criteria

- [ ] `mode` per workspace: `observe` (no PRs, dashboard-only) → `draft` (draft
      PRs only) → `auto` (confidence-tiered PRs). Default `observe`.
- [ ] In `observe`, the full loop runs (capture→diagnose→fork-test→score) and the
      verified would-be fix is shown, but `ship` is a no-op-with-record.
- [ ] Observe-mode still respects [[0087-signal-triage-dedup-noise-budget]]:
      dashboard-only does not mean "diagnose every rage-click."
- [ ] A weekly "here's what Hush found" digest ([[0063]]) to drive the upgrade.
- [ ] Graduation is one click and reversible; downgrade on demand.
- [ ] Clear in-product indication of current mode everywhere a run is shown.

## Likely files / surfaces touched

- `functions/fix-trigger.ts` (mode gate on dispatch), `apps/dashboard/`
- `infra/insforge.toml` (workspace mode)

## Outcome

Shipped the **pure mode-gate core** in `functions/workspaceMode.ts` (+ 11 tests,
`functions/workspaceMode.test.ts`, tsc clean):

- **gateDispatch(mode, earnedTier)** gates the final dispatch through the workspace
  `mode`, and can only ever make it MORE conservative: `observe` → `record_only`
  with `shipIsNoOp: true` (full loop runs, repo untouched, would-be fix recorded
  for the dashboard); `draft` → caps a PR-worthy fix to a draft PR (issues stay
  issues); `auto` → honors the earned confidence tier. The earned tier is preserved
  on the result so the dashboard can show "would have opened a PR."
- **DEFAULT_MODE = 'observe'** — the production default; a new workspace watches
  only until it graduates.
- **decideGraduation(from, to)** — one-click, reversible: a one-step upgrade is the
  intended path, a skip (observe→auto) is allowed but flagged, downgrades/no-ops
  are always allowed (pull back to safety anytime). `modeRank`/`classifyChange`
  expose the ordering.

This sits AFTER triage [[0087]] and scoring — it never bypasses the noise budget
or the safety rail, only clamps what reaches the repo.

**Seam (deferred):** wiring `gateDispatch` into `fix-trigger.ts`'s ship stage (make
`ship` honor `shipIsNoOp`), the per-workspace `mode` column + one-click graduation
in `infra/insforge.toml`/dashboard [[0054]], the weekly "what Hush found" digest
[[0063]], and the in-product mode indicator. External UI/infra — stay open there.

How to verify: `pnpm -F @hush/functions test workspaceMode.test.ts`.