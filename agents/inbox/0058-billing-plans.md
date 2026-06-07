---
id: 0058
title: Billing & plans (per-confirmed-fix pricing)
role: architect
priority: P2
owner:
started:
status: inbox
depends_on: [0048, 0054, 0055]
demo_path: no — product (post-hackathon)
phase: production
epic: self-serve-product
---

## Goal

A workspace has a plan and a usage meter, and is billed on the value Hush
delivers — confirmed fixes (merged PRs) — with LLM/fork usage as cost inputs, via
Stripe through InsForge payments.

## Why it matters

The pitch's planted monetization answer is "per-confirmed-fix pricing — you pay
when an open PR gets merged." This ticket makes that real and aligns price with
value (no charge for noise, since low-confidence runs become issues, not PRs).

## Acceptance criteria

- [ ] Plans (Free / Team / Scale): site count, monthly run cap, fork concurrency,
      BYO-key vs pooled LLM, retention length.
- [ ] **Usage metering:** merged-PR count (the billable event), plus run/LLM/fork
      usage for cost + caps (feeds [[0055-llm-reliability-byok]] quotas).
- [ ] Stripe via InsForge payments (`payments` CLI/SDK): checkout, subscription,
      customer portal; webhook reconciles merged-PR events → usage charges.
- [ ] A "merged PR" webhook (GitHub, [[0049-github-app-connect-repos]]) records the
      billable confirmed-fix and writes back to `bug_decisions` (which also feeds
      the Memoir learning loop, [[0043-memoir-learn-from-rejections-memory]]).
- [ ] Hard caps + graceful degradation when a plan limit is hit (queue/notify,
      never silently drop a customer's bug).
- [ ] Billing visible in the dashboard ([[0054-customer-dashboard]]).

## Likely files / surfaces touched

- InsForge `payments` config + `functions/` webhook handlers
- `infra/insforge.toml` (`plans`, `usage` tables), `apps/dashboard/` billing page

## Notes

- The merged-PR signal does double duty: it's the billable event *and* the
  positive training signal for Memoir. One webhook, two payoffs.

## Outcome
