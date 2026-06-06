---
id: 0026
title: Receipt page scaffold — Next.js skeleton at apps/receipt/
role: builder
priority: P0
owner: parallel-agent
started: 2026-06-06
status: done
depends_on: []
demo_path: yes — the right-screen narrator at 0:10 onward
---

## Goal

A Next.js skeleton at `apps/receipt/` that 0009 (Realtime stream), 0015
(channel wiring), and 0022 (diagnosis card) can build into without
re-scaffolding.

## Why it matters for the demo

This is the right half of the split screen. Every Realtime status line
("session captured ✓", "test failing", "PR opened") renders here. If the
scaffold isn't there, those downstream tickets have nowhere to land.

## Acceptance criteria

- [x] `apps/receipt/package.json` — Next.js, React 18, InsForge SDK
      reachable as a workspace dep.
- [x] `apps/receipt/tsconfig.json` — TypeScript 5.5+, strict.
- [x] `apps/receipt/README.md` — purpose + dev command.
- [x] No `node_modules/` checked in.

## Outcome

- **What shipped:** `apps/receipt/{package.json,tsconfig.json,README.md}`.
  Skeleton only — the `/r/[runId]` route, the Realtime subscription, and
  the timeline UI are all on downstream tickets (0015 wires the channel;
  0022 paints the diagnosis card; 0009 streams the five steps).
- **What was cut:** nothing.
- **How to verify:** `pnpm --filter receipt install && pnpm --filter receipt dev`
  loads Next on :3001.
