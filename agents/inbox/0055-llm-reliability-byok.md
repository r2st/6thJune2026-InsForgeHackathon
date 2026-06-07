---
id: 0055
title: LLM reliability — provider failover, BYO-key, quota/rate-limit handling
role: architect
priority: P1
owner:
started:
status: inbox
depends_on: [0052]
demo_path: no — product (post-hackathon)
phase: production
epic: self-serve-product
---

## Goal

The diagnose step never goes down because one provider is rate-limited or
overloaded: it fails over across providers/models, honors per-workspace BYO keys,
and degrades visibly instead of silently — so a customer's runs keep flowing.

## Why it matters

The hackathon hit exactly this: Gemini free-tier `429 RESOURCE_EXHAUSTED` and
transient `503`s. The provider abstraction (`functions/llm.ts`, Gemini default /
Anthropic switchable) already exists — productionize the reliability around it.

## Acceptance criteria

- [ ] **Failover chain:** ordered providers/models (e.g. Gemini → Anthropic →
      a second Gemini model). On `429`/`503`/timeout, advance to the next; the
      existing `isTransient` + retry/timeout budget feeds this.
- [ ] **BYO-key:** a workspace can supply its own Gemini/Anthropic key (from the
      vault, [[0052-secrets-vault]]); else use the platform pooled key with
      per-workspace quotas.
- [ ] **Rate-limit awareness:** respect `RetryInfo`/`retryDelay`; per-provider
      token-bucket so one noisy workspace can't exhaust the pool for others.
- [ ] **Cost/usage metering** per workspace per provider ([[0058-billing-plans]]).
- [ ] A `diagnose` failure after the full chain degrades to a clear "couldn't
      diagnose — retry later" run state, never a hang.
- [ ] Schema-translation parity across providers (the Gemini ↔ tool-schema
      mapping already in `llm.ts`) covered by tests for each provider in the chain.

## Likely files / surfaces touched

- `functions/llm.ts` (failover wrapper around the existing client), `diagnose.ts`
- `functions/lib/vault.ts` (BYO keys), usage-metering table

## Notes

- Builds directly on the provider-switch work (ticket 0047-era `llm.ts`). Keep
  Gemini the default; make the *chain* the unit, not a single provider.

## Outcome
