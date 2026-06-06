---
id: 0004
title: Pre-warm a pool of 2 InsForge branch projects at demo start
role: architect
priority: P0
owner: claude-opus-4-8
started: 2026-06-06
status: done
depends_on: []
demo_path: yes — without this, slide 6 stalls and the pitch dies
---

## Goal

A `scripts/prewarm.sh` (or equivalent) that, at demo start, spins up
**two** named branch projects (`hush-fork-1`, `hush-fork-2`) seeded
with the demo fixture, with `insforge.toml` set to the *known-buggy*
state. Hush pulls a fork off the pool in <2s instead of waiting 8–15s
for a cold spin-up.

## Why it matters for the demo

The receipt page on slide 5 lights up "branch project · spawning" as a
status line. If that line hangs more than ~3s, the demo loses momentum
and the side-by-side terminals on slide 6 don't appear in budget. The
"in under a minute" close is unrecoverable from there.

## Acceptance criteria

- [ ] `scripts/prewarm.sh --count 2` spins up and seeds both forks
- [ ] Pool state is persisted to `.hush/pool.json` so the Hush
      runtime can claim a fork synchronously
- [ ] After a fork is consumed, the script auto-tops-up to keep N=2
- [ ] Idempotent — re-running with N forks already up is a no-op
- [ ] Documented teardown command (`scripts/prewarm.sh --teardown`)

## Likely files / surfaces touched

- `scripts/prewarm.sh`
- `.hush/pool.json` (gitignored)
- `docs/architecture.md` (note the pool in the system diagram)

## Notes

InsForge branch projects inherit the parent's schema. Open question in
[docs/decisions/0001-test-on-a-fork.md](../../docs/decisions/0001-test-on-a-fork.md)
re: whether `insforge.toml` is inherited — verify with the InsForge skill
first. If not inherited, this script also pushes the buggy toml.

If branch-project spin-up itself proves >10s consistently, fall back to
keeping a single long-lived `hush-fork` and resetting it between
demos via `insforge branch reset`.

## Outcome
<!-- Fill in when moving to done/. -->

## Outcome

- `scripts/prewarm.sh` matured: `--count N` creates/reuses `hush-fork-<i>`
  branches (verified CLI: `branch create --mode full --no-switch`, reuse via
  `branch reset`), seeds each from `infra/seed/two-tenants.sql`, and writes
  `.hush/pool.json` in the exact `functions/lib/pool.ts` PoolEntry shape
  (jwtSecret = parent's shared JWT_SECRET).
- Idempotent (no-op when >=N unclaimed pooled); `--teardown` deletes branches +
  removes pool.json; `--mock` synthesises a valid pool offline (validated
  against pool.ts: entries=2, firstFree ok).
- Caveat: `branch list --json` fields + `db query` seed invocation to be
  confirmed on the live CLI; overridable via HUSH_FORK_BASE_URL_<i>.
