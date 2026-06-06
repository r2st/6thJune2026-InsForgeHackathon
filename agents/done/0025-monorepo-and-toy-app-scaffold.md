---
id: 0025
title: Toy storefront scaffold — Next.js + rrweb skeleton at apps/demo/
role: builder
priority: P0
owner: parallel-agent
started: 2026-06-06
status: done
depends_on: []
demo_path: yes — this is the victim app the user clicks through
---

## Goal

A working Next.js 15 + React 18 skeleton at `apps/demo/` that 0023 (rrweb),
0024 (frustration detector), and 0016 (RLS-misfire demo bug) can build on
without re-scaffolding from scratch.

## Why it matters for the demo

The first thing on screen at 0:00 is this app's "My Orders" page. If the
scaffold isn't there at T+1h, tickets 0023 / 0024 / 0016 cannot land and
the demo has no left-screen.

## Acceptance criteria

- [x] `apps/demo/package.json` — Next.js, React 18, rrweb ^2.0 as deps;
      `dev`, `build`, `start`, `lint`, `typecheck` scripts.
- [x] `apps/demo/tsconfig.json` — TypeScript 5.5+, strict.
- [x] `apps/demo/README.md` — what the app is and how to run it.
- [x] No `node_modules/` checked in.

## Outcome

- **What shipped:** `apps/demo/{package.json,tsconfig.json,README.md}`.
  Pure scaffold — Orders page, login fixture, and InsForge client wiring
  are still TODO on downstream tickets (0014 wires the fetch wrapper;
  0016 seeds the broken RLS path).
- **What was cut:** nothing — scoped strictly to skeleton.
- **How to verify:** `pnpm --filter demo install && pnpm --filter demo dev`
  loads Next on :3000.
