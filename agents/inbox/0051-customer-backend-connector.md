---
id: 0051
title: Customer-backend connector — fork & replay the customer's own InsForge
role: architect
priority: P0
owner:
started:
status: inbox
depends_on: [0048, 0052]
demo_path: no — product (post-hackathon)
phase: production
epic: self-serve-product
---

## Goal

A workspace authorizes Hush to access their **own InsForge project**, so the
"test on a fork" step forks the *customer's* backend (schema + auth + RLS),
applies the candidate `insforge.toml` patch, and replays — producing a real
prod-vs-fork verdict on their data shape, not a baked demo backend.

## Why it matters

The moat is fork-and-replay on InsForge branch projects. In the demo that's one
hardcoded project. For a product, each customer connects their backend and Hush
forks *that*. Without this, there's no falsifiable proof per customer.

## Acceptance criteria

- [ ] `Connect backend` flow: customer authorizes Hush against their InsForge
      project (service token or a scoped InsForge OAuth/app credential), stored in
      the secrets vault ([[0052-secrets-vault]]) per workspace.
- [ ] `backend_connections` table: project id, region, host, credential ref,
      health status; a site maps to one backend.
- [ ] Connection health distinguishes **fork/replay access** from **evidence
      access**. A backend can be forkable but still not production-ready until
      [[0086-production-request-log-rls-instrumentation]] is installed.
- [ ] The fork step (`applyDiff` + `replay` + `fingerprint`) targets the
      **customer's** project: `branch create` from their project, seed from a
      bounded snapshot of only the rows the failing request touches (not full prod
      data — privacy), apply patch, replay, destroy on TTL.
- [ ] Least privilege + blast-radius caps: Hush may create/destroy *branch*
      projects and read request logs, but never writes to the customer's prod.
- [ ] Connection health check + clear "degraded → trace-only" fallback when a
      backend can't be forked (mirrors the existing trace fallback).
- [ ] Per-connection JWT signing material handled like the demo forge, but
      sourced from the customer's project, never logged.

## Likely files / surfaces touched

- `functions/applyDiff.ts`, `functions/replay.ts`, `functions/forgeJwt.ts`,
  `functions/lib/pool.ts` (resolve per-workspace backend, not a single env)
- `infra/insforge.toml` (`backend_connections`)
- `apps/dashboard/` (Connect-backend flow)

## Notes

- Privacy is load-bearing: seed forks from the **minimal affected rows**, with a
  documented data-handling boundary ([[0056-privacy-retention-consent]]).
- Productionizes what [[0053-fork-pool-in-insforge]] schedules at scale.
- Do not treat "backend connected" as "Hush can catch production bugs" until the
  request-log/RLS instrumentation contract ([[0086]]) is verified.

## Outcome
