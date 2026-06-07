# functions/ — Hush edge functions

Runs on InsForge. Source stays TypeScript/ESM; deployment bundles the entrypoints
into Deno-compatible single-file artifacts because the InsForge CLI uploads one
source file per function.

## What's here

| File | Purpose | Ticket |
|---|---|---|
| [`ingest.ts`](ingest.ts) | Webhook entrypoint from the toy app | 0005, 0014 |
| [`fix-trigger.ts`](fix-trigger.ts) | Orchestrates diagnose → test → ship | — |
| [`correlate.ts`](correlate.ts) *(stub)* | session → backend-log slice | 0014 |
| [`capture.ts`](capture.ts) *(stub)* | Pull the failing request | 0005 |
| [`diagnose.ts`](diagnose.ts) | Anthropic API call (forced tool) → structured `Diagnosis` | 0018 |
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
pnpm -F @hush/functions run deploy
```

## Runtime contract (Deno — read before writing a new function)

The deployed runtime is **Deno**, not Node. Unit tests run in Node, so a function
can pass every test and still crash live. The bundler
([`scripts/deploy-insforge-functions.mjs`](../scripts/deploy-insforge-functions.mjs))
closes most of the gap; the rest is enforced by the parity guardrail
([`edgeParity.ts`](edgeParity.ts) + [`scripts/check-edge-parity.mjs`](../scripts/check-edge-parity.mjs)).

Rules a new function must follow:

- **No `Buffer`/`process` beyond the shim.** The bundle banner shims only
  `globalThis.Buffer` and `process.env`. `process.cwd()`, `process.argv`,
  `__dirname`, `__filename` are **undefined in Deno** — use `new URL(import.meta.url)`.
- **No runtime disk reads of computed paths.** They `ENOENT` in Deno (the asset
  isn't in the bundle). To ground a function on a sibling asset, use exactly:
  ```ts
  const ASSET = fileURLToPath(new URL('./prompts/x.md', import.meta.url));
  const text = readFileSync(ASSET, 'utf8'); // inlined at bundle time
  ```
  The inline-asset esbuild plugin rewrites that shape to the file's literal content.
  Any other `readFileSync(somePath, …)` fails the parity check.
- **`node:*` imports must be prefixed** (`node:fs`, not `fs`) so they externalize.
- **Intentional Node-only fallbacks opt out visibly** with
  `// edge-parity-ignore: <reason>` on the read line (or the line above) — used by
  the injectable `loadToml`/pool defaults that the deployed path overrides.

Run the guardrail locally:

```bash
node scripts/check-edge-parity.mjs          # exit 1 on any error
node scripts/check-edge-parity.mjs --warn    # include warnings
```

## House rules

- **No cross-file type duplication.** Shared types live in [`types.ts`](types.ts).
- **Prompt and schema versions move together.** Bumping the prompt → bump the schema → add an ADR under [`docs/decisions/`](../docs/decisions/).
- **One step per file.** If `fix-trigger.ts` grows a nested helper, give the helper its own file.
- **Failure is structured, not thrown.** Public function signatures return a result discriminant (e.g. `{ ok: true, ... } | { ok: false, reason }`) so the orchestrator can route on it.
