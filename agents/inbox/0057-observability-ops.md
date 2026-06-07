---
id: 0057
title: Observability & ops — logs, metrics, alerting, run audit trail
role: architect
priority: P2
owner:
started:
status: inbox
depends_on: [0048]
demo_path: no — product (post-hackathon)
phase: production
epic: self-serve-product
---

## Goal

Operators can see the health of the whole loop — capture rates, diagnose
latency/failure, fork spin-up time, PR open rate, provider quota — and get paged
when it breaks, with a per-run audit trail for debugging and trust.

## Why it matters

The hackathon debugged the live pipeline by tailing `function.logs` and adding
ad-hoc `console.error`s. A product needs structured, queryable observability —
and an audit trail (who/what/when) is also a trust + compliance artifact.

## Acceptance criteria

- [ ] **Structured logs** per run with a `run_id` correlation id across every
      stage (replaces the ad-hoc `console.error('[hush] …')`).
- [ ] **Metrics:** capture volume, correlate hit-rate, diagnose latency + failure
      reason breakdown (`DiagnoseError` reasons), fork spin-up p50/p95, replay
      verdict distribution, tier distribution, PR-open + merge rate.
- [ ] **Alerting:** page on diagnose failure-rate spike, fork pool exhaustion,
      provider quota exhaustion, ingest 5xx.
- [ ] **Per-run audit trail** (immutable): every stage transition, every secret
      read ([[0052-secrets-vault]]), every external call (GitHub/InsForge/LLM).
- [ ] A status/health endpoint and an internal ops view.
- [ ] Realtime publish failures (the `Invalid token` issue) surfaced as a metric,
      not a silent swallow.

## Likely files / surfaces touched

- `functions/lib/log.ts` (structured logger), all stage functions
- `infra/insforge.toml` (`run_events` audit table), a metrics sink
- Optional: PostHog / a metrics provider

## Notes

- Fix the realtime auth issue properly here (the demo made publish non-fatal; an
  ops product needs to know *why* it's failing).

## Outcome
