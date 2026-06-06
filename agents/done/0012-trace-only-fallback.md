---
id: 0012
title: Trace-only fallback when branch projects are unavailable
role: architect
priority: P1
owner: claude-opus-4-8
started: 2026-06-06
status: done
depends_on: [0005, 0006]
demo_path: yes — defensive; runs if the primary fork path fails
---

## Goal

`hush/traceReplay.ts` evaluates the candidate `insforge.toml` policy
against the captured request *in-process* — no fork, just a Postgres
RLS-evaluation library against a local replica of the seeded data. If
branch-project spin-up errors or exceeds the 5s budget, the Hush
loop falls back to this path and the receipt page shows
"trace-only mode" instead of stalling.

## Why it matters for the demo

The fork is the moat — but if it fails on stage, we need a non-stall
graceful degrade. The trace path proves the *policy* fix even without
the fork, and the receipt page can show "verified via trace · branch
project unavailable" with a `--cool` badge instead of a green one.

## Acceptance criteria

- [x] Parses the patched policy from the candidate TOML
- [x] Evaluates it locally against the demo seed rows + forged claims
- [x] Returns the same `Verdict` shape as the real replay (ticket 0008)
- [x] Triggered by either (a) explicit `--trace-only` flag or (b)
      branch-project acquire failing/timing out
- [x] Receipt page renders the "trace-only" cool-colored badge — does
      not silently masquerade as the real verdict

## Likely files / surfaces touched

- `hush/traceReplay.ts`
- `hush/runtime.ts` (the fallback wiring)
- `app/receipt/` (badge variant)

## Notes

Honesty over polish: this is explicitly a fallback, not the headline. We
*never* open a PR from trace-only; the most we do is open a draft PR
with a note. Update [docs/decisions/0001-test-on-a-fork.md](../../docs/decisions/0001-test-on-a-fork.md)
once the fallback shape is decided.

## Outcome

- `functions/traceReplay.ts` — `traceReplay({payload, patch, seedRows?})`
  evaluates the candidate RLS predicate in-process against the two-tenants seed
  + the captured claims (decoded from the forged-payload JWT). Returns the same
  `Verdict` shape with `mode:'trace'`.
- Evaluates the v1 predicate family (tenant scalar `=` and tenant_ids `= ANY`);
  unrecognised predicates admit zero rows (deny-by-default, no guessing).
- Wired into `fix-trigger.ts`: triggered when `acquireFork()` returns null;
  trace verdicts are capped at draft_pr and surface `mode:'trace'` in the
  shipped event so the receipt page renders the cool badge (0022).
- 5 hermetic tests incl. the cross-tenant non-widening check.
- Note: lives in `functions/` (canonical), not the `hush/` path in the draft.
