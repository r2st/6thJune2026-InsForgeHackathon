# 0003 — `widensAccess: true` means "escalate", never "approved widen"

- **Date:** 2026-06-06
- **Status:** accepted
- **Decider(s):** Hush team (ticket 0037)

## Context

`Diagnosis.widensAccess` was read two ways in the codebase:

- The diagnose prompt (rule 1, Example 2) emits `widensAccess: true` when the
  model **declines a safe fix** — "schema change required — escalating" — with
  an empty `tomlDiff.after`. The model is saying *I can't fix this safely.*
- An early `score.ts` test read `widensAccess: true` as a **deliberate,
  approved relaxation** that should be allowed to ship (not capped).

These contradict. Hush's whole pitch is "it opens an issue, it doesn't open a
bad PR." There is no path in v1 where Hush intentionally ships an
access-widening diff.

## Decision

`widensAccess: true` is unambiguously the **model's self-escalation signal**.
It never reaches `pr` or `draft_pr`.

Two enforcement points (defense in depth):

1. **`fix-trigger.ts`** short-circuits to `issue` *before acquiring a fork*
   when the diagnosis is non-actionable: `widensAccess === true`, or
   `tomlDiff.after` is empty/whitespace, or `after === before`. The receipt
   event carries `reason: 'issue-from-escalation'`, distinct from
   `issue-from-safety` / `issue-from-structure` / `issue-from-lint`.
2. **`score.ts`** caps any `widensAccess: true` run at `CAP_UNINTENDED_WIDEN`
   (59 → tier `issue`), independent of the deterministic safety rail (which
   only fires on `safety.widens && !widensAccess`).

## Consequences

- The `score.ts` test "diff widens but the diagnosis declared intent → NOT
  capped" was **inverted**: it now asserts `tier: 'issue'`.
- Distinct from the safety rail (0021): that is the *deterministic* widening
  check overriding an *optimistic* model. This is the *model itself* declining
  — we trust it and route to issue.
- If a future version ever needs an operator-approved intentional widen, it
  must use a new, explicit field — not this one.
