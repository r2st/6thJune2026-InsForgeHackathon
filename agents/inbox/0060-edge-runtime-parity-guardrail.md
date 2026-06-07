---
id: 0060
title: Edge-runtime parity guardrail (ban Node-only globals / disk reads in functions)
role: architect
priority: P0
owner:
started:
status: inbox
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
