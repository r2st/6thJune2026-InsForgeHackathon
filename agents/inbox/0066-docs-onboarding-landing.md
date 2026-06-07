---
id: 0066
title: Docs, onboarding & landing — customer docs, capture SDK reference, public site
role: builder
priority: P2
owner:
started:
status: inbox
depends_on: [0049, 0050, 0054]
demo_path: no — product (post-hackathon)
phase: production
epic: hardening
---

## Goal

A new customer can self-serve from "what is this" to "first auto-fix PR" without
talking to anyone: a public landing page, clear setup docs, a documented capture
SDK, and an in-product onboarding that confirms each connection works.

## Why it matters

A self-serve product lives or dies on the first ten minutes. The connectors
(GitHub, site, backend) are useless if a customer can't figure out how to wire
them. Docs are the product's front door.

## Acceptance criteria

- [ ] **Landing page:** what Hush does, the five-step loop, why-InsForge, a clear
      "Connect GitHub / Add your site" CTA (reuse the deck's visual language).
- [ ] **Setup docs:** connect GitHub, add a site + install capture, connect a
      backend, read your first run — each with screenshots and a verify step.
- [ ] **Capture SDK reference** ([[0050-site-connector-capture-install]]): install
      snippet, config (sampling, masking, consent), framework guides, the events
      it sends.
- [ ] **API / webhook reference** for the outbound webhook
      ([[0063-notifications-integrations]]) and any public endpoints.
- [ ] **In-product onboarding checklist** ([[0054-customer-dashboard]]) mirrors the
      docs and confirms each step is live (green/red state).
- [ ] A short **trust page**: the data-handling summary from
      [[0056-privacy-retention-consent]] ("we only fork the affected rows").

## Likely files / surfaces touched

- `apps/site/` (new — landing) or extend the dashboard, `docs/` (customer-facing)
- `packages/capture-sdk/` README + examples

## Notes

- The deck (`/pitch.html`) and SUBMISSION.md are a strong starting point for the
  landing copy — repurpose, don't rewrite.

## Outcome
