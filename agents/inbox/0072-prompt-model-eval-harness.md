---
id: 0072
title: Prompt & model evaluation harness (diagnose quality + regression gate)
role: architect
priority: P1
owner:
started:
status: inbox
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
