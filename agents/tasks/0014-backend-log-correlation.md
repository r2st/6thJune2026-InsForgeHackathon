---
id: 0014
title: Backend request-log correlation tap (frontend signal → backend cause)
role: architect
priority: P0
owner:
started:
status: inbox
depends_on: [0013]
demo_path: yes — the move that makes the pivot work
---

## Goal

Every toy-app request to InsForge carries `x-hush-session-id`. After a
capture lands, fetch the matching slice of edge-function / DB request logs
for that session in a ±10s window and write it onto the `sessions` row
as `request_log_window` (JSONB).

## Why it matters for the demo

Without this link, Hush can't claim to trace frontend symptoms to
backend causes. We'd be another session-replay tool.

## Acceptance criteria

- [ ] Toy-app fetch wrapper injects `x-hush-session-id` header on every
      InsForge request
- [ ] Every edge fn logs `{ ts, route, session_id, user_id, tenant_id,
      rls_decisions, returned_rows }` to a `request_log` table
- [ ] Either inside `/capture` (sync) or in a follow-up `correlate` edge
      fn (async, triggered by Realtime), populate
      `sessions.request_log_window` with rows where
      `session_id = ? AND ts BETWEEN captured_at - interval '10s' AND captured_at`
- [ ] Demo bug case verified: dead-click on "My Orders" produces a
      `request_log_window` row showing `orders SELECT returned 0` while
      the user expected ≥1 row
- [ ] If correlation finds zero log rows, status becomes `'captured_no_logs'`
      and we still ship — the receipt page handles the empty case gracefully

## Likely files / surfaces touched

- toy app: `src/hush/insforge-client.ts` (wrapped fetch)
- `insforge.toml` (`request_log` table)
- `edge-functions/capture.ts` or `edge-functions/correlate.ts`
- `docs/architecture.md`

## Notes

If async (`correlate` edge fn) feels safer to demo, do that — the receipt
page already updates via Realtime, so two-stage progress lines actually
help the visual storytelling. Sync is simpler though.
