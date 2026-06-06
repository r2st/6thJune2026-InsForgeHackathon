---
id: 0015
title: Receipt page subscribes to bug_stream and renders capture in <1s
role: builder
priority: P1
owner: claude-app-layer
started: 2026-06-06T13:00Z
status: in_progress
depends_on: [0013]
demo_path: yes — the screen the judges watch light up
---

## Goal

The receipt page subscribes to `bug_stream:{tenant_id}` over InsForge
Realtime and renders the status line "session captured · 1 anomaly" within
1 second of a frustration signal firing.

## Why it matters for the demo

This is the visual proof that capture works. Latency >1s kills the gasp
moment.

## Acceptance criteria

- [ ] Receipt page subscribes on mount; unsubscribes on unmount
- [ ] On `{session_id, signal, captured_at}` arrival, render a new
      "Session captured" line with the signal label and a relative timestamp
- [ ] Loads the rrweb clip via the signed `clip_url` and shows a poster
      frame (full replay can be a click-to-play)
- [ ] If no events arrive for 30s, show an idle state — no flicker
- [ ] Measured median signal-to-render <1s in dev (browser console)

## Likely files / surfaces touched

- toy app or separate receipt app: `src/receipt/Page.tsx`
- `src/hush/realtime-client.ts`

## Notes

Receipt page can live in the same toy app on a separate route (`/receipt`)
or as a sibling app. Same-app is simpler for the demo split-screen.
