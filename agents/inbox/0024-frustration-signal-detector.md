---
id: 0024
title: Frustration-signal detector (rage-click, dead-click, abandoned-form)
role: builder
priority: P0
owner:
started:
status: inbox
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

- [ ] **Rage-click:** ≥3 clicks on the same target (or within 30px) in 1s
      fires `signal: 'rage_click'`
- [ ] **Dead-click:** a click with no DOM mutation AND no network request
      within 400ms fires `signal: 'dead_click'`
- [ ] **Abandoned-form:** any `input` events on a form, then `beforeunload`
      or route change without `submit`, fires `signal: 'abandoned_form'`
- [ ] Detector is debounced — at most one signal per 5s window
- [ ] On signal, calls `Capture.send({ signal, events: Hush.flush(),
      ctx })` (ticket 0006 implements `Capture.send`)
- [ ] Unit-tested with at least the rage-click case (jsdom or vitest)

## Likely files / surfaces touched

- toy app: `src/hush/signals.ts` (new)
- toy app: `src/hush/index.ts` (wire-up)
- tests: `src/hush/signals.test.ts`

## Notes

Dead-click is the right primary for the *pivoted* RLS-misfire demo (user
clicks "My Orders," nothing happens, RLS silently filtered). Rage-click is
the obvious crowd-pleaser. Wire both. Pick the one the script actually uses
based on `demo/pitch-script.md`.
