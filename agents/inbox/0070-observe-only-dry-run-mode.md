---
id: 0070
title: Observe-only / dry-run mode + graduated trust onboarding
role: builder
priority: P0
owner:
started:
status: inbox
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
