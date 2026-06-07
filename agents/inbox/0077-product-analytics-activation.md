---
id: 0077
title: Product analytics & activation (funnel, activation, retention)
role: builder
priority: P2
owner:
started:
status: inbox
depends_on: [0054, 0057]
demo_path: no — product (post-hackathon)
phase: production
epic: operate-trust-grow
---

## Goal

The team can see how customers adopt Hush: the onboarding funnel (connect GitHub →
add site → connect backend → first run → first merged fix), activation, and
retention — so growth is driven by data, not guesses.

## Why it matters

A self-serve product needs to know where customers drop off and what predicts
retention. The activation event is clear and powerful: a *merged* Hush fix.

## Acceptance criteria

- [ ] Instrument the onboarding funnel + key actions (PostHog via InsForge's
      integration, server-side where it touches privacy [[0056]]).
- [ ] Define + track **activation** (first merged fix) and **retention** (weekly
      active workspaces with fixes shipped).
- [ ] Drop-off dashboards per onboarding step; cohort retention.
- [ ] Tie product analytics to outcome ([[0071]]) and billing ([[0058]]) so
      "value delivered" and "revenue" are the same funnel.
- [ ] Privacy-respecting: no end-user PII in analytics; workspace-level only.

## Likely files / surfaces touched

- `apps/dashboard/` + `apps/site/` instrumentation, PostHog config, `functions/`

## Outcome
