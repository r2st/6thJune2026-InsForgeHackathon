---
id: 0023
title: Embed rrweb capture SDK in the toy app with a 30s ring buffer
role: builder
priority: P0
owner: claude
started: 2026-06-06
status: done
depends_on: [0025]
demo_path: yes — the clip the receipt page replays
---

## Goal

Wire [rrweb](https://github.com/rrweb-io/rrweb) into the toy demo app so it
records DOM + interaction events into a 30-second rolling buffer in memory.
No transport yet — that's 0006. Just buffer + expose a flush API.

## Why it matters for the demo

The receipt page's money shot is a replay of the user's last 30s. No
recording, no replay, no demo.

## Acceptance criteria

- [x] rrweb records `eventWithTime` events into a module-level buffer
- [x] Buffer drops events older than 30s as new ones arrive (ring behavior, not unbounded)
- [x] `window.Hush.flush()` returns the current buffer and clears it
- [x] `maskAllInputs: true` is set; `data-hush="mask"` is masked via `maskTextSelector`; `data-hush="block"` is fully blocked
- [x] Console API exposed (`window.Hush.flush() / .peek() / .size()`) — verifiable in browser

## Files touched

- `apps/demo/lib/hush/capture.ts` (new) — pure rrweb wrapper + ring trim
- `apps/demo/lib/hush/CaptureProvider.tsx` (new) — client component that calls `start()` once and exposes the console API
- `apps/demo/app/layout.tsx` (new) — root layout that mounts `<CaptureProvider />`
- `apps/demo/app/page.tsx` (new) — landing page with the console-verify instructions
- `apps/demo/next-env.d.ts` (new)

## Outcome

- **What shipped:** rrweb v2 wired with a 30s rolling ring; capture starts on first client render via a `'use client'` provider; three-method console API at `window.Hush` (`flush` / `peek` / `size`).
- **What was cut:** the ticket originally hinted at a Vite/`src/main.tsx` layout, but the scaffold is Next.js 15 App Router (per ticket 0025) — used `app/layout.tsx` + `lib/hush/` instead. Filename note: had to rename `Capture.tsx` → `CaptureProvider.tsx` to avoid a case-insensitive collision with `capture.ts`.
- **How to verify:** `pnpm --filter demo typecheck` is clean; `pnpm --filter demo dev` and then in the browser console `Hush.size()`, `Hush.peek()`, `Hush.flush()` return the buffer; masked nodes' text content is `***` in the events.

## Notes

Pick rrweb v2 unless docs/build issues bite (see open question in
`docs/architecture.md`). Keep the SDK small — no NPM scope creep.

The buffer trim runs on every `emit`, which is O(events-to-drop) — acceptable for a 30s window. If a future ticket needs longer windows, switch to a circular array.
