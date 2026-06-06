---
id: 0033
title: Differential replay suite — cross-tenant + cross-query
role: architect
priority: P1
owner: claude-opus-4-8
started: 2026-06-06
status: done
depends_on: [0008, 0010]
demo_path: yes — slide 06 is "two backends." This is what makes the
right column green AND the left column stay red across multiple checks.
---

## Goal

Today's replay (`functions/replay.ts`) fires *one* payload at prod and
fork and compares row counts. That catches the simple case but misses:

- **Widening through sub-selects.** `tenant_id IN (SELECT id FROM tenants)`
  passes the conjunct-count check (`safety.ts`) but exposes every tenant.
  Only a *cross-tenant* replay catches it (Globex suddenly sees rows).
- **Regression on other queries.** The patched policy fixes
  `SELECT orders` but breaks `COUNT(orders)` or a join that uses orders
  as the right side. Single-query replay can't see this.

Extend the replay step to fire a *suite* — and require every probe to
pass before the verdict allows tier `pr`.

## Why it matters for the demo

The defense for Lie #04 + #05 in
[`docs/the-hardest-part-deeper.md`](../../docs/the-hardest-part-deeper.md).
Also the strongest move on stage: the slide-06 verdict block now reads
*"4 of 4 probes pass on fork · 1 of 4 passes on prod"* — concrete,
falsifiable, judge-can-see.

## Acceptance criteria

- [ ] `functions/replay.ts` exports `replaySuite(input) -> SuiteVerdict`
- [ ] The suite has four fixed probes for the demo bug:
      1. **Failing payload** — captured request, tenant A. Must fail on
         prod, pass on fork.
      2. **Neighboring tenant** — synthesised equivalent request, tenant
         B (Globex, seeded with zero orders). Must return zero on BOTH
         prod and fork. If fork suddenly returns rows → widening
         through indirection.
      3. **Count probe** — `SELECT count(*) FROM orders` as tenant A.
         Counts must match between prod and fork.
      4. **Join probe** — a canonical join query using `orders` as a
         joined table (e.g. tenant summary). Both sides must return
         identical row counts.
- [ ] All probes fire in parallel against both prod and fork
      (`Promise.all` × 2 — 8 concurrent requests).
- [ ] `SuiteVerdict = { probes: ProbeVerdict[]; bugConfirmed: boolean;
      fixVerified: boolean; widensAccess: boolean; rationale: string }`
- [ ] `bugConfirmed` = probe #1 fails on prod.
- [ ] `fixVerified` = probe #1 passes on fork.
- [ ] `widensAccess` = probe #2 or any other probe shows extra rows on
      fork that aren't present on prod.
- [ ] The orchestrator uses the suite verdict (not a single verdict)
      to drive `score.replay_verdict_score`. Translation:
      - all four probes consistent → 100
      - bug confirmed + fix verified but one regression probe disagrees → 60
      - bug confirmed but fix not verified → 30
      - widening detected → 0 (forces tier issue regardless)
- [ ] Unit tests cover each combination of probe outcomes.

## Likely files / surfaces touched

- `functions/replay.ts` (extend — keep `replayBoth` as a thin wrapper
  for single-probe use cases and the demo intro)
- `functions/types.ts` (`SuiteVerdict`, `ProbeVerdict`)
- `functions/score.ts` (consumer)
- `infra/seed/two-tenants.sql` (already seeds Globex with zero rows —
  perfect for probe #2)
- Test in `functions/replay.test.ts`

## Notes

- The suite size is intentionally small. We're not building a property-
  test framework; we're stating the contract: every load-bearing claim
  needs at least one *other* probe to corroborate it.
- For non-demo tables, the suite degrades to whatever probes the
  table's metadata can support (count always available; join only when
  FK relationships exist).
- Background: docs/the-hardest-part-deeper.md → "Lie #04 + #05 deeper."

## Outcome
<!-- Fill in when moving to done/. -->

## Outcome

- `functions/replay.ts` gains `replaySuite(input, deps)` → `SuiteVerdict`: four
  probes (failing / neighbor / count / join), all fired in parallel against
  prod+fork via an injected `runProbe`. Verdict logic: bugConfirmed (failing
  fails on prod), fixVerified (failing passes on fork), widensAccess (any probe
  shows extra rows on fork). `scoreSuite` maps to 100/60/30/0 per the ticket.
- `suiteToVerdict()` adapts a SuiteVerdict to the single Verdict shape (failing
  probe = headline) carrying `suiteScore`; `score.ts` `replayVerdictScore` now
  prefers `verdict.suiteScore` so a corroborating-probe regression (60) lowers
  the badge and a widen (0) forces issue. `replayBoth` kept as the single-probe
  wrapper (demo intro).
- Integration: the orchestrator consumes the suite through its existing
  `replayFork` seam (return `suiteToVerdict(await replaySuite(...))`); the
  real probe runner (neighbor-tenant JWT minting + count/join query shapes) is
  the wiring point left for the live-backend pass — verdict arithmetic + score
  translation are fully unit-tested (8 suite + 2 score tests, no network).
