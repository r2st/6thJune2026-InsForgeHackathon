---
id: 0032
title: Deterministic TOML AST + identifier validation
role: architect
priority: P1
owner: claude-opus-4-8
started: 2026-06-06
status: done
depends_on: [0018, 0019, 0021]
demo_path: yes — answers "what stops the LLM from hallucinating?"
---

## Goal

`safety.ts` is a *widening* rail — it counts conjuncts and looks for
scoping columns. It does not validate that the LLM-proposed predicate
is even structurally valid. The LLM can reference a column in the wrong
table, miscast a uuid as int, invent a function (`auth.tenant_id()`),
or patch a TOML path that doesn't exist. None of these widen access;
all of them break the run.

Add a deterministic post-LLM validator that does the structural check
before replay.

## Why it matters for the demo

This is the defense for "Lie #02 deeper" in
docs/the-hardest-part-deeper.md. Without it, `score.ts` cheerfully
emits a 92% confidence for a patch that won't even compile on the
fork, and we discover this at apply-time on stage. Catching it
deterministically pre-apply is the discipline judges notice.

## Acceptance criteria

- [ ] `functions/tomlValidate.ts` exports `validateTomlPatch({ patch,
      tomlContext, tableSchema }) -> ValidationResult`
- [ ] `ValidationResult = { ok: true } | { ok: false, reasons: string[] }`
- [ ] Path validation: `patch.path` must resolve to an existing key
      in `tomlContext` (e.g. `tables.orders.rls` exists; `tables.orders.rls.read`
      does not — would need to be a new key, escalate to issue).
- [ ] Identifier validation in `patch.after`:
      - Every column reference must exist in `tableSchema` for the
        named table.
      - Cast operators (`::int`, `::uuid`, etc.) must be compatible
        with the column's declared type. uuid::int → reject.
      - Function calls restricted to a whitelist:
        `auth.uid()`, `auth.jwt()`, `current_setting()`, `coalesce()`,
        `ANY()`, `IN`. Anything else → reject.
- [ ] Sub-select detection: `IN (SELECT …)` and `EXISTS (…)` allowed
      only when the inner query itself references a scoping column
      from `tableSchema` (otherwise widening through indirection —
      `tenant_id IN (SELECT id FROM tenants)` would pass conjunct
      check but expose all tenants).
- [ ] On reject: `validationResult.ok = false`, `reasons` array
      enumerates each violation by line / token. The orchestrator
      treats this the same as a widening flag — drop to `issue`.
- [ ] Unit tests cover:
      - the demo bug patch (valid, returns ok)
      - column-in-wrong-table (reject)
      - uuid::int cast (reject)
      - fabricated function `auth.tenant_id()` (reject)
      - widening sub-select `IN (SELECT id FROM tenants)` (reject)
      - benign sub-select with scoping (`IN (SELECT id FROM orders WHERE tenant_id = auth.jwt()...)`) (ok)

## Likely files / surfaces touched

- `functions/tomlValidate.ts` (new)
- `functions/safety.ts` (existing — composes with this; safety covers
  widening, tomlValidate covers structure)
- `functions/fix-trigger.ts` (call site — `tomlValidate` runs before
  `applyDiff`, NOT in parallel)
- `functions/types.ts` (add `ValidationResult`, `TableSchema`)
- Test in `functions/tomlValidate.test.ts`

## Notes

- Use a lightweight PEG / hand-written tokenizer. We don't need a full
  SQL parser — we need to enumerate identifiers, function calls, and
  string literals from a predicate. Keep it under 200 LOC.
- This ticket and `safety.ts` are *complementary*. Run both. Either one
  rejecting the patch is sufficient to drop to issue.
- Background: docs/the-hardest-part-deeper.md → "Lie #02 (hallucinated
  schema) — deeper."

## Outcome

- `functions/tomlValidate.ts` — `validateTomlPatch({patch,tomlContext,tableSchema})`:
  path-resolves check, function whitelist, column-exists, cast-compatibility,
  and sub-select scoping. Hand-written tokenizer (no SQL parser). Plus
  `tableSchemaFromToml()` to derive the schema from the same TOML slice.
- Wired into `fix-trigger.ts` BEFORE applyDiff (stage 3a); a reject drops to
  issue, same as the safety rail (3b). The two rails compose.
- 8 tests covering every acceptance case (demo ok / wrong-table / uuid::int /
  fabricated fn / widening sub-select / benign scoped sub-select / bad path).
