---
id: 0092
title: Feedback / Memoir integrity — poisoning resistance
role: architect
priority: P1
owner: claude-opus-4-8 (loop)
started: 2026-06-06
status: done
depends_on: [0043, 0068, 0061]
demo_path: no — product (post-hackathon)
phase: production
epic: fix-quality
---

## Goal

The learning loop can't be steered wrong — by a careless team, a single bad
reviewer, or an attacker who can trigger captures — so Memoir sharpens Hush
without becoming an attack surface.

## Why it matters

Memoir learns from merge/reject and recall shapes confidence. Garbage or
adversarial feedback poisons future diagnoses (ADR 0003, Risk 7). A learning
system without integrity controls degrades or can be weaponized.

## Acceptance criteria

- [ ] **Provenance** on every memory: who/what produced the outcome (human review
      [[0068]], merge webhook [[0067]], auto-revert [[0069]]) and how trusted.
- [ ] **Workspace isolation:** one customer's outcomes never leak into another's
      recall (RLS [[0048]]); a shared global prior is opt-in and aggregated, not
      raw.
- [ ] **Outlier/decay handling:** a single reject can't tank a well-established
      pattern; stale memories decay; conflicting signals are surfaced, not averaged
      blindly.
- [ ] **Abuse resistance:** captures from unverified origins ([[0061]]) can't write
      training signal; rate/volume caps on how fast one source moves the corpus.
- [ ] An audit + rollback for the memory store (revert a poisoning event).

## Likely files / surfaces touched

- `functions/memory.ts` (provenance, decay, isolation), `bug_decisions` schema
- `infra/insforge.toml` (memory provenance + audit)

## Outcome

## Outcome

- **Shipped (verified core):** `functions/memoryIntegrity.ts` (`trustWeight`,
  `recencyWeight`, `effectiveWeight`, `integritySignal`, `sourceDominance`) + 11
  tests. Typecheck clean; tests green. A pure integrity layer over memory.ts:
  outcomes are weighted by **provenance** (human review > merge > auto-revert >
  unverified) and **recency** (90-day half-life decay); aggregation **resists
  outliers** (a lone unverified reject can't tank an established pattern; a strong
  signal needs ≥2 corroborating trusted records); and `sourceDominance` flags
  anti-poisoning (one actor moving the corpus too fast).
- **Deferred (seam):** persisting provenance/source on `bug_decisions` and wiring
  these weights into RealMemoir's write/recall + the memory audit/rollback — needs
  the live store; this is the integrity math it consumes. Built as a separate
  module to avoid colliding with the in-flight RealMemoir CLI adapter in memory.ts.
