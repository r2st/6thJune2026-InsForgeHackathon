---
id: 0062
title: Generalize the bug surface beyond the demo RLS case
role: architect
priority: P1
owner: claude-opus-4-8 (loop)
started: 2026-06-07
status: in-progress
depends_on: [0051]
demo_path: no — product (post-hackathon)
phase: production
epic: hardening
---

## Goal

Diagnose, validate, fork-test, and ship work for the **broad class** of silent
backend bugs — not just the one seeded `orders_select` JWT-claim RLS misfire —
across any table, policy shape, and the realistic `insforge.toml` diff types an
agent can safely propose.

## Why it matters

The demo hardcodes a lot to the one bug: expected-row counts, the table, the
claim shape. A product meets bugs it hasn't seen. The pipeline must derive these
from the run, not constants.

## Acceptance criteria

- [ ] **Expected-rows / correlation** generalized: derive the "what the user
      should have seen" signal from the diagnosis + request shape, not a hardcoded
      `3` (the `replay.ts` TODO).
- [ ] Treat `rows_before` as evidence, not blind truth: validate the expected-row
      oracle against the request shape, policy metadata, and fork/prod probes;
      if the oracle is missing or ambiguous, cap the run to issue/draft.
- [ ] **Bug taxonomy coverage:** RLS filter misfires, stale/missing JWT claims,
      over-restrictive *and* over-permissive policies, policy regressions across
      tables/joins, and auth-config drift — each with a fixture + an end-to-end test.
- [ ] **Diff-type coverage:** the safety rail + TOML AST validation
      ([[0021-diff-safety-rail]], [[0032-toml-ast-validation]]) handle the wider
      set of policy edits (multi-clause, joins, function refs) — deny-by-default
      on anything outside the proven-safe set.
- [ ] **Differential replay suite** ([[0033-differential-replay-suite]]) runs per
      bug class (cross-tenant, count, join probes) so "fix verified" means more
      than one row count.
- [ ] A clear **"can't safely fix this" path** to an issue for bug shapes outside
      scope (the self-escalation route already exists — generalize its triggers).

## Likely files / surfaces touched

- `functions/diagnose.ts`, `replay.ts`, `safety.ts`, `tomlValidate.ts`, `correlate.ts`
- `functions/fixtures/` (a library of bug fixtures), `prompts/`

## Notes

- Pair each new bug class with a fixture *and* an adversarial "looks fixed but
  isn't" case — the two-signal discipline scales by coverage, not optimism.
- For over-permissive/leak classes, coordinate with [[0088-canary-policy-probes-for-silent-leaks]];
  user frustration is not a reliable trigger for leaks.

## Outcome

Shipped the **pure classification + scope core** in `functions/bugTaxonomy.ts`
(+ 15 tests, `functions/bugTaxonomy.test.ts`, tsc clean):

- **classifyBug(signals)** — derives the bug CLASS from generalized, source-agnostic
  signals (row deltas, named-policy/claim presence, cross-tenant evidence, joins,
  auth-config drift) instead of demo constants. Taxonomy: `rls_filter_misfire`,
  `stale_jwt_claim`, `over_restrictive_policy`, `over_permissive_leak`,
  `policy_regression_join`, `auth_config_drift`, `unknown`. Leak is checked first
  so a cross-tenant exposure is never mistaken for a vanished-row fix.
- **scopeFor(class, oracleAbstained)** — deny-by-default dispatch ceiling per class:
  only the restore-own-rows classes (filter misfire, stale claim) auto-fix to PR;
  softer/widening-risk classes cap at draft; leaks and auth drift route to issue +
  human (leaks explicitly to the canary path [[0088]]). If the expectation oracle
  (`oracle.ts`) abstained, even safe classes drop to issue. Generalizes the
  existing self-escalation route. `assessBug` does classify + scope in one call.

**Seam (deferred — the bulk of this epic ticket):** the per-class FIXTURE library +
end-to-end tests in `functions/fixtures/`, generalizing the hardcoded expected-row
`3` in `replay.ts` (oracle.ts already derives expectedRows via the policy
counterfactual — wire it in), widening the safety rail / TOML-AST validator
([[0021]]/[[0032]]) to multi-clause/join/function-ref diffs, and the per-class
differential replay suite [[0033]]. These need the customer-backend connector
[[0051]] and live diagnose/replay wiring — external, stay open under this ticket's
follow-ups. This core gives those the classification + scope contract to build on.

How to verify: `pnpm -F @hush/functions test bugTaxonomy.test.ts`.