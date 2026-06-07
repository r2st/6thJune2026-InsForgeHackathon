---
id: 0048
title: Multi-tenant workspaces + customer auth (product foundation)
role: architect
priority: P0
owner: claude-opus-4-8 (loop)
started: 2026-06-07
status: in-progress
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

Shipped the **pure workspace-auth core** in `functions/lib/auth.ts` (+ 17 tests,
`functions/lib/auth.test.ts`, tsc clean), built on the existing `lib/jwt.ts`:

- **resolveWorkspaceIds / activeWorkspace** — resolve the membership set and the
  active workspace from the JWT, and crucially **never trust a client-supplied
  workspace id that isn't in the token** (a requested workspace is honored only if
  the token proves membership — the cross-workspace boundary).
- **roleFor + capability gates** — `owner`/`admin`/`member` with least-privilege
  default; `canConnectIntegrations`/`canManageMembers` are owner/admin-only,
  `canDeleteWorkspace` is owner-only.
- **rlsPredicate(table)** — emits the exact `workspace_id = ANY((auth.jwt() ->
  'workspace_ids')::uuid[])` primitive Hush itself diagnoses; `canReadRow` is the
  app-layer defense-in-depth mirror (A can never read B's row).
- **verifyCaptureKey** — validates a short-lived, workspace-scoped capture key
  (capture-kind + workspace_id + unexpired) so a site can post sessions without a
  user session and a leaked key has a bounded blast radius.

**Seam (deferred):** the `workspaces`/`workspace_members`/`users` tables + the
per-table `workspace_id` FK and RLS policies in `infra/insforge.toml`, the InsForge
auth sign-up/sign-in/invite flows + auth pages in `apps/dashboard/`, capture-key
minting/rotation, and the A-can't-read-B RLS isolation integration test. These need
InsForge schema/migrations + UI — stay open there. Pairs with [[0052]].

How to verify: `pnpm -F @hush/functions test lib/auth.test.ts`.
