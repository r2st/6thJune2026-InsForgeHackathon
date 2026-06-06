---
id: 0047
title: Demo login that mints a tenant-claimed token (live capture→receipt loop)
role: builder
priority: P2
owner:
started:
status: inbox
depends_on: [0013]
demo_path: partial — the live UI-triggered loop; the receipt demo-mode covers it otherwise
---

## Goal

A rage-click on the **live** storefront (https://hush-acme-store.vercel.app)
posts to the `ingest` edge fn, but ingest's `authenticate()` requires a JWT
carrying a `tenant` (or `tenant_ids`) claim. The storefront has no login flow,
and that claim is never wired into a real InsForge auth token — it's modeled in
the orders fixture (`?user=migrated|legacy`) and proven at the SQL/fork level.
So the capture currently returns **401 "no tenant in token"** and the receipt
page does not light up from a live click.

Close the gap: give the storefront a way to obtain a token that carries the
demo tenant claim, so a live rage-click drives the real capture→correlate→
diagnose→ship loop end to end.

## Why it matters (and why it's P2, not P0)

The demo already works without this: the storefront shows the visible empty-page
beat, and the **receipt demo-mode** (`/r/demo?demo=1`) narrates the full arc with
no backend, by design ("can't flake on stage"). This ticket upgrades the live
storefront from "shows the bug" to "fires the real loop" — strictly nicer, not
required. The backend bug, the fork verdict, and the live PR are all already real.

## Options (pick one)

1. **Baked demo token (simplest).** Mint a JWT signed by the project's
   `JWT_SECRET` with `{ sub, tenant_ids: [ACME] }`, expose it to the storefront
   as a server-only env, and have `sendCapture` send it as the bearer. No login
   UI. Token rotates with a short exp; a tiny `/api/demo-token` route re-mints.
2. **Real InsForge login + custom claim.** A demo user logs in; configure
   InsForge auth to inject `tenant_ids` into the access token (custom claim /
   claims hook, if supported). Most faithful, most work — verify InsForge
   supports custom JWT claims first.
3. **Relax ingest for the demo path.** Accept `x-hush-session-id` + a demo
   tenant header when no tenant claim is present. Changes ingest's security
   model (0013) — least preferred; only behind an explicit `HUSH_DEMO_MODE` flag.

## Acceptance criteria

- [ ] A rage-click on the live storefront returns 200 from `ingest` (not 401).
- [ ] A `bug_runs` row appears (status `captured`) and the receipt channel
      broadcasts `captured` for that session.
- [ ] The token carries the demo tenant claim and is NOT a long-lived secret in
      client JS (server-minted, short exp).
- [ ] If the chosen option can't be done safely in time, leave the live click
      as-is and keep the README demo-day note pointing at `/r/demo?demo=1`.

## Likely files / surfaces touched

- `apps/demo/lib/hush/insforge-client.ts` (`sendCapture` bearer)
- `apps/demo/app/api/demo-token/route.ts` (new, option 1)
- maybe `functions/ingest.ts` (only option 3)

## Notes

- Evidence of the gap: `POST .../functions/ingest` with the anon key →
  `401 {"error":"no tenant in token"}` (verified 2026-06-06).
- Don't put `JWT_SECRET` in a `NEXT_PUBLIC_` var. Option 1's token must be
  minted server-side.

## Outcome
<!-- Fill in when moving to done/. -->
