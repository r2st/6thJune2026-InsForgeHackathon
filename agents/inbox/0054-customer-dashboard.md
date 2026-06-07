---
id: 0054
title: Customer dashboard — sites, runs, PRs, settings
role: builder
priority: P1
owner:
started:
status: inbox
depends_on: [0048, 0049, 0050, 0051]
demo_path: no — product (post-hackathon)
phase: production
epic: self-serve-product
---

## Goal

A signed-in customer sees one place to manage everything: connected sites,
GitHub + backend connections, a live feed of bug runs (capture → diagnose →
fork-test → ship), the PRs Hush opened, and workspace settings.

## Why it matters

The demo's receipt page shows one run. A product needs a durable home: onboarding
checklist, run history, the confidence/veto breakdown per run, and self-serve
configuration — or no one can actually use it.

## Acceptance criteria

- [ ] **Onboarding checklist:** connect GitHub → add site → connect backend →
      first run (with progress state).
- [ ] **Runs list + detail:** every `bug_run` with status, tier, confidence, the
      signal breakdown ([[0020-confidence-scorer-and-tier-routing]] /
      [[0035-confidence-floor-and-veto]]), the diagnosis, the prod/fork verdict,
      the session clip, and the PR link.
- [ ] **Sites / connections** management (CRUD, health, verify, disconnect).
- [ ] **Settings:** confidence thresholds, PR vs draft vs issue routing, LLM
      provider/model ([[0055-llm-reliability-byok]]), masking rules, members/roles.
- [ ] Reuses the live receipt component for in-flight runs (Realtime), with a
      durable DB-backed history for past runs.
- [ ] Brand-aligned with `assets/brand/brand-guide.md`.

## Likely files / surfaces touched

- `apps/dashboard/` (new Next.js app), reuse `apps/receipt/components/*`
- `functions/` read APIs (runs, sites, connections) — RLS-scoped

## Notes

- Folds the receipt page into the dashboard as the "live run" view; demo-mode
  stays as a public marketing artifact.

## Outcome
