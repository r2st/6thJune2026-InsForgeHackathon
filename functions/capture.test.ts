import { describe, it, expect } from 'vitest';
import { captureFailingRequest, toReplayPayload } from './capture.js';
import type { RequestLogEntry } from './types.js';

const FAILING: RequestLogEntry = {
  id: 4821,
  ts: '2026-06-06T18:00:37.500Z',
  sessionId: 'sess_8f3a01',
  userId: 'user_a',
  tenantId: '11111111-1111-1111-1111-111111111111',
  route: '/orders',
  method: 'GET',
  rlsDecisions: [
    { policy: 'orders.orders_select', table: 'orders', rowsBefore: 3, rowsAfter: 0 },
  ],
  returnedRows: 0,
  status: 200,
};

describe('toReplayPayload', () => {
  it('serializes a failing entry into a replayable bundle', () => {
    const p = toReplayPayload(FAILING, 3, 'jwt-abc');
    expect(p).toMatchObject({
      method: 'GET',
      path: '/orders',
      query: {},
      body: null,
      ts: FAILING.ts,
      jwt: 'jwt-abc',
      expectedRows: 3,
    });
  });

  it('splits query params out of the logged route', () => {
    const p = toReplayPayload({ ...FAILING, route: '/orders?status=open&limit=5' }, 3, 'j');
    expect(p.path).toBe('/orders');
    expect(p.query).toEqual({ status: 'open', limit: '5' });
  });
});

describe('captureFailingRequest', () => {
  const at = '2026-06-06T18:00:42.000Z';

  it('returns a ReplayPayload for the single empty-result request', async () => {
    const p = await captureFailingRequest('sess_8f3a01', at, {
      jwt: 'jwt-abc',
      fetchWindow: async () => [FAILING],
    });
    expect(p?.expectedRows).toBe(3);
    expect(p?.jwt).toBe('jwt-abc');
  });

  it('returns null when correlate finds no anomaly (no crash)', async () => {
    const ok: RequestLogEntry = { ...FAILING, returnedRows: 3, status: 200 };
    const p = await captureFailingRequest('s', at, { jwt: 'j', fetchWindow: async () => [ok] });
    expect(p).toBeNull();
  });

  it('returns null when the window is empty', async () => {
    const p = await captureFailingRequest('s', at, { jwt: 'j', fetchWindow: async () => [] });
    expect(p).toBeNull();
  });

  it('returns null when no JWT is available to replay against prod', async () => {
    const p = await captureFailingRequest('s', at, { fetchWindow: async () => [FAILING] });
    expect(p).toBeNull();
  });

  it('refuses on ambiguous multi-route failures', async () => {
    const other: RequestLogEntry = { ...FAILING, id: 9, route: '/invoices' };
    const p = await captureFailingRequest('s', at, {
      jwt: 'j',
      fetchWindow: async () => [FAILING, other],
    });
    expect(p).toBeNull();
  });
});
