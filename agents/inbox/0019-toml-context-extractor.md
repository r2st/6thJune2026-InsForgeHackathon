---
id: 0019
title: TOML context extractor for target table
role: architect
priority: P0
owner:
started:
status: inbox
depends_on: [0018]
demo_path: yes — without it, the LLM hallucinates the diff
---

## Goal

Given a target table name, extract the relevant slice of the current
`insforge.toml` (the table definition, its RLS policies, related auth
config) and hand it to the diagnose() prompt as context. This is the
schema-grounding step.

## Why it matters for the demo

This is the silent foundation that makes the agent credible vs confidently
wrong. If the LLM doesn't know the table has columns `id, tenant_id,
user_id, total, created_at`, it will invent. The PR opens with a diff
referencing a column that doesn't exist. Demo dead.

## Acceptance criteria

- [ ] `extractTomlContext({ table })` in `functions/toml.ts`
- [ ] Reads the canonical `insforge.toml` (path configurable via env, default
      to the InsForge service-key fetch endpoint so we get the *applied*
      version, not stale git)
- [ ] Returns a slice containing:
      - `[tables.<table>]` block (columns, RLS predicate)
      - Any `[auth.policies.*]` entries referenced by that RLS predicate
      - Any FK-referenced tables' minimal column list (id + tenant scoping)
- [ ] Output is a *string* (raw TOML), not parsed AST — the prompt template
      embeds it verbatim
- [ ] Length-capped at 4kb; if exceeded, drop FK-referenced tables first
- [ ] Unit-tested with a fixture `insforge.toml` containing the demo
      schema; assert orders' slice includes the RLS predicate and the
      tenants FK reference

## Likely files / surfaces touched

- `functions/toml.ts` (new)
- `functions/fixtures/insforge.demo.toml` (new — minimal demo schema)
- Test in `functions/toml.test.ts`

## Notes

- Read the *applied* TOML from the InsForge API, not from disk. The repo
  copy can be stale relative to what's actually deployed; we want to
  diagnose against reality.
- This is also the helper ticket 0008 uses to validate that the proposed
  diff references columns that exist.
- Don't try to parse TOML semantically. Regex out the `[tables.X]` block
  by header → next-blank-line is fine for the demo schema.

## Outcome
<!-- Fill in when moving to done/. 2-3 lines max. -->
