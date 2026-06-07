---
id: 0059
title: CI/CD pipeline + staging environment (automated test, build-verify, deploy gate)
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

Every push runs the test suite, typecheck, a real bundle-build of the edge
functions, and deploys to a **staging** project automatically; production deploys
are gated behind green CI + an approval — no more hand-run flaky `deploy` scripts.

## Why it matters

The hackathon deployed by hand and got bitten repeatedly: transient deploy
failures, a stale-bundle clobber, and a single-slot deploy that overwrote the
receipt app. A product cannot ship on manual deploys — CI is the floor.

## Acceptance criteria

- [ ] CI (GitHub Actions) on every PR: `pnpm -F @hush/functions test` (263+),
      `tsc --noEmit` across all packages, lint, and `deploy-insforge-functions.mjs
      --build-only` (proves the bundle compiles).
- [ ] A **staging** InsForge project + Vercel target; CI auto-deploys staging on
      merge to `main`.
- [ ] Production deploy is a manual/approved promotion from a green staging build
      (no direct prod deploys).
- [ ] Deploy is **idempotent + retried** (the transient InsForge deploy failures
      we saw retried on a clean rebuild) and never serves a half-built bundle.
- [ ] Separate deployment slots for receipt / dashboard / deck so one deploy can't
      clobber another (the single-slot bug we hit).
- [ ] A post-deploy smoke test (see [[0060-edge-runtime-parity-guardrail]]) blocks
      promotion if the live loop is broken.

## Likely files / surfaces touched

- `.github/workflows/` (ci.yml, deploy-staging.yml, promote-prod.yml)
- `scripts/deploy-insforge-functions.mjs` (idempotency/retry), env separation

## Notes

- Wire the existing opsera security scan into CI here (it was disabled for
  hackathon speed) — see [[0061-security-hardening]].

## Outcome
