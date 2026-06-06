---
id: 0020
title: Confidence scorer + tier routing
role: architect
priority: P1
owner: claude-opus (impl session)
started: 2026-06-06
status: done
depends_on: [0018, 0008]
demo_path: yes — drives slide 08 (tiers) and the "92%" badge on slide 07
---

## Goal

Combine four signals into a 0–100 confidence score and map it to one of
three output tiers (PR / draft PR / issue). This is the "Hush doesn't spam
your PR queue" pitch line — it has to actually fire on stage.

## Why it matters for the demo

The "Confidence: 92% → open PR" badge on slide 07 reads as a single number
but is doing real work behind the scenes. Judges who care will ask "where
does 92% come from?" — we need an answer that isn't hand-wave.

## Acceptance criteria

- [ ] `scoreConfidence(diagnosis, replayVerdict)` in `functions/score.ts`
- [ ] Signals (each 0–100, weights below):
      - `replay_verdict_score`: 100 if branch-project replay passed and
        prod still fails, 0 otherwise (weight 0.4)
      - `diff_size_score`: inverse of LoC + tables_touched
        (1 policy / ≤6 lines → 100; >2 tables → 0) (weight 0.2)
      - `policy_blast_score`: inverse of routes/tables gated by the
        changed policy (single route → 100) (weight 0.2)
      - `pgvector_similarity_score`: kNN cosine similarity to past
        confirmed merges; default 50 when no neighbours exist (weight 0.2)
- [ ] Tier routing:
      - `>= 85` → `tier: 'pr'`
      - `60..85` → `tier: 'draft_pr'`
      - `< 60` → `tier: 'issue'`
- [ ] Hard floor: if `widens_access === true` (from ticket 0004's schema)
      and no `intent_widen` flag set in the diagnosis, cap at 59 →
      forced to `issue`
- [ ] Returns `{ score, tier, signals: {...}, prompt_version }` so the
      receipt page and the PR body can both display the breakdown
- [ ] Unit tests cover: high-confidence (demo bug, replay passes, small
      diff) → pr; widening diff → forced to issue; no replay → caps low

## Likely files / surfaces touched

- `functions/score.ts` (new)
- `functions/fix-trigger.ts` (existing — calls scoreConfidence before
  dispatching to Devin)
- Test in `functions/score.test.ts`

## Notes

- The replay verdict is the strongest signal. If the patched branch
  project doesn't make the failing session pass, score caps at 30 no
  matter what the other signals say. Make this explicit in the code.
- pgvector kNN gets 50 (neutral) when we have no history. That's the
  hackathon-day reality. Don't pretend we have a corpus.
- The four signals are surfaced to the PR body and receipt page — they're
  the talking points for the "where does 92% come from" Q&A answer.

## Outcome

- **Shipped:** `functions/score.ts` (`scoreConfidence`, `tierFromScore`) + 15
  tests in `functions/score.test.ts`. Full suite green (46/46), typecheck clean.
- **Two hard caps wired** as designed: replay not reproduced-then-verified →
  cap 30 (→ issue); unintended widening (`safety.widens && !widensAccess`) →
  cap 59 (→ issue). Composite is reported verbatim; caps lower it, never fake it.
- **Demo bug honestly scores 90**, not the 92 on slide 07 (replay 100, diff 100,
  blast 100, pgvector 50-neutral → 0.4·100+0.2·100+0.2·100+0.2·50=90). 90 ≥85 so
  the **tier is still `pr`** — the pitch line holds. To make the badge literally
  read 92, seed **one** prior merged neighbour at similarity 60
  (40+20+20+12=92) — a legitimate demo-seed choice, not a formula fudge. Flagged
  for the deck/demo-seed owner; did not unilaterally edit the deck.
  **Resolved → [[0040-confidence-number-deck-code-mismatch]]:** the seed route is
  unbuilt (no pgvector kNN call site, no `bug_runs` history rows in
  `infra/seed/`), so 0040 takes the honest copy fix — change the deck/docs to
  90% — and records the seed-a-neighbour route as a future enhancement once
  [[0010-demo-fixture-seed]] + a kNN call site land. score.ts weights unchanged.
- **Left for [[0035-confidence-floor-and-veto]]:** the per-signal floor/veto
  layer. `tierFromScore` is exported and the composite is isolated so 0035 can
  clamp the dispatch tier without touching the formula.
- **Call-site** (`fix-trigger.ts`) intentionally untouched — owned by
  [[0030-fix-trigger-orchestrator]]; export shape matches its TODO.
