---
id: 0035
title: Confidence per-signal floor — single weak signal vetoes its tier
role: architect
priority: P1
owner: claude-opus (impl session)
started: 2026-06-06
status: done
depends_on: [0020, 0033, 0034]
demo_path: yes — closes the "could a 92% badge hide a 55% replay?"
question
---

## Goal

The scorer in ticket 0020 emits a weighted composite. A weighted
composite can mask a weak signal: borderline replay (55) + strong
static signals (95, 95) + neutral pgvector (50) → composite 70 →
draft_pr tier. The composite says "draft_pr." The replay says
"barely cleared." The discipline says the replay wins.

Add a per-signal floor. A single signal under 50 caps the run at
`issue`. A single signal under 70 caps at `draft_pr`. The composite
still drives the badge number; the floor drives the dispatch.

## Why it matters for the demo

Defense for Lie #09 in docs/the-hardest-part-deeper.md. Also gives
the Q&A answer to "could the 92% on the demo be misleading?" — no,
because the lowest signal sets the ceiling. The badge isn't an
average; it's an average *clamped by the worst signal*.

## Acceptance criteria

- [ ] `functions/score.ts` is updated. `scoreConfidence` now returns:
      `{ score, tier, signals, ceiling, veto?: { signal: string, value: number } }`
- [ ] `ceiling` is the tier the worst signal allows:
      - all signals ≥85 → ceiling `pr`
      - all signals ≥60 → ceiling `draft_pr`
      - any signal <60 → ceiling `issue`
- [ ] `tier = min(tier_from_composite(score), ceiling)`
- [ ] `veto` is populated when `ceiling < tier_from_composite(score)`
      — identifies which signal capped the tier, for the receipt page
      to render.
- [ ] The "hard floors" already in the ticket spec (replay !verified
      → cap 30; safety widening → cap 59) remain as hard caps; the
      per-signal floor is a *second* layer on top.
- [ ] Unit tests cover:
      - all signals strong → pr, no veto
      - one signal 55, composite high → tier draft_pr, veto names it
      - one signal 45, composite high → tier issue, veto names it
      - hard floor still fires (widening detected, all signals 100 →
        still issue)
- [ ] The composite number itself is unchanged from 0020's formula —
      this ticket only clamps the tier dispatch.

## Likely files / surfaces touched

- `functions/score.ts` (extend)
- `functions/types.ts` (`ConfidenceResult.ceiling`, `.veto`)
- `apps/receipt/components/ConfidenceBadge.tsx` (render the badge as
  composite, and a chip below saying "tier limited by replay verdict:
  55" when veto is set)
- Test in `functions/score.test.ts`

## Notes

- The per-signal floor is the same shape as the safety rail relative to
  the LLM's self-report: deterministic check overrides the model's
  optimism.
- Background: docs/the-hardest-part-deeper.md → Lie #09 + structural
  pattern.

## Outcome

- **Shipped:** per-signal floor + veto in `functions/score.ts`
  (`ceilingFromSignals`, exported), `ConfidenceResult.ceiling`/`.veto` in
  `functions/types.ts`, `apps/receipt/components/ConfidenceBadge.tsx`
  (composite headline + veto chip). 8 new tests; full functions suite green
  (54/54), typecheck clean; receipt app `tsc --noEmit` clean (compile-verified,
  not render-verified — receipt page itself is still scaffold per 0015/0022).
- **`tier = min(compositeTier, ceiling)`**; composite (the badge) unchanged per
  the ticket. `veto` set only when the per-signal floor — not a hard cap — pulled
  the dispatch down, so it attributes correctly.
- **Reconciliation 1 (threshold contradiction):** the AC "ceiling" bullet
  (≥85→pr / ≥60→draft_pr / <60→issue) contradicts the AC's own worked examples
  (signal 55→draft_pr, 45→issue) and the Goal narrative (<50→issue, <70→draft).
  The bullet is a copy-paste of the composite thresholds. I implemented the
  **examples + Goal** (FLOOR_PR_MIN=70, FLOOR_DRAFT_MIN=50) — the concrete cases
  are the contract. If the author meant the bullet literally, flag it.
- **Reconciliation 2 (pgvector vs the demo):** including pgvector in the floor
  would veto the demo (neutral default 50 = worst signal) down to `draft_pr`,
  contradicting 0020's demo→`pr`. pgvector is a *prior over merge history*, not
  evidence of *this* fix's correctness — a verified fix must not be floored for
  the tool having no corpus yet. So the floor guards **evidence signals only**
  (replay, diff, blast); pgvector still feeds the composite at weight 0.2 but
  never sets the ceiling. This is the more correct design, not just a demo save:
  a novel-but-correct fix shouldn't be vetoed for being novel.
- **Side effect:** 0020's `>2 tables` case (composite 70) now dispatches `issue`
  (diffSize=0 < 50 floors it) instead of `draft_pr`. That's 0035 working as
  intended — a 3-table RLS change shouldn't auto-draft. Composite still 70.
  Updated that test.
- **Soft dep on [[0033-differential-replay-suite]] / [[0034-temporal-anchor-fingerprint]]:**
  those raise the *quality* of the numbers feeding `replayVerdictScore` but
  don't change the four-signal shape the floor reads — no rework when they land.
