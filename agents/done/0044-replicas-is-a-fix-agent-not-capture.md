---
id: 0044
title: Correct Replicas — it's a background coding agent (Fix step), not session capture
role: builder
priority: P1
owner: claude
started: 2026-06-06
status: done
depends_on: [0041, 0011]
sponsor: Replicas
supersedes: 0041 (capture-source framing)
---

## Why this exists

Ticket 0041 assumed **Replicas = the "Watch"/session-capture step** (a peer to
rrweb). That premise is **wrong**. Confirmed against the live product
(tryreplicas.com + docs.tryreplicas.com):

> **Replicas is a background coding-agent platform.** You give it a repo + a
> natural-language task and it spins a workspace, runs Claude Code / Codex, and
> opens a PR. Triggered from Slack / Linear / GitHub / `POST /v1/replica`.

That is the **Fix/ship step** — the same category as Devin (Cognition), not
capture. So Hush should dispatch the *fix* to Replicas, not the capture.

## Real API (verified from docs)

- `POST https://api.tryreplicas.com/v1/replica`
- Auth: `Authorization: Bearer <REPLICAS_API_KEY>` (dashboard → Settings → API Keys)
- Body: `{ name, message, environment_id?, coding_agent?: "claude"|"codex", webhook_url? }`
- 201 → `{ replica: { id, status, pull_requests: [{ repository, number, url }] } }`
- `GET /v1/replica/{id}` to poll status + PR.

## What to do

- [x] **Undo the capture mis-wiring (0041):** remove `ReplicasCapture`; the
      `CaptureSource` interface + `RrwebCapture` stay (rrweb is the real, honest
      capture). `resolveCaptureSource()` returns rrweb. `captureSource` provenance
      stays `'rrweb'`.
- [x] **Wire Replicas at the Fix step:** `functions/lib/replicasAgent.ts` —
      `dispatchFix({ repo, message, codingAgent }) -> { replicaId, prUrl|null }`
      behind a `ReplicasClient` port over `POST /v1/replica`. Env-guarded.
- [x] Make it an alternative fix-agent alongside Devin in the ship step — Hush
      hands Replicas the diagnosis + the `insforge.toml` diff as the message.
- [x] Env: `REPLICAS_API_KEY` + `REPLICAS_ENVIRONMENT_ID` in `.env.example`;
      `functions.fix-trigger` secret list in `infra/insforge.toml`.
- [x] Fallback: no key ⇒ no-op, ship path unchanged (openPr/Devin still works).
- [x] Unit tests for the dispatch adapter (mocked fetch).

## Honesty rail

Don't claim the Replicas sponsor box until a real key dispatches a replica that
opens a PR in a demoable run. Live smoke test needs `REPLICAS_API_KEY` from the
user (same as the Lim.run live test in 0042).

## Outcome

- **Corrected the category error.** Replicas is a background coding agent, not
  capture. Removed `ReplicasCapture`; `resolveCaptureSource()` is rrweb-only
  (interface kept). Demo capture tests rewritten (11 demo tests green).
- **Wired at the Fix step.** `functions/lib/replicasAgent.ts` → `dispatchFix()`
  over `POST /v1/replica` behind an injectable HTTP port; returns
  `{ dispatched, replicaId, prUrl, status }`. Env-guarded (no key / no env ⇒
  benign no-op; default openPr/Devin ship path unchanged). 6 unit tests.
- **Env + secrets:** `REPLICAS_API_KEY` + `REPLICAS_ENVIRONMENT_ID` in
  `.env.example` and `functions.fix-trigger` secrets; removed the stale
  `REPLICAS_API_KEY` from the `ingest` (capture) secrets.
- **NOT live-tested** — needs `REPLICAS_API_KEY` + `REPLICAS_ENVIRONMENT_ID`
  (dashboard → Settings → API Keys / Environments). Don't check the Replicas
  sponsor box until a real dispatch opens a PR.
- **Verify:** `pnpm --filter @hush/functions test` (245) · demo (11) · typecheck clean.
