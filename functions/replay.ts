// functions/replay.ts
// Parallel replay against prod and the fork. Returns a falsifiable Verdict.
//
// Ticket: agents/inbox/0008-parallel-replay-and-verdict.md
// Two-signal principle ("Lie #03 + #05" defense from the-hardest-part.html):
//   bugConfirmed  iff prod returns fewer rows than expectedRows
//   fixVerified   iff fork returns at least expectedRows
//   neither alone is sufficient to declare success.

import type { ReplayPayload, Verdict } from './types.js';

export interface ReplayInput {
  payload: ReplayPayload;
  branchId: string;
  /** Forged JWT signed by the fork's key, with the user's original claims. */
  forkJwt: string;
}

export async function replayBoth(_input: ReplayInput): Promise<Verdict> {
  // TODO(0008):
  //   - Fire both requests via Promise.all().
  //   - Set cache-bypass headers on both.
  //   - Parse response bodies to count rows.
  //   - Latency: report both individually so the receipt page can show timings.
  //   - On either throw → bugConfirmed: false, rationale captures the error.
  throw new Error('not implemented');
}
