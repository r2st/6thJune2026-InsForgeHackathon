---
id: 0065
title: Scale & performance — load test, fork concurrency, ingest throughput, cost guardrails
role: architect
priority: P2
owner:
started:
status: inbox
depends_on: [0053, 0055]
demo_path: no — product (post-hackathon)
phase: production
epic: hardening
---

## Goal

Hush holds its latency and cost envelope under real load: many sites capturing
concurrently, many runs forking in parallel, without runaway LLM/fork spend or a
backed-up ingest queue.

## Why it matters

The demo runs one bug at a time. A product faces bursty capture traffic and
parallel runs, each spending on an LLM call and a branch project. Without limits
and load testing, cost and latency blow up silently.

## Acceptance criteria

- [ ] **Load test:** sustained + burst ingest, concurrent runs, p50/p95 latency
      for each stage and end-to-end; published budgets (target end-to-end under
      the demo's ~45s sticker even under load).
- [ ] **Fork concurrency** is pooled + capped per workspace and globally
      ([[0053-fork-pool-in-insforge]]); spin-up latency stays bounded; forks are
      reaped promptly.
- [ ] **Ingest throughput:** capture is async/queued so a traffic spike never
      drops sessions or blocks the response; backpressure is visible.
- [ ] **Cost guardrails:** per-workspace budgets for LLM tokens + fork-minutes,
      with caps that degrade gracefully (queue/notify) — never a surprise bill.
- [ ] **Caching/dedup:** pgvector dedup + Memoir recall short-circuit
      already-seen bug shapes so duplicate sessions don't each spend a full run.

## Likely files / surfaces touched

- `functions/ingest.ts` (queue/backpressure), `lib/pool.ts` (concurrency caps)
- Load-test harness (k6/artillery) in `scripts/`, cost-metering tables

## Notes

- The dedup ([[0023]]-era pgvector) and Memoir recall are also *cost* controls —
  a re-seen bug shouldn't pay for a fresh diagnose+fork.

## Outcome
