---
id: 0016
title: Seed the RLS-misfire demo bug in the toy app's orders flow
role: architect
priority: P0
owner:
started:
status: inbox
depends_on: [0013]
demo_path: yes — this IS the bug the receipt page diagnoses
---

## Goal

Build the demo bug everything else hinges on: an RLS policy on `orders`
that silently filters out one user's rows. The user sees an empty list
and rage- or dead-clicks. Capture fires. Correlate surfaces the RLS
decision. Diagnose produces the TOML diff.

## Why it matters for the demo

If the bug isn't real and reproducible end-to-end, the 60-second arc
collapses. The demo must show a *believable* policy bug, not a contrived
one.

## Acceptance criteria

- [ ] Two seed users in the toy app: one with the "good" JWT shape and one
      with the migrated JWT shape (`tenant` → `tenant_ids[]`)
- [ ] `orders` table has an RLS policy that reads `auth.jwt() ->> 'tenant'`
      — works for the legacy user, returns 0 rows for the migrated user
- [ ] The "My Orders" page renders empty for the migrated user and
      populated for the legacy user
- [ ] The TOML diff that fixes this is committed to a fixture file
      (`tests/fixtures/orders-rls-fix.toml`) — small, reviewable, ≤5 lines
- [ ] Bug reproduces ≥10 times in a row on a fresh branch project (no
      flakes)

## Likely files / surfaces touched

- `insforge.toml`
- toy app: `src/pages/Orders.tsx`
- `tests/fixtures/orders-rls-fix.toml`
- `docs/architecture.md` (link from open-question row)

## Notes

The seed-user contrast is the storytelling device — "this user is fine,
this user sees nothing, and the difference is one JWT claim." Don't lose
that.
