---
id: 0068
title: Human-in-the-loop review & feedback loop (approve/reject diagnosis → Memoir)
role: builder
priority: P0
owner:
started:
status: inbox
depends_on: [0054, 0043]
demo_path: no — product (post-hackathon)
phase: production
epic: operate-trust-grow
---

## Goal

Before (or instead of) opening a PR, a customer can review Hush's diagnosis,
approve/edit/reject it, and that judgment feeds the learning loop — so Hush adapts
to each team's preferences and earns autonomy over time.

## Why it matters

Teams don't grant an agent write-access to their repo on day one. A review step
is how trust is earned; the captured approve/reject is also the highest-signal
training data for Memoir (better than the merge/close signal alone).

This is now P0 for a first external customer: Hush should prove value in
observe-only mode, then let humans approve the first draft/fix path before the
workspace graduates to auto-PR.

## Acceptance criteria

- [ ] A review surface in the dashboard ([[0054]]): the diagnosis, the diff, the
      verdict, with Approve / Edit-diff / Reject (+ reason).
- [ ] Per-workspace autonomy setting: `review-all` → `review-medium-only` →
      `auto-PR-high` (graduated trust), defaulting to review-first.
- [ ] Every decision writes to `bug_decisions` and Memoir ([[0043]]) — an approve
      raises, a reject lowers confidence on similar future bugs.
- [ ] Edited diffs are re-validated (safety + fork replay) before shipping.
- [ ] Reject reasons are categorized (not-a-bug / wrong-fix / out-of-scope) to
      sharpen the diagnose prompt and the confidence model.

## Likely files / surfaces touched

- `apps/dashboard/` (review queue), `functions/fix-trigger.ts` (gate on autonomy),
  `functions/memory.ts`, `infra/insforge.toml` (autonomy settings)

## Outcome
