// functions/stateful.test.ts
// Acceptance tests for stateful / multi-request bug handling (ticket 0093).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import { analyzeSequence, decideStatefulHandling } from './stateful.js';
import type { RequestLogEntry } from './types.js';

const T0 = Date.parse('2026-06-07T12:00:00Z');
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();

function req(over: Partial<RequestLogEntry>): RequestLogEntry {
  return {
    id: 1, ts: at(0), sessionId: 's', userId: 'u', tenantId: 't',
    route: '/orders', method: 'GET', rlsDecisions: null, returnedRows: 0, status: 200, ...over,
  };
}

describe('analyzeSequence — the simple single-request case', () => {
  it('a failing read with no prior same-resource mutation is not stateful', () => {
    const failing = req({ id: 2, route: '/orders', method: 'GET', ts: at(5) });
    const window = [req({ id: 1, route: '/profile', method: 'GET', ts: at(1) }), failing];
    const a = analyzeSequence(window, failing);
    expect(a.stateful).toBe(false);
    expect(a.sequence).toEqual([failing]);
    expect(decideStatefulHandling(a).action).toBe('replay_single');
  });
});

describe('analyzeSequence — stateful & reconstructable → replay the sequence', () => {
  it('a GET /orders failing after a successful POST /orders is stateful and replayable', () => {
    const post = req({ id: 1, route: '/orders', method: 'POST', status: 201, returnedRows: 1, ts: at(1) });
    const failing = req({ id: 2, route: '/orders', method: 'GET', status: 200, returnedRows: 0, ts: at(3) });
    const a = analyzeSequence([post, failing], failing);
    expect(a.stateful).toBe(true);
    expect(a.reconstructable).toBe(true);
    expect(a.sequence.map((e) => e.id)).toEqual([1, 2]); // mutation then read, ordered
    expect(decideStatefulHandling(a).action).toBe('replay_sequence');
  });

  it('orders the establishing mutations before the failing read regardless of input order', () => {
    const failing = req({ id: 3, route: '/cart/items', method: 'GET', ts: at(5), returnedRows: 0 });
    const m1 = req({ id: 1, route: '/cart/items', method: 'POST', status: 201, ts: at(1) });
    const m2 = req({ id: 2, route: '/cart/items', method: 'PUT', status: 200, ts: at(3) });
    const a = analyzeSequence([failing, m2, m1], failing); // shuffled
    expect(a.sequence.map((e) => e.id)).toEqual([1, 2, 3]);
  });
});

describe('analyzeSequence — stateful but NOT reconstructable → decline honestly', () => {
  it('a prior mutation that errored means the state cannot be reconstructed', () => {
    const badPost = req({ id: 1, route: '/orders', method: 'POST', status: 500, ts: at(1) });
    const failing = req({ id: 2, route: '/orders', method: 'GET', returnedRows: 0, ts: at(3) });
    const a = analyzeSequence([badPost, failing], failing);
    expect(a.stateful).toBe(true);
    expect(a.reconstructable).toBe(false);
    const d = decideStatefulHandling(a);
    expect(d.action).toBe('decline_to_issue');
    expect(d.reason).toMatch(/stateful — needs a human/);
  });
});

describe('decideStatefulHandling — never a confident single PR for a stateful bug', () => {
  it('a stateful-unreconstructable bug is routed to an issue, not a fix', () => {
    const badDelete = req({ id: 1, route: '/orders', method: 'DELETE', status: 409, ts: at(1) });
    const failing = req({ id: 2, route: '/orders', method: 'GET', returnedRows: 0, ts: at(2) });
    expect(decideStatefulHandling(analyzeSequence([badDelete, failing], failing)).action).toBe('decline_to_issue');
  });

  it('only same-resource mutations count (a POST to a different resource is ignored)', () => {
    const otherPost = req({ id: 1, route: '/analytics', method: 'POST', status: 201, ts: at(1) });
    const failing = req({ id: 2, route: '/orders', method: 'GET', returnedRows: 0, ts: at(3) });
    expect(analyzeSequence([otherPost, failing], failing).stateful).toBe(false);
  });
});
