---
id: 0035
title: Confidence per-signal floor — single weak signal vetoes its tier
role: architect
priority: P1
owner: claude-opus (impl session)
started: 2026-06-06
status: in-progress
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
<!-- Fill in when moving to done/. -->
