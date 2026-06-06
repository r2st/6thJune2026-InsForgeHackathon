import { describe, it, expect } from 'vitest';
import { traceReplay } from './traceReplay.js';
import type { ReplayPayload, TomlPatch } from './types.js';

const ACME = '11111111-1111-1111-1111-111111111111';

function jwt(body: object): string {
  const b64 = (s: string) =>
    Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64('{}')}.${b64(JSON.stringify(body))}.sig`;
}

const PATCH: TomlPatch = {
  path: 'tables.orders.rls',
  before: "tenant_id = (auth.jwt() ->> 'tenant')::uuid",
  after: "tenant_id = (auth.jwt() ->> 'tenant')::uuid OR tenant_id = ANY(array(select jsonb_array_elements_text(auth.jwt() -> 'tenant_ids'))::uuid[])",
};

function payload(claims: object): ReplayPayload {
  return {
    method: 'GET', path: '/orders', query: {}, headers: {}, body: null,
    ts: '2026-06-06T18:00:37.500Z', jwt: jwt(claims), expectedRows: 3,
  };
}

describe('traceReplay', () => {
  it('reproduces the demo bug and verifies the fix against the seed', () => {
    // Migrated user: tenant_ids set, no singular tenant claim.
    const v = traceReplay({ payload: payload({ sub: 'user_a', tenant_ids: [ACME] }), patch: PATCH });
    expect(v.prod.rowsReturned).toBe(0);  // before-predicate reads 'tenant' → null → 0
    expect(v.fork.rowsReturned).toBe(3);  // after-predicate reads tenant_ids → 3
    expect(v.bugConfirmed).toBe(true);
    expect(v.fixVerified).toBe(true);
    expect(v.mode).toBe('trace');
  });

  it('always tags the verdict mode trace (never masquerades as fork)', () => {
    const v = traceReplay({ payload: payload({ tenant_ids: [ACME] }), patch: PATCH });
    expect(v.mode).toBe('trace');
    expect(v.rationale).toMatch(/trace-only/);
  });

  it('does not widen: a tenant-B user still sees zero rows under the candidate', () => {
    const v = traceReplay({
      payload: payload({ tenant_ids: ['22222222-2222-2222-2222-222222222222'] }),
      patch: PATCH,
    });
    expect(v.fork.rowsReturned).toBe(0);
    expect(v.fixVerified).toBe(false);
  });

  it('reports inconclusive when the candidate does not restore rows', () => {
    const noop: TomlPatch = { ...PATCH, after: PATCH.before };
    const v = traceReplay({ payload: payload({ tenant_ids: [ACME] }), patch: noop });
    expect(v.fixVerified).toBe(false);
    expect(v.bugConfirmed).toBe(false);
  });

  it('admits nothing for an unrecognised predicate family (no guessing)', () => {
    const weird: TomlPatch = { path: 'tables.orders.rls', before: '1 = 1', after: 'true' };
    const v = traceReplay({ payload: payload({ tenant_ids: [ACME] }), patch: weird });
    expect(v.prod.rowsReturned).toBe(0);
    expect(v.fork.rowsReturned).toBe(0);
  });
});
