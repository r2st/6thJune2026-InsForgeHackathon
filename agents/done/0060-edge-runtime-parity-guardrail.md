---
id: 0060
title: Edge-runtime parity guardrail (ban Node-only globals / disk reads in functions)
role: architect
priority: P0
owner: claude-opus-4-8 (loop)
started: 2026-06-07
status: in-progress
depends_on: []
demo_path: no — product (post-hackathon)
phase: production
epic: hardening
---

## Goal

Make it structurally impossible to ship an edge function that works in Node tests
but crashes in the deployed Deno runtime — the exact class of bug that ate hours
in the hackathon (`Buffer is not defined`, `ENOENT` reading `insforge.toml` /
prompts / schemas from disk).

## Why it matters

263 mocked unit tests passed while the live function crashed at every stage,
because tests run in Node and the runtime is Deno. That gap must be closed by
tooling, not vigilance — it will recur otherwise.

## Acceptance criteria

- [ ] A lint/CI check that **fails the build** if `functions/**` uses Node-only
      globals not shimmed by the bundler (`Buffer`, `process` beyond the shim) or
      reads assets from disk at runtime (`readFileSync`/`fs` of a sibling file).
      Today's fixes (the bundler Buffer shim + the asset-inlining esbuild plugin)
      become *enforced invariants*, not one-offs.
- [ ] A **bundle smoke test:** run each built function bundle in a Deno-parity
      sandbox (or `deno check`/run) in CI, with a fixture invoke, so a runtime
      error surfaces pre-deploy.
- [ ] A post-deploy **live smoke test** (gated in [[0059-cicd-staging-pipeline]]):
      invoke `fix-trigger` on a seeded run against staging and assert it reaches
      `shipped`/`issue` (not `failed` with a runtime error).
- [ ] Document the runtime contract (Deno, externalized `node:*`, inlined assets)
      in `functions/README.md` so new functions follow it.

## Likely files / surfaces touched

- `scripts/deploy-insforge-functions.mjs` (keep shim + inline plugin; add a guard)
- `.github/workflows/ci.yml`, `functions/README.md`
- An ESLint rule or a small AST check for the banned patterns

## Notes

- This is the single highest-ROI hardening ticket — it prevents the most painful
  class of regression the team already lived through.

## Outcome

Shipped a **real, runnable guardrail** — not just a seam:

- **`functions/edgeParity.ts`** (+ 15 tests, tsc clean) — a pure, import-free
  `scanSource(file, code)` that encodes the EXACT bundler contract from
  `deploy-insforge-functions.mjs`: the banner shims only `Buffer`/`process.env`, so
  `process.<other>`/`__dirname`/`__filename` are errors; the inline-asset plugin
  only rewrites `readFileSync(ASSET, 'utf8')` where `ASSET =
  fileURLToPath(new URL('./rel', import.meta.url))`, so any computed-path
  `readFileSync` is the ENOENT class and fails. Bare `'fs'` imports error; runtime
  `node:fs` I/O warns. Intentional Node-only fallbacks opt out with
  `// edge-parity-ignore: <reason>` (same/previous line).
- **`scripts/check-edge-parity.mjs`** — loads the analyzer (esbuild type-strip →
  data-url import, single source of truth) and scans `functions/**/*.ts`, exit 1 on
  any error. **Ran it: it caught exactly the 3 latent Node-only reads**
  (`toml.ts`, `applyDiff.ts`, `lib/pool.ts`) and nothing spurious across 53 files.
  Annotated those 3 with accurate `edge-parity-ignore` reasons (deployed path
  inlines the toml / injects loadToml / pool is demo-only) → now **53 files clean,
  exit 0**, with one honest warning on the CLI-subprocess fs write.
- **`functions/README.md`** — documented the Deno runtime contract (shim limits,
  the inline-able asset form, `node:*` prefixing, the ignore directive) so new
  functions follow it. Full suite stays green (527 tests).

**Seam (deferred):** wiring `node scripts/check-edge-parity.mjs` into
`.github/workflows/ci.yml` as a required check, and the Deno-parity **bundle smoke
test** (`deno check`/run each built bundle with a fixture invoke) + the post-deploy
live smoke test, which belong with the CI/staging pipeline [[0059]].

How to verify: `node scripts/check-edge-parity.mjs` (exit 0) and
`pnpm -F @hush/functions test edgeParity.test.ts`.