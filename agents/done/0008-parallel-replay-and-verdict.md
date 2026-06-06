---
id: 0008
title: Parallel-replay the captured request against prod and fork, return verdict
role: builder
priority: P0
owner: claude-opus-4-8 (impl session)
started: 2026-06-06
status: done
depends_on: [0005, 0006, 0007]
demo_path: yes — this IS slide 6's prod-red / branch-green output
---

## Goal

`hush/replay.ts` exports `replayBoth(payload, branchId) ->
Verdict`, where `Verdict` is:

```ts
{
  prod: { status, rowsReturned, latencyMs, snippet },
  fork: { status, rowsReturned, latencyMs, snippet },
  bugConfirmed: boolean,   // prod < expected && fork >= expected
  fixVerified: boolean,    // fork meets expectation
  rationale: string,       // one-line for the PR description
}
```

Runs the two replays **in parallel** (Promise.all), uses the original
JWT against prod and a forged JWT against the fork, parses the response
body to count rows.

## Why it matters for the demo

The two terminals on slide 6 (`prod` red, `branch` green) are rendered
directly from this verdict. The `rowsReturned: 0` vs `rowsReturned: 3`
delta is the only "is this real" signal we have.

## Acceptance criteria

- [ ] Parallel execution — total wall-clock ≤ slower-of-two + 100ms
- [ ] `bugConfirmed` is `true` only when prod returns fewer rows than the
      seeded expectation AND fork meets the expectation
- [ ] Cache-bypass headers set on both requests
- [ ] If either side throws, `bugConfirmed: false` and the rationale
      captures the error
- [ ] Snippet field is short (≤200 chars) and embeddable in the PR
- [ ] Latency reported so the receipt page can show "prod: 142ms · fork:
      138ms"

## Likely files / surfaces touched

- `hush/replay.ts`
- `hush/types.ts` (`Verdict`)

## Notes

For the demo, we know prod expects 3 orders. In the general case, the
"expected" comes from the diagnosis step — it states what the user
*should* have seen. For this hackathon, hard-code the demo case; leave
a TODO with a pointer to the diagnosis step.

## Outcome

- **Shipped:** `functions/replay.ts` (`replayBoth`, `countRows`) + 16 tests in
  `functions/replay.test.ts`. replay.ts typechecks clean; full functions suite
  green (91/91).
- Fires prod + fork in parallel (`Promise.all`) — original JWT to prod, forged
  JWT (0007) to the fork. Cache-bypass headers on both. Two-signal verdict:
  `bugConfirmed = prod < expected && fork >= expected`, `fixVerified = fork >=
  expected`. A transport error on either side withholds the verdict
  (bugConfirmed false, rationale names the failing side).
- `countRows` handles the PostGREST/InsForge body shapes (bare array,
  `{data}`, `{rows}`, count envelope); an unreadable body counts as 0 rows —
  not evidence of rows.
- **Testability:** `fetch`, both base URLs, and the clock are injected via an
  optional `deps` arg (defaulted from env/global), so the load-bearing logic is
  verified hermetically — no live branch needed. A parallelism test asserts both
  requests are in flight at once.
- **For [[0030-fix-trigger-orchestrator]]:** pass `forkBaseUrl` from the prewarm
  pool ([[0004-prewarm-branch-pool]]) and `forkJwt` from [[0007-jwt-forge]]. The
  verdict feeds [[0020-confidence-scorer-and-tier-routing]] directly.
- `expectedRows` is read from the `ReplayPayload` (hard-coded to 3 for the demo
  by capture/diagnose, per the ticket note). When [[0033-differential-replay-suite]]
  lands it supersedes this single-probe verdict with a 4-probe suite; this stays
  as the single-payload primitive it builds on.
