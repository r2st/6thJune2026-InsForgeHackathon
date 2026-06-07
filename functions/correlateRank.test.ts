// functions/correlateRank.test.ts
// Acceptance tests for robust correlation ranking (ticket 0079).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import { rankFailingRequests } from './correlateRank.js';
import type { RequestLogEntry } from './types.js';

const T0 = '2026-06-07T12:00:00.000Z';
const at = (sec: number) => new Date(Date.parse(T0) + sec * 1000).toISOString();

function entry(over: Partial<RequestLogEntry>): RequestLogEntry {
  return {
    id: 1, ts: T0, sessionId: 's', userId: 'u', tenantId: 't',
    route: '/orders', method: 'GET', rlsDecisions: null, returnedRows: null, status: 200,
    ...over,
  };
}

const bug = (over: Partial<RequestLogEntry> = {}) =>
  entry({ route: '/orders', returnedRows: 0, rlsDecisions: [{ policy: 'orders.orders_select', table: 'orders', rowsBefore: 3, rowsAfter: 0 }], ...over });

describe('rankFailingRequests — the bug signature wins', () => {
  it('picks the request where a policy hid existing rows over a legit-empty one', () => {
    const window = [
      entry({ id: 1, route: '/notifications', returnedRows: 0 }), // legitimately empty
      bug({ id: 2, ts: at(-1) }),                                 // the real bug
      entry({ id: 3, route: '/cart', returnedRows: 0 }),          // legitimately empty
    ];
    const r = rankFailingRequests(window, { frustrationAt: at(0), frustrationRoute: '/orders' });
    expect(r.abstain).toBe(false);
    expect(r.best?.id).toBe(2);
    expect(r.confidence).toBeGreaterThan(60);
    expect(r.ranked[0]!.reasons.join(' ')).toMatch(/dropped existing rows/);
  });
});

describe('rankFailingRequests — abstains when ambiguous', () => {
  it('two equally-empty requests with no RLS evidence → abstain (no guess)', () => {
    const window = [
      entry({ id: 1, route: '/a', returnedRows: 0, ts: at(-1) }),
      entry({ id: 2, route: '/b', returnedRows: 0, ts: at(-1) }),
    ];
    const r = rankFailingRequests(window, { frustrationAt: at(0) });
    expect(r.abstain).toBe(true);
    expect(r.best).toBeNull();
  });

  it('no candidates at all → abstain', () => {
    const window = [entry({ returnedRows: 5, status: 200 }), entry({ returnedRows: 2, status: 200 })];
    expect(rankFailingRequests(window, { frustrationAt: at(0) })).toMatchObject({ abstain: true, best: null });
  });
});

describe('rankFailingRequests — proximity & route break ties', () => {
  it('the empty request closest to the frustration and on the viewed route wins', () => {
    const window = [
      entry({ id: 1, route: '/orders', returnedRows: 0, ts: at(-120) }), // far in time
      entry({ id: 2, route: '/orders', returnedRows: 0, ts: at(-1) }),   // right at frustration
    ];
    const r = rankFailingRequests(window, { frustrationAt: at(0), frustrationRoute: '/orders' });
    // both lack RLS evidence; proximity should make #2 the top — but with no
    // strong evidence it may still abstain. Assert ordering regardless.
    expect(r.ranked[0]!.entry.id).toBe(2);
  });

  it('a clear RLS-evidenced winner is confident even among many requests', () => {
    const window = [
      ...Array.from({ length: 6 }, (_, i) => entry({ id: i + 10, route: `/r${i}`, returnedRows: 5 })),
      bug({ id: 99, ts: at(-2) }),
    ];
    const r = rankFailingRequests(window, { frustrationAt: at(0), frustrationRoute: '/orders' });
    expect(r.best?.id).toBe(99);
    expect(r.abstain).toBe(false);
  });
});

describe('rankFailingRequests — client errors are candidates', () => {
  it('a 403 on the viewed route is picked up', () => {
    const window = [entry({ id: 1, route: '/orders', status: 403, returnedRows: null, ts: at(-1) })];
    const r = rankFailingRequests(window, { frustrationAt: at(0), frustrationRoute: '/orders' });
    expect(r.ranked).toHaveLength(1);
    expect(r.ranked[0]!.reasons.some((x) => x.includes('403'))).toBe(true);
  });
});
