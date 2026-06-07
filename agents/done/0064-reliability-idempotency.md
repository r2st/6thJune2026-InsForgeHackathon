---
id: 0064
title: Reliability & idempotency — retries, dead-letter, idempotent stages, graceful degradation
role: architect
priority: P1
owner: claude-opus-4-8 (loop)
started: 2026-06-07
status: in-progress
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

Shipped the **pure reliability core** in `functions/reliability.ts` (+ 20 tests,
`functions/reliability.test.ts`, tsc clean; full suite 456 green):

- **Run state machine** — `nextState`/`canTransition`/`isTerminal`: forward-by-one
  on success, any live run may fail out to `failed`/`dead_letter`, terminal states
  are forever (a shipped/failed run is never re-touched).
- **Idempotent stages** — `StageLedger.guard(runId, stage)` returns `run` once and
  `skip` on every replay (+ `idempotencyKey`/`prIdempotencyKey`), so a stuck
  `captured`/`testing` row re-entering the pipeline never double-opens a PR,
  double-claims a fork, or double-records an outcome.
- **Retry + dead-letter** — `classifyFailure` (transient vs terminal, mirrors
  llmChain), deterministic `backoffMs` (exp, capped, no jitter for reproducibility),
  and `retryDecision`: terminal → fail now; transient → retry with backoff until
  `maxAttempts`, then dead-letter for replay (never a silently lost bug).
- **Stuck-run sweeper** — `sweepStuck(runs, now, …)` re-kicks or dead-letters runs
  stalled in a non-terminal state past a per-state deadline (the `captured`-forever
  case); terminal runs are skipped.
- **Degrade, don't hang** — `degradeFor(dep)` gives llm/fork/github/realtime/memoir
  each a defined fallback + visible degraded state (trace-only replay, queued PR,
  non-fatal realtime, neutral Memoir, llm-exhaustion → dead-letter).

**Seam (deferred):** threading `StageLedger`/`retryDecision`/`degradeFor` through
`fix-trigger.ts`'s stages, the run-state-machine + DLQ table + sweeper schedule in
`infra/insforge.toml`, and the chaos test that kills each dependency mid-run.
These need the fork pool [[0053]] and observability [[0057]] — external, stay open.

How to verify: `pnpm -F @hush/functions test reliability.test.ts`.