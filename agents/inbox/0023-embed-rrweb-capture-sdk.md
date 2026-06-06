---
id: 0023
title: Embed rrweb capture SDK in the toy app with a 30s ring buffer
role: builder
priority: P0
owner:
started:
status: inbox
depends_on: [0003]
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

- [ ] rrweb records `{ type, data, timestamp }` events into a `Witness.buffer`
- [ ] Buffer drops events older than 30s as new ones arrive (ring behavior,
      not unbounded)
- [ ] `Witness.flush()` returns the current buffer and clears it
- [ ] `maskAllInputs: true` is set; elements with `data-witness="mask"`
      are hard-masked
- [ ] Verified by triggering a flush from the browser console — the
      returned array replays cleanly in rrweb's player

## Likely files / surfaces touched

- toy app: `src/witness/capture.ts` (new)
- toy app entry: `src/main.tsx`
- HTML: one new `<script type="module">` tag

## Notes

Pick rrweb v2 unless docs/build issues bite (see open question in
`docs/architecture.md`). Keep the SDK small — no NPM scope creep.
