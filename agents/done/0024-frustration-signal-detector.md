---
id: 0024
title: Frustration-signal detector (rage-click, dead-click, abandoned-form)
role: builder
priority: P0
owner: claude
started: 2026-06-06
status: done
depends_on: [0023]
demo_path: yes — this is what fires capture on stage
---

## Goal

A small in-app detector that watches user interactions and decides when
to ship a bundle via `Hush.flush()`. Must reliably fire on stage from
a scripted rage-click sequence.

## Why it matters for the demo

The 0:00–0:10 beat of the pitch is "user rage-clicks, receipt page lights
up." Detector reliability *is* the demo.

## Acceptance criteria

- [x] **Rage-click:** ≥3 clicks on the same target OR within 30px in 1s fires `kind: 'rage_click'`
- [x] **Dead-click:** click with no DOM mutation AND no fetch within 400ms fires `kind: 'dead_click'`
- [x] **Abandoned-form:** `input` events on a form, then `beforeunload` or `popstate` without `submit` fires `kind: 'abandoned_form'`
- [x] Cooldown — at most one signal per 5s (configurable via `cooldownMs`)
- [x] Wired into `CaptureProvider` — on signal, calls `flush()` and logs. (Ticket 0013 will replace the log with a POST to `/capture`.)
- [x] Vitest tests for rage-click (3 cases) and dead-click (1 case). All 4 pass.

## Files touched

- `apps/demo/lib/hush/signals.ts` (new) — pure detector, returns a `stop()` function
- `apps/demo/lib/hush/signals.test.ts` (new) — 4 vitest cases
- `apps/demo/lib/hush/CaptureProvider.tsx` (edit) — calls `startSignals` after `startCapture`; stub `onSignal` flushes the buffer and logs
- `apps/demo/package.json` (edit) — added `test` script + `vitest` + `happy-dom` devDeps
- `apps/demo/vitest.config.ts` (new) — happy-dom env, `lib/**/*.test.ts`

## Outcome

- **What shipped:** all three signal kinds (rage / dead / abandoned), cooldown, fetch interception scoped to dead-click timing. Detector is a single `start(opts)` that returns `stop()`. Wired into the provider so it runs on every page mount.
- **What was cut:** no abandoned-form test — the rage-click test demonstrates the cooldown/dedup path, dead-click test demonstrates the mutation/fetch watch; abandoned-form is structurally simpler and lower-risk. Add if it bites.
- **How to verify:** `pnpm --filter demo test` → 4 passing. `pnpm --filter demo dev`, open browser, click a button 3× fast → console logs `[hush] signal rage_click {...}` and `window.Hush.lastSignal` is populated.

## Notes

Dead-click is the right primary for the pivoted RLS-misfire demo (user
clicks "My Orders," nothing happens, policy silently filtered). Rage-click
is the crowd-pleaser. Both wired. Pitch script can pick which fires
first by choreographing the click cadence.

The `onSignal` callback flushes the rrweb buffer. Once 0013 lands, the
provider's stub should be replaced with a `fetch('/capture', { … })`
that sends `{ signal, events, ctx }`.
