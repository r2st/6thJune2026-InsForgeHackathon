# functions/ — Hush edge functions

Runs on InsForge. All TypeScript, ESM, no bundler — each file is deployable directly.

## What's here

| File | Purpose | Ticket |
|---|---|---|
| [`ingest.ts`](ingest.ts) | Webhook entrypoint from the toy app | 0005, 0014 |
| [`fix-trigger.ts`](fix-trigger.ts) | Orchestrates diagnose → test → ship | — |
| [`correlate.ts`](correlate.ts) *(stub)* | session → backend-log slice | 0014 |
| [`capture.ts`](capture.ts) *(stub)* | Pull the failing request | 0005 |
| [`diagnose.ts`](diagnose.ts) | InsForge AI call → structured `Diagnosis` | 0018 |
| [`toml.ts`](toml.ts) *(stub)* | Extract current TOML slice for grounding | 0019 |
| [`tomlPatch.ts`](tomlPatch.ts) *(stub)* | Parse/serialize `TomlPatch` | 0006 |
| [`applyDiff.ts`](applyDiff.ts) *(stub)* | Apply patch to a branch project | 0006 |
| [`forgeJwt.ts`](forgeJwt.ts) *(stub)* | Re-sign captured claims for the fork | 0007 |
| [`replay.ts`](replay.ts) | Parallel prod + fork → `Verdict` | 0008 |
| [`safety.ts`](safety.ts) | Deterministic widening check | 0021 |
| [`score.ts`](score.ts) | Confidence + tier routing | 0020 |
| [`types.ts`](types.ts) | **Read this first.** Shared types. | — |
| [`schemas/diagnosis.schema.json`](schemas/diagnosis.schema.json) | The wire contract for `diagnose()` | 0018 |
| [`prompts/diagnose.v1.md`](prompts/diagnose.v1.md) | Versioned prompt for `diagnose()` | 0018 |
| [`fixtures/`](fixtures/) | Snapshot inputs for tests | — |

Files marked *(stub)* exist as `.ts` placeholders only after the relevant ticket is claimed; create on demand.

## Local dev

```bash
pnpm install              # workspace install
pnpm -F @hush/functions typecheck
```

There's no local edge-fn runtime — exercise via fixtures + unit tests, or deploy to a branch project for end-to-end checks.

## Env

Read each function header — the required env vars are listed there. The full secret matrix lives in [`docs/deployment.md` §2](../docs/deployment.md).

## Deploy

```bash
insforge functions deploy ingest
insforge functions deploy fix-trigger
```

## House rules

- **No cross-file type duplication.** Shared types live in [`types.ts`](types.ts).
- **Prompt and schema versions move together.** Bumping the prompt → bump the schema → add an ADR under [`docs/decisions/`](../docs/decisions/).
- **One step per file.** If `fix-trigger.ts` grows a nested helper, give the helper its own file.
- **Failure is structured, not thrown.** Public function signatures return a result discriminant (e.g. `{ ok: true, ... } | { ok: false, reason }`) so the orchestrator can route on it.
