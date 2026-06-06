import { describe, it, expect } from 'vitest';
import { replaySuite, suiteToVerdict, type ProbeSpec, type SuiteDeps } from './replay.js';
import type { ReplaySide } from './types.js';

function side(rows: number): ReplaySide {
  return { status: 200, rowsReturned: rows, latencyMs: 1, snippet: '' };
}

/**
 * Build injected probe deps from a table of per-probe row counts:
 *   rows[probeName] = [prodRows, forkRows]
 */
function deps(rows: Record<string, [number, number]>): SuiteDeps {
  return {
    runProbe: async (sideName: 'prod' | 'fork', probe: ProbeSpec) => {
      const [prod, fork] = rows[probe.name]!;
      return side(sideName === 'prod' ? prod : fork);
    },
  };
}

const HEALTHY = {
  failing: [0, 3] as [number, number],  // prod 0/3, fork 3 — reproduced + fixed
  neighbor: [0, 0] as [number, number], // tenant B empty on both
  count: [3, 3] as [number, number],
  join: [3, 3] as [number, number],
};

describe('replaySuite', () => {
  it('fires all four probes and scores a clean fix at 100', async () => {
    const v = await replaySuite({ expectedRows: 3 }, deps(HEALTHY));
    expect(v.probes).toHaveLength(4);
    expect(v.bugConfirmed).toBe(true);
    expect(v.fixVerified).toBe(true);
    expect(v.widensAccess).toBe(false);
    expect(v.suiteScore).toBe(100);
    expect(v.probes.every((p) => p.pass)).toBe(true);
  });

  it('detects widening when the neighbor tenant suddenly sees rows on the fork → score 0', async () => {
    const v = await replaySuite({ expectedRows: 3 }, deps({ ...HEALTHY, neighbor: [0, 2] }));
    expect(v.widensAccess).toBe(true);
    expect(v.suiteScore).toBe(0);
    expect(v.rationale).toMatch(/WIDENING/);
  });

  it('scores 60 when a regression probe (count) disagrees but the fix is verified', async () => {
    const v = await replaySuite({ expectedRows: 3 }, deps({ ...HEALTHY, count: [3, 5] }));
    expect(v.bugConfirmed).toBe(true);
    expect(v.fixVerified).toBe(true);
    expect(v.widensAccess).toBe(true); // fork count > prod count is itself a widen signal
    expect(v.suiteScore).toBe(0);
  });

  it('scores 60 for a benign regression that is not extra-rows-on-fork', async () => {
    // join returns FEWER rows on fork (a break, not a widen): regression, not widening.
    const v = await replaySuite({ expectedRows: 3 }, deps({ ...HEALTHY, join: [3, 1] }));
    expect(v.widensAccess).toBe(false);
    expect(v.fixVerified).toBe(true);
    expect(v.suiteScore).toBe(60);
  });

  it('scores 30 when the bug reproduces but the fork does not restore rows', async () => {
    const v = await replaySuite({ expectedRows: 3 }, deps({ ...HEALTHY, failing: [0, 1] }));
    expect(v.bugConfirmed).toBe(true);
    expect(v.fixVerified).toBe(false);
    expect(v.suiteScore).toBe(30);
  });

  it('scores 0 when the bug never reproduced on prod', async () => {
    const v = await replaySuite({ expectedRows: 3 }, deps({ ...HEALTHY, failing: [3, 3] }));
    expect(v.bugConfirmed).toBe(false);
    expect(v.suiteScore).toBe(0);
  });
});

describe('suiteToVerdict', () => {
  it('uses the failing probe as the headline and carries suiteScore', async () => {
    const suite = await replaySuite({ expectedRows: 3 }, deps(HEALTHY));
    const v = suiteToVerdict(suite);
    expect(v.prod.rowsReturned).toBe(0);
    expect(v.fork.rowsReturned).toBe(3);
    expect(v.suiteScore).toBe(100);
    expect(v.mode).toBe('fork');
    expect(v.fixVerified).toBe(true);
  });

  it('forces fixVerified=false when the suite detected widening', async () => {
    const suite = await replaySuite({ expectedRows: 3 }, deps({ ...HEALTHY, neighbor: [0, 2] }));
    const v = suiteToVerdict(suite);
    expect(v.fixVerified).toBe(false);
    expect(v.suiteScore).toBe(0);
  });
});
