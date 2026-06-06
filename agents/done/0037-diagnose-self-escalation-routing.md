---
id: 0037
title: Route model self-escalation (widensAccess / empty diff) straight to issue
role: architect
priority: P2
owner: claude-opus-4-8
started: 2026-06-06
status: done
depends_on: [0018, 0030, 0020]
demo_path: partial — the "Hush knows when NOT to ship" objection-handler
---

## Goal

Handle the diagnose output where the model declines to propose a safe fix.
The prompt's Example 2 ("schema change required — escalating") returns
`widensAccess: true` with an empty `tomlDiff.after`. Nothing in the pipeline
acts on that *model-side* escalation today.

## Why it matters for the demo

"What happens when Hush can't safely fix it?" is a guaranteed judge question.
The honest answer — *it opens an issue, it doesn't open a bad PR* — is a moat,
not a weakness. But right now a self-escalated diagnosis would fall through to
the fork, apply an empty/no-op diff, and produce a confusing verdict instead
of a clean "escalated to issue."

## Acceptance criteria

- [ ] `fix-trigger.ts` short-circuits **before** acquiring a fork when the
      diagnosis is non-actionable, i.e. any of:
      - `diagnosis.widensAccess === true` (model self-flagged), or
      - `tomlDiff.after` is empty / whitespace, or
      - `tomlDiff.after === tomlDiff.before` (no-op).
      → dispatch to `issue` with a clear receipt reason; do **not** spend a fork.
- [ ] The receipt event carries a distinct reason (e.g. `issue-from-escalation`)
      separate from `issue-from-safety` / `issue-from-lint` so slide 06 can show
      *why* it escalated.
- [ ] `score.ts`: confirm a model `widensAccess: true` can never reach `pr`/
      `draft_pr` (today only `safety.widens && !widensAccess` is capped — the
      model's own escalation isn't). Add the missing clamp or assert it's
      already covered.
- [ ] Tests: Example-2 fixture (empty `after`, `widensAccess: true`) →
      `tier: 'issue'`, fork never acquired; plus a no-op-diff case.

## Likely files / surfaces touched

- `functions/fix-trigger.ts` (pre-fork non-actionable check)
- `functions/score.ts` (clamp on model self-escalation, if missing)
- `functions/fix-trigger.test.ts` + a `fixtures/diagnose-escalation.json`

## Notes

- Distinct from the safety rail (0021): that's the *deterministic* widening
  check overriding an optimistic model. This is the *model itself* saying "I
  can't fix this safely" — trust it and route to issue.
- Keep the empty-`after` contract explicit: the schema already allows `""`, so
  this is the consumer agreeing on what `""` means.

## Outcome

- `fix-trigger.ts` short-circuits to issue BEFORE acquiring a fork when the
  diagnosis is non-actionable (widensAccess / empty / no-op after). Receipt
  event carries `reason: 'issue-from-escalation'`. All dispatch reasons now
  surface in the shipped event.
- `score.ts` hard cap 3: widensAccess=true never reaches pr/draft_pr.
- Semantic correction recorded in docs/decisions/0003; inverted one score test.
- Fixture `fixtures/diagnose-escalation.json`; 2 orchestrator + 2 score tests.
