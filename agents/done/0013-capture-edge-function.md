---
id: 0013
title: /capture edge function — store clip, write metadata, publish Realtime
role: architect
priority: P0
owner: claude
started: 2026-06-06
status: done
depends_on: [0027, 0028]
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

- [x] `POST` to the ingest function accepts `{ sessionId, signal, events, ctx }` JSON
- [x] Auth: rejects calls without a bearer token (401); decodes claims, errors if no tenant
- [x] Clip gzipped and uploaded to `clips/tenants/{tenantId}/sessions/{sessionId}.json.gz`
- [x] Row inserted into `bug_runs(tenant_id, session_clip_url, status='captured')` (schema name; `bug_runs` replaces ticket-era `sessions`)
- [x] PII scrubber strips `Authorization` / `Cookie` / `Set-Cookie` from arrays and objects (case-insensitive)
- [x] Publishes `{ runId, tenantId, signal, capturedAt }` on the `receipt` Realtime channel (per `infra/insforge.toml`)
- [x] Returns `{ runId, clipUrl }`
- [ ] End-to-end curl test against a deployed branch project — deferred until bring-up (ticket 0004 + `scripts/preflight.sh`)

## Files touched

- `functions/ingest.ts` (rewrite) — handler + testable `ingest()` core
- `functions/lib/insforgeClient.ts` (new) — service-key admin client, cached
- `functions/lib/gzip.ts` (new) — Web Streams `CompressionStream('gzip')` helper
- `functions/lib/scrubPii.ts` (new) — recursive walker, drops forbidden header keys + `{name,value}` shaped header objects
- `functions/lib/scrubPii.test.ts` (new) — 3 cases
- `functions/lib/jwt.ts` (new) — base64url-decode + `tenantFromClaims` (accepts both `tenant` and `tenant_ids[]` shapes)
- `functions/lib/jwt.test.ts` (new) — 5 cases
- `functions/types.ts` (edit) — added `IngestPayload`, `IngestResponse`
- `functions/package.json` (edit) — `@insforge/sdk` dep, `vitest` devDep, `test` script
- `functions/vitest.config.ts` (new)

## Notes

The `request_log_window` field is left empty here — ticket 0007 fills it
in a separate stage. Keep the write path minimal and fast (<500ms p95).

## Outcome

- **What shipped:** end-to-end ingest core (validate → scrub → gzip → upload → insert → broadcast → return). All in-process logic is unit-tested (8 cases across `scrubPii` and `jwt`). Live wire to InsForge happens through `getClient()` which lazy-creates an admin client from `INSFORGE_URL` + `INSFORGE_SERVICE_KEY`.
- **What was cut:** the curl smoke test against a deployed branch project — that needs `scripts/preflight.sh` and a live project; gated until 0004 (prewarm + bring-up). Also: the signed-URL TTL override (ticket asked for ≤5 min). The InsForge SDK exposes `getPublicUrl(path)` but no `createSignedUrl(path, ttl)` — for `visibility = "signed"` buckets, the runtime signs based on `ttl_seconds` declared in `infra/insforge.toml` (currently 3600). If 5-minute TTL is hard-required, drop the bucket TTL to 300 or open a follow-up to use the HTTP signing endpoint directly.
- **How to verify:** `pnpm --filter @hush/functions typecheck` and `pnpm --filter @hush/functions test` both green (8 cases). End-to-end check belongs to bring-up.

## Follow-ups

- Wire the toy app's `CaptureProvider` (currently logs to console) to POST here. Will land with 0014 (InsForge client wrapper in the toy app) since the same fetch wrapper sets `x-hush-session-id`.
- After `fix-trigger.ts` ships (ticket 0030), trigger it from a `bug_runs` row insert (Postgres trigger or scheduled poll) so the receipt page sees the next step.
