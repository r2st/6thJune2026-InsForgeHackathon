---
id: 0048
title: Multi-tenant workspaces + customer auth (product foundation)
role: architect
priority: P0
owner:
started:
status: inbox
depends_on: []
demo_path: no — product (post-hackathon)
phase: production
epic: self-serve-product
---

## Goal

A customer can sign up, land in a **workspace**, and everything Hush stores
(sites, runs, sessions, repos, backend connections, PRs) is scoped to that
workspace and invisible to every other — enforced by RLS, not app code.

## Why it matters

Today there is no account model: one seeded tenant, one backend. Every other
production ticket (GitHub, sites, backend, secrets, dashboard) hangs off a
workspace identity. This is the foundation — build it first.

## Acceptance criteria

- [ ] `workspaces`, `workspace_members`, `users` tables with InsForge auth.
- [ ] Every product table (`sites`, `bug_runs`, `sessions`, `repos`,
      `backend_connections`, `secrets`) gains a `workspace_id` FK + an RLS policy
      `workspace_id = ANY(current workspace ids from JWT)` — the same primitive
      Hush itself diagnoses, applied to Hush's own data.
- [ ] Sign-up / sign-in / invite-teammate flows (InsForge auth: email + OAuth).
- [ ] Roles: `owner` / `admin` / `member`; only owner/admin connect GitHub or
      backends.
- [ ] A workspace-scoped API key for the capture SDK (so a site can post
      sessions without a user session) — short-lived, rotatable.
- [ ] RLS isolation test: workspace A can never read workspace B's runs/sessions.

## Likely files / surfaces touched

- `infra/insforge.toml` (new tables + RLS), `infra/seed/`
- `apps/dashboard/` (new — auth pages) or extend an existing app
- `functions/lib/auth.ts` (workspace resolution from JWT)

## Notes

- Reuse the RLS discipline Hush already enforces on `bug_runs`. Hush dogfoods its
  own thesis: a tenant-scoping bug in Hush's own schema is exactly what Hush
  catches in customers'.
- Pairs with [[0052-secrets-vault]] (per-workspace credentials).

## Outcome
