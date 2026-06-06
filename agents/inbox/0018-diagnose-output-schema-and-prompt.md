---
id: 0018
title: Define diagnose() output schema + InsForge AI prompt v1
role: architect
priority: P0
owner:
started:
status: inbox
depends_on: []
demo_path: yes — drives the diagnosis card on slide 06 and the PR body
---

## Goal

Define the exact JSON shape the diagnose step emits, and write the v1 prompt
that produces it via InsForge AI. Every other Diagnose ticket depends on
this contract.

## Why it matters for the demo

The plain-English line shown on the receipt page ("User expected to see
their orders. The RLS policy reads `auth.jwt() -> 'tenant'`…") comes out
of this schema. The PR description and the TOML diff also come out of
this schema. Without it, every downstream step is a free-form string
parse — fragile and not demo-safe.

## Acceptance criteria

- [ ] JSON Schema file committed at `functions/schemas/diagnosis.schema.json`
      with the following required fields:
      - `summary` (≤200 chars, plain English, present tense)
      - `expectation` (what the user expected)
      - `observation` (what actually happened)
      - `failing_policy` (table + policy name)
      - `failing_jwt_claim` (claim path, e.g. `auth.jwt() -> 'tenant'`)
      - `toml_diff` (object: `path`, `before`, `after`)
      - `widens_access` (bool — the safety-rail input)
      - `confidence_inputs` (object with `diff_loc`, `tables_touched`, `policy_blast`)
- [ ] Prompt template at `functions/prompts/diagnose.v1.md` with versioned
      header (`PROMPT_VERSION: diagnose-v1.0.0`) so we can track regressions
- [ ] Prompt instructs the model to call a tool whose parameters match
      the schema (forced structured output — no prose-to-JSON parsing)
- [ ] Fixture: a sample input bundle at `functions/fixtures/diagnose-input-rls-empty.json`
      that should produce the demo-bug diagnosis verbatim
- [ ] Snapshot test: feed the fixture, assert the output validates against
      the schema and the `failing_policy` field is `orders.orders_select`

## Likely files / surfaces touched

- `functions/schemas/diagnosis.schema.json` (new)
- `functions/prompts/diagnose.v1.md` (new)
- `functions/fixtures/diagnose-input-rls-empty.json` (new)
- `functions/diagnose.ts` (new — thin wrapper that calls AI gateway with schema)
- `docs/decisions/0001-diagnose-output-contract.md` (new ADR, short)

## Notes

- Keep the schema small. Every field that isn't shown on the receipt page
  or used by ticket 0007 (confidence) is overhead. Drop it.
- The `summary` field IS the receipt-page line. Write the prompt so the
  model treats it as user-facing copy, not telemetry.
- `widens_access` should be the model's *intent*, not the safety check.
  Ticket 0008 has the deterministic validator.
- Versioned prompt header lets ticket 0007 record `prompt_version` per
  run so we can compare quality if we iterate.

## Outcome
<!-- Fill in when moving to done/. 2-3 lines max. -->
