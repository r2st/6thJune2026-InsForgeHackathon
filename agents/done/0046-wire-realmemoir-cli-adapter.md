---
id: 0046
title: Wire RealMemoir to the memoir-ai.dev CLI (sponsor confirmed)
role: architect
priority: P1
owner: claude-opus-4-8 (impl session)
started: 2026-06-06
status: done
depends_on: [0043]
demo_path: yes — makes the learn-from-rejections recall real on stage
sponsor: Memoir
---

## Goal

Ticket 0043 built the `MemoirClient` seam and deferred the real adapter until
the SDK was confirmed. It's confirmed: the sponsor is **memoir-ai.dev**
(`zhangfengcdt/memoir`), a local CLI — `pipx install memoir-ai`, no token.
Replace the `nullMemoir` fallback in `createMemoirClient` with a `RealMemoir`
that shells out to the `memoir` CLI against `MEMOIR_STORE`.

## Why it matters for the demo

Right now `recallSimilarity` always returns the neutral 50, so the confidence
badge has no real prior. With RealMemoir live and one seeded merged neighbour,
the badge computes from a real recall — the honest path to the 90/92 in
[[0040-confidence-number-deck-code-mismatch]] and the "Hush gets quieter over
time" story.

## What's already true (don't redo)

- `memoir` + `memoir-mcp` are installed on this machine via pipx.
- A store exists at `~/.hush-memoir-store`; `MEMOIR_STORE` is set in `.env`.
- `.env.example` now documents `MEMOIR_STORE` (not a token) — the
  `MEMOIR_API_KEY` line is gone.
- CLI verbs: `memoir remember "<text>"`, `memoir recall "<query>"`,
  `memoir get`, `memoir status`. Store path via `MEMOIR_STORE` or `-s`.
- Recall works without Anthropic credit (keyword fallback). Semantic
  classification needs a funded `ANTHROPIC_API_KEY` — the demo key is empty.

## Acceptance criteria

- [ ] `RealMemoir` in `functions/memory.ts` implements the existing
      `MemoirClient` interface by shelling out to `memoir`:
      - `recordOutcome(...)` → `memoir remember` (include verdict + decision
        in the text so recall can tell merged from rejected).
      - `recallSimilar(...)` → `memoir recall`, parse hits into
        `{ neighbours: [{ similarity, outcome, diff }] }`.
- [ ] `createMemoirClient` returns `RealMemoir` when `MEMOIR_STORE` is set,
      else `nullMemoir`. Drop the dead `MEMOIR_API_KEY` branch.
- [ ] If the CLI is missing, errors, or returns nothing → fall back to
      `{ neighbours: [] }` so the scorer keeps the neutral 50. A run never
      breaks on Memoir (preserve the 0043 robustness test).
- [ ] Parse a real `memoir recall` payload — confirm the output format first
      (`memoir recall --help`; check for a `--json` flag), don't guess.
- [ ] Map recall confidence/rank to the 0–100 `similarity` the scorer wants;
      keep `similarityForScorer` unchanged.
- [ ] Tests: extend `memory.test.ts` with a fake CLI runner (inject the exec
      seam) covering merged-neighbour, rejected-neighbour, empty, and
      CLI-error cases. Keep the suite green.
- [ ] Demo seed: a script that seeds one historical **merged** neighbour
      resembling the RLS fix, so `recallSimilar` returns it on stage.
      Coordinate with [[0010-demo-fixture-seed]].

## Likely files / surfaces touched

- `functions/memory.ts` (RealMemoir + exec seam), `functions/memory.test.ts`
- `infra/` seed script for the historical neighbour
- `docs/architecture.md` §sponsors (Memoir = local CLI, no token)

## Notes

- Keep the exec seam injectable so tests never spawn the real binary.
- The store lives **outside the repo** (`~/.hush-memoir-store`) on purpose —
  it carries a nested `.git` and would break `git add -A`. Don't relocate it
  into the tree.
- Honesty rail (from 0043): only check the Memoir sponsor box once RealMemoir
  feeds a real neighbour into a run you can demo.

## Outcome

- **Shipped:** `RealMemoir` in `functions/memory.ts` — an injectable exec seam
  (`MemoirRunner`) that shells out to the `memoir` CLI. `recordOutcome` →
  `memoir remember` (JSON blob, runId-keyed path, idempotent). `recallSimilar` →
  `memoir recall`, parses `relevance_score`→0–100 similarity, JSON-blob→outcome,
  with a plain-text keyword fallback for seed memories. Hits below 0.2 relevance
  are dropped so a weak match can't pull below neutral.
- `createMemoirClient` now returns `RealMemoir` when `MEMOIR_STORE` is set
  (the dead `MEMOIR_API_KEY` branch is gone), else `nullMemoir`. The orchestrator
  (`fix-trigger.ts`) needed no change — it already routes through this.
- **Robustness:** missing binary / non-zero exit / non-JSON / Anthropic-credit
  failure all degrade to `{neighbours:[]}` (recall) or a logged no-op (record).
  A run never breaks on Memoir.
- **Tests:** +12 in `memory.test.ts` (fake runner — never spawns the binary);
  full functions suite green (254/254), typecheck clean. Also verified live
  against the real `memoir` binary: recorded a merged outcome and recalled it
  back as a structured neighbour (similarity 100).
- **Demo seed:** `scripts/seed-memoir.sh` seeds one canonical merged neighbour
  resembling the RLS fix (idempotent). With it, the scorer recalls a real prior
  → the 90/92 badge is computed from evidence, resolving 0040 honestly.
- **Deferred:** `recordOutcome` is not yet called from a PR-close webhook (no
  webhook exists). The recall path — what the demo shows — is fully live.
