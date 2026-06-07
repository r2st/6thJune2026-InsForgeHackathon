---
id: 0092
title: Feedback / Memoir integrity — poisoning resistance
role: architect
priority: P1
owner:
started:
status: inbox
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
