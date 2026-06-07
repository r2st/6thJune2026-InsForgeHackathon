---
id: 0053
title: Productionize the fork pool in InsForge (multi-tenant, real fork replay)
role: architect
priority: P1
owner:
started:
status: inbox
depends_on: [0051]
demo_path: no — product (post-hackathon)
phase: production
epic: self-serve-product
---

## Goal

Move the fork-pool state out of the local `.hush/pool.json` file (unreadable by
the deployed edge runtime) into **InsForge**, so any run — for any workspace —
can acquire a pre-warmed branch project of the *customer's* backend, fork-replay
for real (prod-red / fork-green), and reach tier `pr` instead of the trace-only
`draft_pr` fallback.

## Why it matters

This closes the one hackathon deferral that mattered: the live pipeline currently
falls back to trace-only because `firstFree()` can't read a local pool file in
the Deno runtime. At product scale the pool must be shared state, per-backend, and
self-replenishing.

## Acceptance criteria

- [ ] `fork_pool` table in InsForge: `(workspace_id, backend_connection_id,
      branch_id, base_url, jwt_secret_ref, status, claimed_by, ttl)`, RLS-scoped.
- [ ] `firstFree()` / `getEntry()` read/claim from the table (atomic claim via
      `BEGIN IMMEDIATE`-style update), not the file.
- [ ] A scheduled warmer (InsForge cron) keeps N free forks per active backend;
      auto-tops-up on claim; destroys on TTL/merge/close.
- [ ] `forgeJwt` reads the fork signing material from the vault/backend connection,
      not a local secret.
- [ ] End-to-end: a real run reaches `tier: pr` with `prod 0 / fork 3` on a
      customer backend — the demo's money shot, live and multi-tenant.
- [ ] Cost guardrails: per-workspace cap on concurrent forks; metrics for spin-up
      latency.

## Likely files / surfaces touched

- `functions/lib/pool.ts`, `functions/forgeJwt.ts`, `scripts/prewarm.sh` → cron fn
- `infra/insforge.toml` (`fork_pool`, schedule)

## Notes

- Supersedes the `firstFree()` "missing pool → trace fallback" stopgap. Keep
  trace-only as the *degraded* path when no fork is available, not the default.

## Outcome
