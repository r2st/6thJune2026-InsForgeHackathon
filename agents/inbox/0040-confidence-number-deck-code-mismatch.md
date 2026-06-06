---
id: 0040
title: Reconcile the confidence badge — deck/docs say 92%, the scorer computes 90%
role: storyteller
priority: P1
owner:
started:
status: inbox
depends_on: [0020, 0035]
demo_path: yes — the badge is the slide-07 money shot and a guaranteed Q&A line
---

## Goal

Make every human-facing surface agree with what `functions/score.ts` actually
computes for the demo bug. Today the deck, script, and docs say **92%**; the
shipped scorer honestly computes **90%**. The whole project's thesis is system
honesty (`docs/the-hardest-part.md`) — a hardcoded 92 the code can't reproduce
is exactly the kind of small lie the pitch claims to kill.

The math (verified, `cd functions && npm test` green):
`0.4·replay(100) + 0.2·diffSize(100) + 0.2·policyBlast(100) + 0.2·pgvector(50) = 90`.
pgvector is 50 (neutral) because there is no merge-history corpus on demo day —
the honest default ([[0020-confidence-scorer-and-tier-routing]] §notes). 90 ≥ 85
so the **tier is still `pr`** — the pitch line ("→ open PR") holds either way.
This is a number/copy fix, not a logic bug.

## Why it matters for the demo

"Where does 92% come from?" is a planted Q&A question (pitch-script.md line 93).
If a judge opens the running receipt page it renders the real 90; if the deck
says 92 the two disagree on stage. Worse, `docs/architecture.md:483` documents a
*different formula entirely* — `92% = diff(95) × blast(98) × …` (multiplicative,
fabricated factors) — which matches neither the code nor the other surfaces.

## Decision (why option 1)

Two honest routes were considered:

1. **Change the copy to 90%** (chosen). Zero code change, immediate, and matches
   what the live demo renders.
2. **Seed one prior merged neighbour at pgvector similarity 60** so the kNN
   lookup returns a real neighbour → `40+20+20+12 = 92`. Defensible ("we have
   one prior similar merge"), but **not viable now**: there is no pgvector kNN
   call site (`scoreConfidence` is only referenced in a comment in
   `fix-trigger.ts`), no embedding pipeline, and the seed
   (`infra/seed/two-tenants.sql`, [[0010-demo-fixture-seed]]) has no `bug_runs`
   history rows. That's hours across unbuilt plumbing, not a copy fix.

Option 2 is recorded as a future enhancement (see Notes), not this ticket.
**Update:** [[0043-memoir-learn-from-rejections-memory]] now owns the legitimate
path to a real 92 — Memoir recalls one prior merged neighbour at similarity 60,
so the badge computes `40+20+20+12=92` from a real prior, not a neutral default.
If 0043 lands before the demo, do option 2 (badge reads 92 honestly) and skip
the copy edits below. If 0043 is not done, do option 1 now (copy → 90). Either
way deck and code must agree.

## Acceptance criteria

- [ ] `demo/slides/index.html:637` — `92% · open PR` → `90% · open PR`
- [ ] `demo/pitch-script.md:48` — "Confidence 92%" → "Confidence 90%"
- [ ] `demo/pitch-script.md:93` — the "92% in the demo" Q&A line → "90%"
- [ ] `docs/glossary.md:29` — "a 92% badge" → "a 90% badge"
- [ ] `docs/architecture.md:91` — "92% confidence" → "90% confidence"
- [ ] `docs/architecture.md:483` — replace the fictional `92% = diff(95) ×
      blast(98) × …` multiplicative formula with the real weighted-sum the code
      uses: `90 = 0.4·replay(100) + 0.2·diff(100) + 0.2·blast(100) +
      0.2·pgvector(50)`. Cite `functions/score.ts` `WEIGHTS`.
- [ ] No change to `functions/score.ts` weights (don't fudge the formula to hit a
      slide number — that's the anti-pattern this ticket exists to remove).
- [ ] `ideas/FINAL.html` / `ideas/FINAL-analysis.md` are v5 historical artifacts —
      **leave them** (they predate the scorer; editing them rewrites history).

## Likely files / surfaces touched

- `demo/slides/index.html`, `demo/pitch-script.md`
- `docs/glossary.md`, `docs/architecture.md`

## Notes

- Verify after: `cd functions && npm test` (score tests already encode 90; they
  must stay green — they are the source of truth for the number).
- **Future enhancement (separate ticket, after [[0010-demo-fixture-seed]] +
  a pgvector kNN call site land):** seed one historical merged `bug_runs` row
  whose embedding sits at cosine-similarity 60 to the demo diff. Then the badge
  legitimately reads 92 *and* the "where does 92% come from" answer points at a
  real neighbour instead of a neutral default — strictly stronger. Only do this
  once the kNN lookup actually feeds `scoreConfidence`; until then 90 is the
  honest number.

## Outcome
<!-- Fill in when moving to done/. 2-3 lines max. -->
