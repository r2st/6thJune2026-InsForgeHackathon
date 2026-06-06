---
id: 0013
title: /capture edge function — store clip, write metadata, publish Realtime
role: architect
priority: P0
owner:
started:
status: inbox
depends_on: [0003]
demo_path: yes — the server side of the loop
---

## Goal

InsForge edge function that receives a capture bundle from the SDK, writes
the rrweb clip to Storage, inserts a row in `sessions`, and publishes a
Realtime event on `bug_stream:{tenant_id}`.

## Why it matters for the demo

This is the moment the receipt page lights up. Without it, the front-end
flush goes nowhere.

## Acceptance criteria

- [ ] `POST /capture` accepts `{ session_id, signal, events, ctx }` JSON
- [ ] Auth: requires a valid InsForge JWT; rejects unauthenticated calls
- [ ] Clip written to Storage at `tenants/{tenant_id}/sessions/{session_id}.json.gz`
      (gzip the events array before upload)
- [ ] Row inserted into `sessions(tenant_id, user_id, signal, url, build_sha,
      clip_url, captured_at, status='captured')`
- [ ] Strips `Authorization`, `Cookie`, `Set-Cookie` headers from any
      embedded request fixtures before storage
- [ ] Publishes `{ session_id, signal, captured_at }` on the
      `bug_stream:{tenant_id}` Realtime channel
- [ ] Returns `{ session_id, clip_url }` (signed URL, ≤5 min TTL)
- [ ] Tested end-to-end via curl against a deployed branch project

## Likely files / surfaces touched

- `insforge.toml` (table + RLS + storage bucket + edge fn declaration)
- `edge-functions/capture.ts`
- `docs/architecture.md` (mark this row as built when done)

## Notes

The `request_log_window` field is left empty here — ticket 0007 fills it
in a separate stage. Keep the write path minimal and fast (<500ms p95).
