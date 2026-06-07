---
id: 0062
title: Generalize the bug surface beyond the demo RLS case
role: architect
priority: P1
owner:
started:
status: inbox
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

## Outcome
