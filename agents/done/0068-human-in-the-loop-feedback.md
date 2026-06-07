---
id: 0068
title: Human-in-the-loop review & feedback loop (approve/reject diagnosis → Memoir)
role: builder
priority: P0
owner: claude-opus-4-8 (loop)
started: 2026-06-07
status: in-progress
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

Shipped the **pure review-gate + feedback core** in `functions/reviewGate.ts`
(+ 14 tests, `functions/reviewGate.test.ts`, tsc clean):

- **requiresReview(autonomy, tier)** — per-workspace graduated trust, monotonic:
  `review-all` gates high + medium; `review-medium-only` auto-ships high (pr),
  reviews medium (draft_pr); `auto-PR-high` gates nothing. An issue is never gated
  (not a code write). `DEFAULT_AUTONOMY = 'review-all'`.
- **decisionToLearning(decision)** — maps approve/edit/reject to a Memoir signal:
  approve `+10` raise; edit `+4` raise but demands re-validation; reject categorized
  so the loss lands right — `not_a_bug` `-15` (the existential detection-precision
  signal), `wrong_fix` `-10` (bug stands, fix penalized), `out_of_scope` `-2`
  near-neutral (a preference, not a quality miss).
- **canShipAfterReview(decision, revalidated)** — pulls the gates together: a run
  ships only if the human approved AND any edited diff has been re-validated
  (safety + fork replay); rejected runs never ship.

**Seam (deferred):** the dashboard review surface [[0054]] (diagnosis/diff/verdict
with Approve/Edit/Reject), the `bug_decisions` table + Memoir write [[0043]], the
autonomy setting in `infra/insforge.toml`, and gating `fix-trigger.ts` on
`requiresReview`/`canShipAfterReview`. The edit re-validation reuses the existing
safety rail + fork replay. External UI/infra — stay open there. Pairs with the
observe/draft/auto mode gate [[0070]].

How to verify: `pnpm -F @hush/functions test reviewGate.test.ts`.