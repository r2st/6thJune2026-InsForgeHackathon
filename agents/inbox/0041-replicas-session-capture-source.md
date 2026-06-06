---
id: 0041
title: Replicas as the production session-capture source (rrweb stays fallback)
role: builder
priority: P1
owner:
started:
status: inbox
depends_on: [0013, 0023]
demo_path: yes — Replicas is the "Watch" step; it feeds every downstream beat
sponsor: Replicas
---

## Goal

Make **Replicas** the production session-capture provider that feeds Hush's
`ingest` edge function. Today capture is rrweb embedded in the toy app
([[0023-embed-rrweb-capture-sdk]]). Replicas becomes the real source: it records
the user session, fires Hush on a frustration signal, and hands us the replay +
the timing window we correlate against backend logs. rrweb stays wired as the
**fallback / demo-offline** path so the loop never hard-depends on a network API.

## Why it matters for the demo

"Watch" is step 01 of the loop — the whole product starts here. Capturing real
sessions with a purpose-built provider (vs a hand-rolled rrweb tap) is the
honest, production-grade version of the story, and it's the Replicas sponsor
integration. The session clip Replicas produces is also the artifact embedded in
the PR (slide 07) and the receipt page.

## Acceptance criteria

- [ ] A `CaptureSource` interface in `functions/types.ts` (or `apps/demo/lib/`)
      with two implementations: `ReplicasCapture` (primary) and `RrwebCapture`
      (fallback). The rest of the pipeline depends on the interface, not either
      vendor.
- [ ] `ReplicasCapture` initializes the Replicas SDK in the toy app, starts
      recording on load, and on a frustration signal
      ([[0024-frustration-signal-detector]]) posts the session id + clip URL +
      time window to `ingest`.
- [ ] The `IngestPayload` (`functions/types.ts`) carries a `captureSource:
      'replicas' | 'rrweb'` tag so downstream (and the receipt page) can show
      provenance honestly.
- [ ] `ingest` resolves the clip URL into `storage.buckets.clips` (or stores the
      Replicas-hosted URL directly if signed + TTL'd) for the PR embed.
- [ ] Env: `REPLICAS_API_KEY` (or as their SDK requires) added to `.env.example`
      with a comment, and to the `functions.ingest` secret list in
      `infra/insforge.toml`.
- [ ] Fallback discipline: if `REPLICAS_API_KEY` is unset or the SDK fails to
      init, capture silently falls back to rrweb and tags `captureSource:'rrweb'`.
      The demo must run with zero network dependency on Replicas if it's down.
- [ ] A short note in `docs/architecture.md` §External APIs / sponsors mapping
      Replicas → the "Watch" step.

## Likely files / surfaces touched

- `apps/demo/lib/hush/capture/*` (ReplicasCapture, RrwebCapture, the interface)
- `functions/types.ts` (`IngestPayload.captureSource`, `CaptureSource`)
- `functions/ingest.ts` (accept + tag the source)
- `infra/insforge.toml`, `.env.example`
- `docs/architecture.md`

## Notes

- **Confirm the exact API against Replicas' own hackathon docs/SDK** — web search
  did not surface a definitive public API, so do not guess method names. The
  interface seam above means the rest of Hush is unaffected by whatever shape
  their SDK takes.
- Honesty rail: only check the Replicas sponsor box once `ReplicasCapture` is the
  real default path in a run you can demo — not while it's a stub behind rrweb.
- This replaces the dropped "Replicas as load-bearing dependency" risk flagged in
  `ideas/FINAL-analysis.md §2.4` with a proper interface + fallback.

## Outcome
<!-- Fill in when moving to done/. 2-3 lines max. -->
