---
id: 0014
title: Backend request-log correlation tap (frontend signal → backend cause)
role: architect
priority: P0
owner: claude
started: 2026-06-06
status: done
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

- [x] Toy-app fetch shim injects `x-hush-session-id` on every same-host InsForge request (scoped to the InsForge origin so the id doesn't leak to third parties)
- [x] `logRequest()` helper writes `{ ts, route, session_id, user_id, tenant_id, rls_decisions, returned_rows, status }` to `request_log` — ready for the orders endpoint (0016) to call
- [x] Correlation runs **sync inside ingest** after the capture insert: `fetchRequestLogWindow()` pulls the ±10s slice, `correlate()` picks the one failing request, result persisted to `bug_runs.request_log_window` + status flips to `correlated`
- [x] Empty-window case → status `captured_no_logs`, run still proceeds, `correlated` Realtime event carries `ok:false` + reason
- [~] Demo-bug end-to-end (dead-click on My Orders → `orders SELECT returned 0`) — **picker is unit-tested against exactly this shape** (`expectedRows` derived from `rowsBefore=3, rowsAfter=0`); full live verification waits on 0016 (orders page) + bring-up

## Files touched

- `apps/demo/lib/hush/insforge-client.ts` (new) — wrapped client + `x-hush-session-id` fetch shim + `sendCapture()` via `functions.invoke('ingest')`
- `apps/demo/lib/hush/ingest-contract.ts` (new) — local mirror of the ingest wire types (avoids cross-package import)
- `apps/demo/lib/hush/CaptureProvider.tsx` (edit) — `onSignal` now flushes + POSTs via `sendCapture` (replaces the 0024 console stub)
- `apps/demo/package.json` (edit) — `@insforge/sdk` dep
- `functions/correlate.ts` (new) — `fetchRequestLogWindow()` + pure `correlate()` picker
- `functions/correlate.test.ts` (new) — 7 cases (empty, no-candidates, empty-result pick, 4xx, multi-route refusal, expectedRows-from-RLS, newest-wins)
- `functions/lib/requestLog.ts` (new) — `logRequest()` + `sessionIdFromHeaders()` for the serving endpoint
- `functions/ingest.ts` (edit) — calls correlate after insert; broadcasts `correlated`
- `infra/insforge.toml` (edit) — added `request_log_window jsonb` + `session_id text` to `bug_runs` (additive; does not touch the buggy RLS line)

## Outcome

- **What shipped:** the full symptom→cause link. Frontend stamps a session id on every backend call; ingest correlates the rrweb signal to the failing request and persists the window. The picker is pure and covered by 7 tests including the exact orders-bug shape.
- **What was cut / deferred:** (1) the actual `logRequest()` call site — the orders endpoint doesn't exist until 0016, so the writer is shipped but uncalled. (2) Live end-to-end verification — gated on 0016 + bring-up. (3) Went **sync inside ingest** rather than a separate `correlate` edge fn; simpler, and the receipt page still gets a two-step story (`captured` then `correlated`) via Realtime.
- **How to verify:** `pnpm --filter @hush/functions test` → 31 pass (7 new in correlate). `pnpm -r typecheck` clean. Live check belongs to bring-up.

## Follow-ups

- 0016 must call `logRequest()` from the orders read path, passing `sessionIdFromHeaders(req)` and the RLS decision counts, or the window will be empty and every run lands `captured_no_logs`.

## Notes

If async (`correlate` edge fn) feels safer to demo, do that — the receipt
page already updates via Realtime, so two-stage progress lines actually
help the visual storytelling. Sync is simpler though.
