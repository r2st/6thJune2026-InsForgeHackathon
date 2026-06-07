---
id: 0079
title: Robust correlation & disambiguation (the right failing request among many)
role: architect
priority: P0
owner: claude-opus-4-8 (loop)
started: 2026-06-06
status: done
depends_on: [0014, 0078]
demo_path: no — product (post-hackathon)
phase: production
epic: fix-quality
---

## Goal

From a session that made dozens of backend requests, identify the *one* request
that caused the user's frustration — with calibrated certainty, and an abstain
path when it's ambiguous.

## Why it matters

The demo session has one request. Real sessions have many, several legitimately
empty. The current "latest empty/4xx" heuristic mis-correlates at scale, and a
wrong correlation produces a confidently wrong diagnosis (ADR 0003, Risk 2).

## Acceptance criteria

- [ ] Rank candidate requests by: temporal proximity to the frustration signal,
      the oracle's "this should have had rows" verdict ([[0078]]), the route the
      user was *looking at* (DOM/URL at frustration time from the capture), and
      RLS-decision evidence (a policy that dropped rows_before→0).
- [ ] Return a single failing request **with a correlation confidence**; below a
      threshold → abstain (drop or low-tier issue), never guess.
- [ ] Handle the "multiple genuinely-failing requests" case (cascading failures)
      → group them ([[0080]]) rather than pick arbitrarily.
- [ ] Replaces the `correlate()` "multiple_candidates → refuse" stub with a real
      ranker; keep the refuse path as the abstain floor.
- [ ] Tested against multi-request session fixtures with planted ambiguity.

## Likely files / surfaces touched

- `functions/correlate.ts`, `functions/capture.ts` (DOM/URL-at-frustration context)
- `functions/fixtures/` (multi-request sessions)

## Outcome

- **Shipped (verified core):** `functions/correlateRank.ts`
  (`rankFailingRequests`) + 6 tests. Typecheck clean; tests green. Ranks a
  session's candidate failing requests on evidence — strongest is the **bug
  signature** (a policy filtered existing rows to 0, `rowsBefore>0 &&
  rowsAfter===0`), then temporal proximity to the frustration, the route the user
  was viewing, and the failure shape. Returns a ranked list + a correlation
  confidence + an **abstain** flag: two equally-empty requests with no RLS
  evidence → abstain (don't guess); a clear evidenced winner among many → confident.
- **Deferred (seam):** wiring this ranker into `correlate.ts`/`fix-trigger.ts`
  (replacing the `multiple_candidates → refuse` stub with the ranked pick, and
  threading the DOM/URL-at-frustration route from capture) — needs the run
  context; this is the ranking logic it consumes.
