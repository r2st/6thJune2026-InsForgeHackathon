---
id: 0021
title: Diff safety rail — block access-widening patches
role: architect
priority: P1
owner: claude-opus-4-7
started: 2026-06-06
status: done
depends_on: [0018, 0019]
demo_path: yes — Q&A defense ("won't this ship a bad patch?")
---

## Goal

Deterministic post-LLM check that detects whether a proposed TOML diff
*widens* access (loosens a predicate, drops a filter, removes a JOIN).
Widening diffs without explicit intent get force-routed to issue, not PR.

## Why it matters for the demo

This is the answer to the strongest Q&A objection: "what if Hush ships
an access-widening RLS change?" The pitch claim is "we never auto-merge
a patch that widens access without a human flag." That claim has to be
backed by code, not vibes.

## Acceptance criteria

- [ ] `validateDiff({ before, after, table_columns })` in `functions/safety.ts`
- [ ] Detects widening via these MVP rules (sufficient for RLS predicates):
      - The `after` predicate has *fewer* top-level conjuncts than `before`
      - The `after` predicate contains a new top-level `OR` whose new branch
        introduces no scoping clause (no `tenant_id`, `user_id`, or
        equivalent scoping column from `table_columns`)
      - The `after` predicate replaces `=` with `IN` / `ANY` against a
        broader claim (e.g. `auth.jwt() -> 'tenant'` → `auth.jwt() ->
        'tenant_ids'` is **allowed** because the claim *should* contain
        the same tenant; we don't flag this. But `tenant_id = X` →
        `tenant_id IS NOT NULL` IS widening)
- [ ] Returns `{ widens: bool, reasons: string[] }`
- [ ] If `widens === true`, the diagnosis output's `widens_access` field
      is **overridden** to true (the deterministic rail trumps the LLM's
      self-report)
- [ ] Unit tests cover:
      - Demo bug fix (`= tenant` → `= tenant OR = ANY(tenant_ids)`) →
        widens: false (added branch references same logical scoping)
      - True widening (`= tenant` → `IS NOT NULL`) → widens: true
      - LLM lied about widening (model said `widens_access: false` but
        the rule says yes) → override succeeds

## Likely files / surfaces touched

- `functions/safety.ts` (new)
- `functions/score.ts` (existing from ticket 0007 — consumes overridden flag)
- Test in `functions/safety.test.ts`

## Notes

- This is a *deny-by-default* validator. False positives (we flag a safe
  diff as widening, route to issue) are far better than false negatives
  (we ship a widening diff as PR). Tune accordingly.
- The MVP rules cover RLS predicate edits, which is the only diff shape
  Hush emits in v1. Schema/column diffs are out of scope; the rail can
  reject them outright.
- For the demo case specifically: the patch adds an `OR tenant_id =
  ANY(auth.jwt() -> 'tenant_ids')`. The new branch *does* reference a
  scoping column (`tenant_id`) so widens=false. Verify this in the test
  before shipping the demo.

## Outcome

- **Shipped:** `functions/safety.ts` (`validateDiff`) — three-rule deny-by-default check against `TomlPatch.before` / `.after`: top-level AND conjunct count, new unscoped OR branch, and per-column binding-strength loosening. Helpers (`splitTopLevel`, `bindingOf`) respect parenthesis depth and single-quoted strings.
- **Tests:** `functions/safety.test.ts` — 16 cases covering all acceptance criteria (demo bug fix not flagged, `= → IS NOT NULL` flagged, conjunct drop flagged, unscoped OR branch flagged, equality → membership allowed per spec, plus edge cases for case-insensitivity, quoted-string OR, word-boundary column matching). `pnpm -F @hush/functions test` → 16/16 pass.
- **Verify:** `cd functions && npx vitest run safety.test.ts`. Orchestrator (ticket 0030) consumes `SafetyResult` to override `Diagnosis.widensAccess`.
- **Scope handed off:** sub-select widening (`tenant_id IN (SELECT id FROM tenants)`) is intentionally out of scope here — it's the ticket-0032 (TOML AST validation) responsibility. The two rails compose: either rejecting → drop to issue.
