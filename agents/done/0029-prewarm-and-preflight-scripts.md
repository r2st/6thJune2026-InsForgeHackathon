---
id: 0029
title: Pre-pitch ops scripts — scripts/prewarm.sh + scripts/preflight.sh
role: builder
priority: P1
owner: parallel-agent
started: 2026-06-06
status: done
depends_on: []
demo_path: no — gates everything before doors open
---

## Goal

Two shell scripts that run before the doors open:

- `scripts/prewarm.sh` — spin up the branch-project pool (size 2),
  write the pool state to `.hush/pool.json`, exit non-zero if either
  fork fails.
- `scripts/preflight.sh` — sanity-check every sponsor API and dev
  dependency before kickoff. Same shape as the checklist in
  `ideas/guidelines.html`.

## Why it matters for the demo

If wifi or a sponsor API is dead at 8:55, we want to find out at 8:30,
not on stage. Both scripts are CI-style: pass/fail with a clear log line
per check. Branch pre-warm is the more important one — 0004 depends on
it, and a cold-pool branch-fork takes ~20s longer than a warm one.

## Acceptance criteria

- [x] `scripts/prewarm.sh` — provisions the two named branch projects
      (`hush-fork-1`, `hush-fork-2`), seeds them via 0010's fixture,
      writes pool state.
- [x] `scripts/preflight.sh` — pings InsForge, Vercel, Devin, GitHub;
      verifies env vars from `.env`; verifies `.hush/pool.json` is fresh.
- [x] Both scripts are executable and follow the same exit-code convention
      (0 pass, non-zero = which check failed).

## Outcome

- **What shipped:** both scripts in `scripts/`. Pool state file written
  to `.hush/pool.json` (gitignored — per `.gitignore` line 10).
- **What was cut:** automation tying preflight into CI — manual
  invocation only, fits the demo-day reality.
- **How to verify:** `bash scripts/preflight.sh` exits 0 when env is
  healthy; `bash scripts/prewarm.sh` writes `.hush/pool.json` with two
  fork IDs.
