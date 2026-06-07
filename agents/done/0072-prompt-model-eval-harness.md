---
id: 0072
title: Prompt & model evaluation harness (diagnose quality + regression gate)
role: architect
priority: P1
owner: claude-opus-4-8 (loop)
started: 2026-06-07
status: in-progress
depends_on: [0055, 0062]
demo_path: no — product (post-hackathon)
phase: production
epic: operate-trust-grow
---

## Goal

The diagnose prompt and every model in the provider chain are scored against a
labelled bug corpus on each change, so a prompt edit or model swap can't silently
degrade fix quality — and the default model is chosen by evidence, not vibes.

## Why it matters

Diagnose is the AI core. Today it's one prompt against one model with unit tests
that mock the LLM. A product needs a real eval: does Gemini vs Anthropic vs a
cheaper model produce correct, safe diffs across the bug taxonomy?

## Acceptance criteria

- [ ] A labelled eval set: bug fixtures ([[0062]]) → expected policy/diff/verdict.
- [ ] An eval harness scoring each (prompt-version × provider × model) on:
      correct failing-policy ID, valid+safe diff, fork-verdict pass, no
      hallucinated columns/functions.
- [ ] CI gate ([[0059]]): a prompt/model change must not regress the eval score
      below threshold to merge.
- [ ] Cost/latency/quality table to pick the default model per the reliability
      chain ([[0055]]); cheaper models for easy bugs, stronger for hard ones.
- [ ] Track quality over time (prompt versions are already stamped on every run).

## Likely files / surfaces touched

- `functions/evals/` (new), `prompts/`, `.github/workflows/` (eval gate)
- Reuses `diagnose.ts`, `llm.ts`, `safety.ts`, the fork verdict

## Outcome

Shipped the **pure eval-harness core** in `functions/evalHarness.ts` (+ 16 tests,
`functions/evalHarness.test.ts`, tsc clean):

- **scoreCase(case, output)** — correctness = correct failing-policy ID (0.5) +
  passing fork verdict (0.5), but a **hallucinated identifier or unsafe/invalid
  diff is a HARD fail (score 0)** — a wrong or access-widening fix must never earn
  partial credit.
- **scoreRun(identity, cases, outputs)** — aggregates a (promptVersion × provider ×
  model) run to mean score, pass-rate, hard-fail count, and a per-difficulty
  breakdown (a model fine on easy bugs but collapsing on hard ones is visible). A
  missing output scores 0 and counts as a hard fail.
- **regressionGate(baseline, candidate)** — the CI merge gate ([[0059]]): blocks on
  any NEW hard fail, a score below the absolute floor, or a regression beyond
  `maxDrop` vs baseline. No silent degradation merges.
- **pickModels(profiles)** — chooses by evidence from a cost/latency/quality table:
  default = best quality clearing the bar (cheapest tie-break), easy-tier = cheapest
  near-perfect-on-easy model, hard-tier = best-on-hard. Feeds the [[0055]]
  reliability chain — cheap models for easy bugs, strong for hard.

**Seam (deferred):** the labelled fixtures from the generalized taxonomy [[0062]],
the runner that actually calls `diagnose.ts`/`llm.ts`/`safety.ts` + the fork
verdict per (prompt × provider × model) to produce `EvalOutput`s, and the
`.github/workflows/` eval gate wiring `regressionGate`. External, stay open there.

How to verify: `pnpm -F @hush/functions test evalHarness.test.ts`.