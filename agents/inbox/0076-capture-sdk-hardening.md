---
id: 0076
title: Capture SDK hardening — perf budget, CSP, framework adapters, versioning
role: builder
priority: P1
owner:
started:
status: inbox
depends_on: [0050]
demo_path: no — product (post-hackathon)
phase: production
epic: operate-trust-grow
---

## Goal

The capture snippet running on customers' production sites is bulletproof: a tiny,
fast, CSP-friendly, auto-updating SDK that never slows down or breaks the host
page, with first-class framework support.

## Why it matters

This is the one piece of Hush that runs in *every customer's* user-facing app. A
heavy or broken snippet damages their site and their trust instantly — it must be
flawless and invisible.

## Acceptance criteria

- [ ] Strict **performance budget**: small bundle, lazy rrweb load, idle-time
      capture, hard cap on overhead; measured + CI-gated.
- [ ] **CSP / SRI** friendly: documented nonce/hash usage, no inline-eval,
      configurable endpoint; never breaks a strict CSP host.
- [ ] **Framework adapters / install guides**: plain `<script>`, React, Vue,
      Next.js, etc. ([[0066]] docs).
- [ ] **Versioning + safe auto-update**: pinned + channel-based; a bad SDK version
      can be rolled back centrally without the customer redeploying.
- [ ] Resilience: capture failures never throw into the host page; offline/queue
      + retry; respects consent/DNT ([[0056]]).
- [ ] Backpressure-aware (works with the queued ingest from [[0065]]).

## Likely files / surfaces touched

- `packages/capture-sdk/` (the embeddable SDK + build), `functions/ingest.ts`

## Outcome
