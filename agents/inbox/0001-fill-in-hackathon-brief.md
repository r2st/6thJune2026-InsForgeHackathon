---
id: 0001
title: Fill in docs/brief.md with the actual hackathon details
role: storyteller
priority: P0
owner:
started:
status: inbox
depends_on: []
demo_path: no — unblocks every other task
---

## Goal

Replace placeholders in `docs/brief.md` with the real event details:
sponsors, tracks, prizes, judging rubric, judge names, deadline.

## Why it matters for the demo

Every downstream decision — what to build, what to demo, which sponsor APIs
to feature — depends on this being concrete. Without it, the team builds
the wrong thing.

## Acceptance criteria

- [ ] Event name, deadline (absolute datetime + TZ), and pitch slot length
      filled in
- [ ] Each track / sponsor prize listed with required APIs and notes
- [ ] Judging rubric captured verbatim (or note "not published" + closest link)
- [ ] At least one named judge with a one-line read on what they'll value
- [ ] "Our angle" section has a draft one-liner, real customer name, and
      the pain in one sentence (drafts are fine — sharpen later)
- [ ] "What we're explicitly NOT building" has 2–3 entries

## Likely files / surfaces touched

- `docs/brief.md`

## Notes

If you don't know an answer, write `TBD — <how we'll find out>` rather than
deleting the row. Half-filled is more useful than missing.
