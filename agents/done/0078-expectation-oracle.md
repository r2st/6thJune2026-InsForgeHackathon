---
id: 0078
title: The expectation oracle — is an empty result a bug, or correct?
role: architect
priority: P0
owner: claude-opus-4-8 (loop)
started: 2026-06-06
status: done
depends_on: [0014, 0051]
demo_path: no — product (post-hackathon)
phase: production
epic: fix-quality
---

## Goal

Before Hush ever diagnoses, decide with high precision whether an empty/wrong
result is an actual bug versus a legitimately-empty correct response — the single
hardest and most load-bearing judgment in the product.

## Why it matters

The demo hard-codes "should be 3 rows." Production has no such oracle: a user with
no orders, an empty cart, zero notifications all return `200 OK` + 0 rows,
identical to the bug. Without this, detection precision collapses into a
false-positive firehose (ADR 0003, Risk 1). Precision here is existential.

## Acceptance criteria

- [ ] Multiple oracle signals, combined — never a single guess:
      - **Historical baseline:** did *this user/tenant* previously get rows from
        this route, and did it just drop to 0? (drop, not absence)
      - **Policy counterfactual:** the same query under the *prior* policy version
        (or with the RLS predicate relaxed on the fork) returns rows that the
        current policy filters — i.e. the data exists, the policy hid it.
      - **Population signal:** a spike in 0-row responses on a route that normally
        returns rows, vs. a route that's normally empty.
      - **Frustration corroboration:** the user behaved like data was expected
        (rage-click on an empty list they'd seen populated before).
- [ ] An `expected_rows` / `is_likely_bug` confidence the rest of the pipeline
      consumes (replaces the hard-coded constant in `replay.ts`).
- [ ] **Abstain by default:** below a precision threshold, the run is dropped (not
      even an issue) — no noise. Tunable per workspace.
- [ ] Precision/recall measured against labelled outcomes ([[0072]], [[0091]]).

## Likely files / surfaces touched

- `functions/oracle.ts` (new), `correlate.ts`, `replay.ts` (expectedRows source)
- `infra/insforge.toml` (baseline aggregates from request_log)

## Notes

- Ship conservative first: high precision, low recall. Better to miss bugs than
  to cry wolf. The policy-counterfactual signal is the strongest and is uniquely
  cheap on InsForge (relax the predicate on the fork and compare).

## Outcome

- **Shipped (verified core):** `functions/oracle.ts` (`assessExpectation`) + 9
  tests. Typecheck clean; tests green. Decides whether an empty/wrong result is a
  *bug* vs *correct-empty*, combining signals into an `isLikelyBug` verdict +
  `expectedRows` estimate, **abstain-by-default** (precision before recall).
- **The sharp signal — policy counterfactual:** relax the RLS predicate on the
  fork and re-run; if rows appear that the live policy filtered, the data exists
  and the policy hid it (≈92% confidence, `expectedRows` = the revealed count).
  If relaxing reveals nothing, it's confidently *correct-empty* — not a bug.
  Uniquely cheap on InsForge (fork + predicate relax). Plus historical baseline,
  population spike, and frustration corroboration; none alone clears the bar.
- **Closes ADR 0003 Risk 1** (the existential one) at the logic level, and
  replaces the hard-coded `expectedRows=3` with a derived, evidence-backed value.
- **Deferred (seam):** the data fetches the signals need — the counterfactual
  query on the fork, the per-user/route baseline from `request_log`, the
  population aggregates — wire via the backend connection ([[0051]]); this is the
  judgment they feed.
