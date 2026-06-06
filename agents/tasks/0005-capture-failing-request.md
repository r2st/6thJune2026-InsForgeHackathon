---
id: 0005
title: Capture the failing HTTP request from edge-fn logs as a replay payload
role: builder
priority: P0
owner:
started:
status: inbox
depends_on: []
demo_path: yes — this is the input to slide 6's replay
---

## Goal

Given a session id (from rrweb capture) and a window (±5s around the
rage-click), pull the matching edge-fn request log entry and serialize it
into a `ReplayPayload` JSON: `{method, path, headers, body, query, ts}`.
The headers include the user's JWT — verbatim, for forging downstream.

## Why it matters for the demo

We're replaying the *policy*, not the page. That means we need exactly
one captured request to drive the prod/branch comparison on slide 6. No
request, no money shot.

## Acceptance criteria

- [ ] `hush/capture.ts` exports `captureFailingRequest(sessionId,
      windowSec) -> ReplayPayload | null`
- [ ] Filters edge-fn logs to requests where (a) the user matches the
      session's user id, (b) the response shape suggests an empty result
      where one was expected (e.g. `rows=0`, `200 OK`)
- [ ] JWT extracted verbatim from `Authorization: Bearer ...`
- [ ] If multiple candidates, picks the one closest to the rage-click
      timestamp
- [ ] Returns `null` cleanly if nothing matches — receipt page shows
      "no anomaly" instead of crashing
- [ ] Unit test against a recorded log fixture in `assets/data/`

## Likely files / surfaces touched

- `hush/capture.ts`
- `assets/data/edge-fn-log.sample.json`
- `hush/types.ts` (`ReplayPayload`)

## Notes

For the demo store, the "expected" row count for `/orders` is 3 (hard
coded in the seed). For prod, anything with `rows < expected_min` is a
candidate. Don't over-engineer the heuristic — the demo only needs to
catch the one case.

## Outcome
