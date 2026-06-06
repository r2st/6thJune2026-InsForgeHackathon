import { describe, it, expect } from 'vitest';
import { correlate } from './correlate.js';
import type { RequestLogEntry } from './types.js';

function entry(p: Partial<RequestLogEntry>): RequestLogEntry {
  return {
    id: 1,
    ts: '2026-06-06T12:00:00.000Z',
    sessionId: 's1',
    userId: 'u1',
    tenantId: 't1',
    route: '/orders',
    method: 'GET',
    rlsDecisions: null,
    returnedRows: 1,
    status: 200,
    ...p,
  };
}

describe('correlate', () => {
  it('refuses when the window is empty', () => {
    expect(correlate([])).toEqual({ ok: false, reason: 'no_logs' });
  });

  it('refuses when nothing failed', () => {
    const r = correlate([entry({ returnedRows: 3, status: 200 })]);
    expect(r).toEqual({ ok: false, reason: 'no_candidates' });
  });

  it('picks the empty-result-set request as the failing one', () => {
    const r = correlate([
      entry({ id: 2, route: '/orders', returnedRows: 0, status: 200 }),
      entry({ id: 1, route: '/profile', returnedRows: 1, status: 200 }),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entry.id).toBe(2);
      expect(r.entry.route).toBe('/orders');
    }
  });

  it('treats a 4xx as failing', () => {
    const r = correlate([entry({ route: '/orders', returnedRows: null, status: 403 })]);
    expect(r.ok).toBe(true);
  });

  it('refuses when multiple distinct routes failed', () => {
    const r = correlate([
      entry({ id: 2, route: '/orders', returnedRows: 0 }),
      entry({ id: 1, route: '/wishlist', returnedRows: 0 }),
    ]);
    expect(r).toEqual({ ok: false, reason: 'multiple_candidates' });
  });

  it('derives expectedRows from the most-filtering RLS decision', () => {
    const r = correlate([
      entry({
        route: '/orders',
        returnedRows: 0,
        rlsDecisions: [
          { policy: 'orders.orders_select', table: 'orders', rowsBefore: 3, rowsAfter: 0 },
        ],
      }),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.expectedRows).toBe(3);
  });

  it('picks the newest failing request when one route fails repeatedly', () => {
    const r = correlate([
      entry({ id: 3, route: '/orders', returnedRows: 0, ts: '2026-06-06T12:00:09.000Z' }),
      entry({ id: 2, route: '/orders', returnedRows: 0, ts: '2026-06-06T12:00:05.000Z' }),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.id).toBe(3);
  });
});
