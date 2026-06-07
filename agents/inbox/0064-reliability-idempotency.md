---
id: 0064
title: Reliability & idempotency — retries, dead-letter, idempotent stages, graceful degradation
role: architect
priority: P1
owner:
started:
status: inbox
depends_on: [0053, 0057]
demo_path: no — product (post-hackathon)
phase: production
epic: hardening
---

## Goal

Every run either completes or fails *cleanly and recoverably*: stages are
idempotent and retryable, transient failures don't lose a bug, and a partial
failure degrades visibly instead of hanging or duplicating work.

## Why it matters

In the hackathon a realtime crash aborted the whole loop, a stuck run sat in
`captured`, and re-invoking risked duplicate side effects. A product runs
thousands of these unattended — it needs durable, idempotent orchestration.

## Acceptance criteria

- [ ] **Idempotent stages:** re-running a run (or a stuck `captured`/`testing`
      row) never double-opens a PR, double-claims a fork, or double-records an
      outcome (the `openPr`/`recordOutcome` idempotency contracts, enforced).
- [ ] **Retry + dead-letter:** transient failures (provider 429/503, deploy/infra
      blips, realtime hiccups) retry with backoff; terminal failures land in a
      dead-letter state a human/job can replay — no silently lost bug.
- [ ] **Stuck-run sweeper:** a scheduled job advances or fails runs that stall in
      a non-terminal state past a deadline (the `captured`-forever case).
- [ ] **Degrade, don't hang:** every external dependency (LLM, fork, GitHub,
      realtime, Memoir) has a defined fallback and a visible degraded state — the
      pipeline never blocks on a single dependency (extends the patterns already
      in place: trace-only replay, non-fatal realtime, neutral Memoir).
- [ ] Chaos test: kill each dependency mid-run and assert a clean terminal state.

## Likely files / surfaces touched

- `functions/fix-trigger.ts` (idempotency keys, stage guards), `ship.ts`, `memory.ts`
- `infra/insforge.toml` (run state machine, sweeper schedule, DLQ table)

## Notes

- The hackathon already proved the *patterns* (trace fallback, non-fatal realtime,
  neutral-on-error Memoir). This ticket makes them uniform and tested across all
  stages.

## Outcome
