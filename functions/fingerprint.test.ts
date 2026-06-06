import { describe, it, expect } from 'vitest';
import {
  fingerprintSchema, snapshotState, verifyAnchor, expectedForkFingerprint, verifyPostApply,
} from './fingerprint.js';
import type { TomlPatch } from './types.js';

const TOML = `[tables.orders]
columns = [
  "id uuid pk",
  "tenant_id uuid not null",
]
rls = "tenant_id = (auth.jwt() ->> 'tenant')::uuid"

[tables.tenants]
columns = ["id uuid pk"]
`;

const PATCH: TomlPatch = {
  path: 'tables.orders.rls',
  before: "tenant_id = (auth.jwt() ->> 'tenant')::uuid",
  after: "tenant_id = (auth.jwt() ->> 'tenant')::uuid OR tenant_id = ANY((auth.jwt() -> 'tenant_ids')::uuid[])",
};

describe('fingerprintSchema', () => {
  it('is stable for the same table block and ignores other tables', () => {
    const a = fingerprintSchema(TOML, 'orders');
    const b = fingerprintSchema(TOML + '\n[tables.extra]\ncolumns=["x int"]\n', 'orders');
    expect(a).toBe(b);
  });

  it('changes when the rls predicate changes', () => {
    const before = fingerprintSchema(TOML, 'orders');
    const after = fingerprintSchema(TOML.replace(PATCH.before, PATCH.after), 'orders');
    expect(before).not.toBe(after);
  });
});

describe('snapshotState + verifyAnchor', () => {
  const snapshot = snapshotState({
    tenantId: 't1', table: 'orders', toml: TOML, prodRowCount: 3, capturedAt: '2026-06-06T18:00:00Z',
  });

  it('captures row count and prod schema fingerprint', () => {
    expect(snapshot.prodRowCount).toBe(3);
    expect(snapshot.prodSchemaFingerprint).toBe(fingerprintSchema(TOML, 'orders'));
  });

  it('passes when nothing drifted', () => {
    const r = verifyAnchor({ snapshot, current: { prodRowCount: 3, prodSchemaFingerprint: snapshot.prodSchemaFingerprint } });
    expect(r.match).toBe(true);
  });

  it('flags a row-count move as a SOFT drift', () => {
    const r = verifyAnchor({ snapshot, current: { prodRowCount: 4, prodSchemaFingerprint: snapshot.prodSchemaFingerprint } });
    expect(r.match).toBe(false);
    expect(r.severity).toBe('soft');
    expect(r.drift).toMatch(/row count moved 3 → 4/);
  });

  it('flags a schema fingerprint change as a HARD drift (inconclusive)', () => {
    const r = verifyAnchor({ snapshot, current: { prodRowCount: 3, prodSchemaFingerprint: 'deadbeef' } });
    expect(r.match).toBe(false);
    expect(r.severity).toBe('hard');
    expect(r.drift).toMatch(/schema changed/);
  });
});

describe('verifyPostApply (silent no-op detection)', () => {
  const expected = expectedForkFingerprint(TOML, PATCH, 'orders');

  it('matches when the fork holds the intended patch', () => {
    expect(verifyPostApply({ expected, actual: expected }).match).toBe(true);
  });

  it('catches an apply that silently no-op\'d (fork still on the pre-patch fingerprint)', () => {
    const preApply = fingerprintSchema(TOML, 'orders');
    const r = verifyPostApply({ expected, actual: preApply });
    expect(r.match).toBe(false);
    expect(r.severity).toBe('hard');
    expect(r.drift).toMatch(/no-op/);
  });

  it('hard-fails when no fingerprint was reported', () => {
    const r = verifyPostApply({ expected, actual: undefined });
    expect(r.match).toBe(false);
    expect(r.severity).toBe('hard');
  });
});
