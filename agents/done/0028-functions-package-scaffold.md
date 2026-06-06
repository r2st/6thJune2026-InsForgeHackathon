---
id: 0028
title: Edge-functions package scaffold — functions/ stubs, types, schemas, prompts
role: architect
priority: P0
owner: parallel-agent
started: 2026-06-06
status: done
depends_on: []
demo_path: no — unblocks every backend ticket (0005, 0006, 0008, 0011, 0013, 0014, 0018, 0019, 0020, 0021)
---

## Goal

A complete `functions/` package skeleton with one TypeScript stub per
edge function, a single shared `types.ts` (the wire contracts), a
versioned `prompts/diagnose.v1.md`, and a JSON Schema
(`schemas/diagnosis.schema.json`) that pins the diagnose() return shape.

## Why it matters for the demo

Most backend tickets are about filling in `throw new Error('not
implemented')` bodies. They cannot do that without the shared types and
the prompt/schema contracts being decided up-front.

The schema-as-contract pattern is also how 0018 (diagnose) gets a forced
structured tool call — no prose parsing in the demo path.

## Acceptance criteria

- [x] `functions/package.json` + `functions/tsconfig.json`.
- [x] `functions/types.ts` — `CapturedSession`, `RequestLogEntry`,
      `ReplayPayload`, `Diagnosis`, `Verdict`, `Score`, etc.
- [x] One stub `.ts` per planned edge function: `ingest`, `capture`,
      `correlate`, `diagnose`, `replay`, `safety`, `score`, `fix-trigger`.
- [x] Each stub names its ticket and throws `not implemented`.
- [x] `functions/prompts/diagnose.v1.md` — versioned LLM prompt with
      `{{placeholders}}` for the runtime substitution.
- [x] `functions/schemas/diagnosis.schema.json` — JSON Schema for the
      diagnose() return shape.
- [x] `functions/README.md` — what's where, what to read first.

## Outcome

- **What shipped:** 7 stub edge functions + types.ts (137 lines) +
  diagnosis schema + diagnose v1 prompt. 495 LOC total. Every file
  references its inbox ticket so a builder picking up 0005, 0008, 0011,
  0014, 0018, 0019 lands directly in the right stub.
- **What was cut:** `applyDiff.ts`, `forgeJwt.ts`, `tomlPatch.ts`,
  `toml.ts` — deferred to their owning tickets (0006, 0007, 0019)
  because the contract surface is smaller and the ticket owner can
  author them in one pass without conflict.
- **How to verify:** `tsc --noEmit` from `functions/` is clean; every
  stub imports its types and throws.
