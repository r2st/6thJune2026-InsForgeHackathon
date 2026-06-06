---
id: 0008
title: Parallel-replay the captured request against prod and fork, return verdict
role: builder
priority: P0
owner:
started:
status: inbox
depends_on: [0005, 0006, 0007]
demo_path: yes — this IS slide 6's prod-red / branch-green output
---

## Goal

`witness/replay.ts` exports `replayBoth(payload, branchId) ->
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

- `witness/replay.ts`
- `witness/types.ts` (`Verdict`)

## Notes

For the demo, we know prod expects 3 orders. In the general case, the
"expected" comes from the diagnosis step — it states what the user
*should* have seen. For this hackathon, hard-code the demo case; leave
a TODO with a pointer to the diagnosis step.

## Outcome
