# 0002 — Diagnose output contract + Anthropic API call

- **Date:** 2026-06-06
- **Status:** accepted
- **Decider(s):** Hush team
- **Ticket:** 0018

## Context

The diagnose step turns a captured session + failing request + TOML slice
into the plain-English line on the receipt page, the PR body, and the TOML
diff. Every downstream stage (safety rail 0021, confidence 0020, the
receipt card 0022) reads its output. If that output is a free-form string,
every consumer is a fragile parse. It needs one frozen, machine-checkable
shape.

Two decisions, locked together because they ship as one unit.

## Decision

**1. The wire contract is `schemas/diagnosis.schema.json`.** Required
fields: `summary` (≤200 chars, present-tense, *is* the receipt line),
`expectation`, `observation`, `failingPolicy` (`<table>.<policy>`),
`failingJwtClaim`, `tomlDiff` (`path`/`before`/`after`), `widensAccess`
(model's self-report — the deterministic check in `safety.ts` may override),
`confidenceInputs` (`diffLoc`/`tablesTouched`/`policyBlast`), `promptVersion`.
`additionalProperties: false` throughout, so a drifting model output fails
loudly instead of leaking junk fields downstream.

**2. The call goes to Claude directly via the Anthropic SDK, not the
OpenRouter / InsForge AI gateway.** Diagnosis is the one step where model
quality is load-bearing for the demo — a wrong cause sinks the receipt and
the PR. We use `ANTHROPIC_API_KEY` + `claude-opus-4-8` with a **forced tool
call** (`emit_diagnosis`, `tool_choice: {type: "tool"}`) whose input schema
is derived from the wire contract minus `promptVersion`. The model fills
every field; we stamp `promptVersion` from the prompt header so a run can't
misreport which prompt produced it, then validate the whole object against
the schema before returning.

Embeddings (`ingest.ts`) stay on OpenRouter — that's a separate, non-
quality-critical path. Only the diagnosis call moved.

## Alternatives considered

- **Prose output, parse to fields downstream.** Rejected — fragile, not
  demo-safe, and `summary` would need extraction from a paragraph.
- **OpenRouter gateway for diagnosis too.** Rejected — the diagnosis is
  the model-quality bottleneck; a direct Anthropic call removes a hop and a
  routing variable from the one step we can't afford to get wrong.
- **`strict: true` structured tool use instead of post-hoc validation.**
  Rejected for now — the schema uses `maxLength` / `pattern` / `minimum`,
  which strict mode doesn't enforce; we'd validate them client-side anyway.
  A single explicit `validate()` pass against the JSON Schema is clearer and
  reused by the test.
- **Extended/adaptive thinking on the call.** Not used — forcing a tool is
  incompatible with thinking, and the forced-tool contract (no prose) is the
  stronger requirement. Reasoning happens while the model builds the args.

## Consequences

**Easy:** downstream stages consume a typed `Diagnosis` (see `types.ts`);
the snapshot test (`diagnose.test.ts`) locks the contract without hitting
the API; prompt + schema version together (`functions/README.md` house rule).

**Hard / watch:** adds `@anthropic-ai/sdk` as a function dependency (loaded
lazily inside `diagnose()` so the pure-helper tests don't need it);
`ANTHROPIC_API_KEY` must be set in the `fix-trigger` function secrets
(`infra/insforge.toml`) and locally in `.env`.

**Regret if wrong:** if the prompt drifts and the model emits a field the
schema forbids, `validate()` throws and the run fails closed rather than
shipping a malformed diagnosis. That's the intended failure mode — bump the
prompt patch version and add an ADR when the contract changes.
