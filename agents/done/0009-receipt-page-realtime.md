---
id: 0009
title: Stream fork-test steps to the receipt page over Realtime
role: builder
priority: P0
owner: claude-app-layer
started: 2026-06-06T13:00Z
status: done
depends_on: [0008]
demo_path: yes — slide 5 → 6 transition is driven by these events
---

## Goal

A `hush/events.ts` publisher that emits one event per fork-test stage
to an InsForge Realtime channel (`hush:session:<id>`). The receipt UI
subscribes and updates the step rows in real time — the visible "live"
behavior on slides 5–7.

## Why it matters for the demo

The receipt page is the demo's narrator. Steps lighting up one by one
("session captured" → "log tapped" → "branch project spawned" →
"replay green") is the entire visual rhythm of the 60-second arc. If
this is a static screen, the demo dies.

## Acceptance criteria

- [ ] Events: `session.captured`, `log.tapped`, `diagnosis.ready`,
      `branch.acquired`, `diff.applied`, `replay.started`, `verdict.ready`,
      `pr.opened` — each with a payload sufficient to render its row
- [ ] Latency target: <250ms publisher → subscriber on the local network
- [ ] UI gracefully renders out-of-order events (last-write-wins per step
      key)
- [ ] If the realtime channel drops, UI falls back to polling every 1s
- [ ] Replays survive page refresh — emit a `session.snapshot` event on
      subscribe with current state

## Likely files / surfaces touched

- `hush/events.ts` (publisher)
- `app/receipt/[sessionId]/page.tsx` (subscriber UI)
- `hush/types.ts` (event union)

## Notes

This is the only place we use Realtime; keep the channel name scheme
simple (`hush:session:<id>`). The receipt page styling lives in the
deck CSS already — match the look in [demo/slides/index.html](../../demo/slides/index.html)
slide 5.

## Outcome

## Outcome
Publisher already shipped inside fix-trigger.ts (ReceiptEvent on channel 'receipt'). Built the subscriber half: lib/realtime.ts (WebSocket + polling fallback + scripted demo mode), feed renders out-of-order events last-write-wins per step.
