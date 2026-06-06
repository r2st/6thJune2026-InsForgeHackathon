---
id: 0043
title: Memoir as the learn-from-rejections memory layer (real pgvector neighbour)
role: architect
priority: P1
owner:
started:
status: inbox
depends_on: [0018, 0020, 0011]
demo_path: yes — "Hush gets quieter over time" + makes the confidence neighbour real
sponsor: Memoir
---

## Goal

Wire **Memoir** as Hush's persistent, versioned memory of fix outcomes. Every
closed PR — merged, rejected-as-not-a-bug, dismissed, duplicate
([[0011-pr-with-proof-artifacts]], `bug_decisions`) — is written to Memoir as a
recallable record. At diagnose-time, Hush recalls similar past outcomes to (a)
ground the diagnosis and (b) supply a **real similarity neighbour** to the
confidence scorer ([[0020-confidence-scorer-and-tier-routing]]) — replacing the
neutral pgvector default of 50 with an actual recalled prior.

## Why it matters for the demo

This is the "learn-from-rejections" loop the pitch promises and the planted Q&A
seed ("Hush gets quieter over time, not noisier"). It's the Memoir sponsor
integration, and it's git-shaped memory for a git-native product — Memoir's
branch/rewind model mirrors Hush's branch-project model. It also **resolves
[[0040-confidence-number-deck-code-mismatch]] honestly**: with one real merged
neighbour recalled at similarity 60, the demo badge legitimately computes
`40+20+20+12 = 92` — a real prior, not a neutral default or a hardcoded number.

## Acceptance criteria

- [ ] `functions/memory.ts` wraps Memoir with two functions:
      - `recordOutcome({ run, diagnosis, tomlDiff, verdict, decision }) -> void`
        — called when a PR/issue resolves (merge/reject/dismiss).
      - `recallSimilar({ failingPolicy, tomlDiff, schemaSlice }) -> { neighbours:
        Array<{ similarity: number; outcome: 'merged'|'rejected'|...; diff }> }`
        — called at diagnose/score time.
- [ ] `score.ts` consumes the recalled neighbour: the `pgvectorSimilarity` input
      becomes the top recalled merged-neighbour similarity (0–100); **still 50
      when Memoir returns no neighbours** — the honest default is preserved, never
      faked.
- [ ] A rejected/dismissed neighbour at high similarity *lowers* confidence (Hush
      learns "we tried this, it wasn't a bug") — surfaced as a receipt/PR line.
- [ ] `recordOutcome` is idempotent per `run.id`; outcomes are versioned so a
      reopened decision updates rather than duplicates.
- [ ] Env `MEMOIR_API_KEY` in `.env.example` + relevant `functions.*` secrets in
      `infra/insforge.toml`.
- [ ] Demo seed: one historical **merged** outcome whose fix resembles the demo
      RLS patch, so `recallSimilar` returns a real neighbour on stage (this is the
      legitimate path to the 92% in 0040 — coordinate the two tickets).
- [ ] Fallback: if Memoir is unavailable, `recallSimilar` returns `{neighbours:
      []}` → scorer uses the neutral 50; `recordOutcome` no-ops with a logged
      warning. Pipeline never blocks on Memoir.
- [ ] `docs/architecture.md` §sponsors: Memoir → the learning loop (steps 02 +
      05 of the Hush loop).

## Likely files / surfaces touched

- `functions/memory.ts` (new)
- `functions/diagnose.ts` (recall → prompt grounding), `functions/score.ts`
  (neighbour → `pgvectorSimilarity`), `functions/ship.ts` / the PR-close webhook
  (`recordOutcome`)
- `infra/insforge.toml`, `.env.example`, `docs/architecture.md`
- Coordinate with [[0040-confidence-number-deck-code-mismatch]] and
  [[0010-demo-fixture-seed]]

## Notes

- Two products carry the name: **Memoir — "Git for AI Memory"**
  (https://www.memoir-ai.dev/, taxonomy-structured, versioned, branch/rewind) and
  **memoir.sh** (MCP shared-memory layer). Confirm which is the hackathon sponsor
  and use its real SDK/MCP surface — don't guess the API.
- This is the InsForge-native learning story: `bug_decisions` is the event log;
  Memoir is the recallable, versioned memory built from it. pgvector can remain
  the in-DB index; Memoir is the cross-run memory + provenance the scorer cites.
- Honesty rail: only check the Memoir box once `recallSimilar` actually feeds a
  real neighbour into a run you can demo.

## Outcome
<!-- Fill in when moving to done/. 2-3 lines max. -->
