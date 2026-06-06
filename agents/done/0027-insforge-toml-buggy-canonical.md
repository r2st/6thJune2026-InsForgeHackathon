---
id: 0027
title: Author insforge.toml in the buggy state — orders + RLS + request_log + Realtime
role: architect
priority: P0
owner: parallel-agent
started: 2026-06-06
status: done
depends_on: []
demo_path: yes — the file Hush patches on a fork is this file
---

## Goal

Author the canonical `infra/insforge.toml` — schema, RLS policies, Storage
bucket, Realtime channel, edge-fn manifest — committed in the
**deliberately broken** state so the demo can show the fix landing.

## Why it matters for the demo

This file IS the diff Devin proposes against. Without it, every backend
ticket downstream (0004, 0005, 0006, 0010, 0013, 0014, 0016, 0018, 0019)
has no ground truth to read or patch.

Tickets 0006 (apply diff) and 0019 (TOML context extractor) both treat
this as the source of truth. Ticket 0016 (RLS-misfire seed) plants its
demo bug in here.

## Acceptance criteria

- [x] `infra/insforge.toml` exists and is `insforge config lint`-clean
      (structurally valid).
- [x] Tables: `tenants`, `orders` (with the buggy column path), `sessions`,
      `request_log`.
- [x] RLS policies declared — the `orders_select` policy carries the
      JWT-claim-path bug we're going to fix on stage.
- [x] Storage bucket for session clips declared.
- [x] Realtime channel declared (single canonical channel per session).
- [x] Edge functions declared in the manifest (ingest, fix-trigger,
      diagnose, etc.).
- [x] Top-of-file comment explains "BUGGY ON PURPOSE" so a casual reader
      doesn't try to fix it.
- [x] `infra/seed/` fixture present for reproducible state.

## Outcome

- **What shipped:** `infra/insforge.toml` (4.7 KB) + `infra/seed/` +
  `infra/README.md`. The intentional RLS misfire is parked in `orders` —
  the policy reads `tenant_id` from a stale JWT claim path that won't
  match users whose JWT migrated to the array shape.
- **What was cut:** nothing.
- **How to verify:** `insforge config lint --file infra/insforge.toml`
  returns clean; `insforge config apply --file infra/insforge.toml` to a
  fresh project produces the schema + the bug.
