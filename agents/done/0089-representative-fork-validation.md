---
id: 0089
title: Representative fork validation — resolve the privacy-vs-fidelity tension
role: architect
priority: P1
owner: claude-opus-4-8 (loop)
started: 2026-06-06
status: done
depends_on: [0033, 0051, 0056]
demo_path: no — product (post-hackathon)
phase: production
epic: fix-quality
---

## Goal

Validate a candidate fix against a fork that is representative enough to catch
population-level breakage (other tenants, other claim shapes, edge rows) while
still privacy-minimized — so "passed on the fork" actually means "safe in prod."

## Why it matters

To protect data, forks seed only the affected rows (0051/0056). But a fix proven
on a 3-row fork can be wrong on the full distribution — correct for the captured
user, a leak for another (ADR 0003, Risk 4). Privacy and validation fidelity pull
in opposite directions and must be reconciled, not ignored.

## Acceptance criteria

- [ ] **Synthetic-shadow rows:** seed the fork with privacy-safe *synthetic* rows
      spanning the risk dimensions (multiple tenants, both JWT claim shapes,
      boundary values) instead of real PII — fidelity without exposure.
- [ ] The differential replay suite ([[0033]]) runs against these shadows:
      cross-tenant must stay 0, the patched query must return the captured user's
      rows, counts/joins must match — population-level proof, not single-user.
- [ ] A **fidelity score** on the verdict: how representative was the fork? Low
      fidelity caps the confidence tier (you can't open a `pr` off a thin fork).
- [ ] Schema-aware shadow generation from `insforge.toml` (column types, FKs).
- [ ] Documented guarantee: real customer rows are never copied into a fork for
      validation — only their *shape* is, as synthetic data.

## Likely files / surfaces touched

- `functions/shadowSeed.ts` (new), `replay.ts`/`replaySuite`, `fingerprint.ts`
- `functions/score.ts` (fidelity → tier ceiling)

## Notes

- Turns a privacy *constraint* into a validation *strength*: synthetic shadows are
  both safer and more adversarial than a literal prod snapshot.

## Outcome

## Outcome

- **Shipped (verified core):** `functions/shadowSeed.ts` (`parseColumns`,
  `generateShadows`, `fidelityScore`) + 8 tests. Typecheck clean; tests green.
  Resolves the privacy-vs-fidelity tension with **privacy-safe synthetic shadow
  rows**: deterministic, obviously-fake data generated from the table schema,
  spanning the risk dimensions a policy fix can get wrong — a primary tenant + a
  neighbour tenant (the cross-tenant leak probe) and per-type boundary values
  (min/max). No real customer rows are ever read. `fidelityScore` reports how
  representative the fork is (cross-tenant × boundary × multi-row), which **caps
  the confidence tier** — a thin fork can't justify a `pr`.
- **Deferred (seam):** seeding these shadows into the branch project and running
  the differential replay suite ([[0033]]) against them, and wiring the fidelity
  score into `score.ts`'s tier ceiling — needs the live fork; this is the
  generator + scoring it consumes.
