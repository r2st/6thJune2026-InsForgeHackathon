---
id: 0075
title: Internal admin, support tooling & public status page
role: builder
priority: P2
owner:
started:
status: inbox
depends_on: [0048, 0057]
demo_path: no — product (post-hackathon)
phase: production
epic: operate-trust-grow
---

## Goal

The team can operate the product: an internal admin to manage workspaces, support
impersonation (audited), abuse/quota handling, and a public status page so
customers self-serve incident info.

## Why it matters

Every SaaS needs an inside view and a support path. Without admin tooling, every
support request and abuse case is a manual DB query; without a status page, every
incident is a flood of tickets.

## Acceptance criteria

- [ ] Internal admin (role-gated, audited): list/inspect workspaces, runs, usage;
      handle abuse (suspend, cap, ban); resend/rotate connections.
- [ ] **Audited** support impersonation ("view as workspace") — every access
      logged ([[0057]]), time-boxed, never silent.
- [ ] Public status page wired to the alerts/metrics ([[0057]]) — ingest, diagnose,
      fork pool, provider health; incident history.
- [ ] Abuse/fraud controls on free tier (fork/LLM cost abuse) tie to caps
      ([[0065]]).
- [ ] In-app support entry point + run-share link for support context.

## Likely files / surfaces touched

- `apps/admin/` (new, internal), status-page integration, `functions/` admin APIs

## Outcome
