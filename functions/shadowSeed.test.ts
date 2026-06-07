// functions/shadowSeed.test.ts
// Acceptance tests for representative fork validation / synthetic shadows (0089).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import { parseColumns, generateShadows, fidelityScore } from './shadowSeed.js';

const ORDERS = `
[tables.orders]
columns = [
  "id uuid pk default gen_random_uuid()",
  "tenant_id uuid not null references tenants(id)",
  "user_id uuid not null",
  "total numeric(10,2) not null",
  "created_at timestamptz not null default now()",
]
rls = "tenant_id = (auth.jwt() ->> 'tenant')::uuid"
`;

describe('parseColumns — typed schema from the toml block', () => {
  const cols = parseColumns(ORDERS);
  it('extracts names and types', () => {
    expect(cols.map((c) => `${c.name}:${c.type}`)).toEqual([
      'id:uuid', 'tenant_id:uuid', 'user_id:uuid', 'total:numeric', 'created_at:timestamptz',
    ]);
  });
  it('marks the tenant-scope column', () => {
    expect(cols.find((c) => c.name === 'tenant_id')?.isTenantScope).toBe(true);
    expect(cols.find((c) => c.name === 'id')?.isTenantScope).toBe(false);
  });
});

describe('generateShadows — privacy-safe, cross-tenant, deterministic', () => {
  const seed = generateShadows(ORDERS);

  it('produces primary + neighbour tenant rows', () => {
    const tenants = new Set(seed.rows.map((r) => r.tenant_id));
    expect(tenants.size).toBe(2);
    expect(tenants.has(seed.tenants.primary)).toBe(true);
    expect(tenants.has(seed.tenants.neighbour)).toBe(true);
  });

  it('the cross-tenant probe: neighbour rows are clearly a different tenant', () => {
    const primaryRows = seed.rows.filter((r) => r.tenant_id === seed.tenants.primary);
    const neighbourRows = seed.rows.filter((r) => r.tenant_id === seed.tenants.neighbour);
    expect(primaryRows.length).toBe(3);
    expect(neighbourRows.length).toBe(2);
  });

  it('is deterministic (no randomness / no PII)', () => {
    expect(generateShadows(ORDERS)).toEqual(seed);
    // synthetic values are obviously fake
    for (const r of seed.rows) expect(String(r.id)).toMatch(/^00000000-/);
  });

  it('spans boundary values (min/max) for typed columns', () => {
    const totals = seed.rows.map((r) => r.total as number);
    expect(Math.min(...totals)).toBe(0);          // min edge
    expect(totals.some((t) => t > 1_000_000)).toBe(true); // max edge
  });
});

describe('fidelityScore — caps the confidence tier', () => {
  const cols = parseColumns(ORDERS);

  it('a representative seed (cross-tenant + boundaries + multi-row) scores 100', () => {
    const f = fidelityScore(generateShadows(ORDERS), cols);
    expect(f.score).toBe(100);
    expect(f.dimensions).toEqual({ crossTenant: true, boundaryValues: true, multiRow: true });
  });

  it('a single-tenant, single-row fork scores low (cannot justify a pr tier)', () => {
    const thin = generateShadows(ORDERS, { primaryRows: 1, neighbourRows: 0 });
    const f = fidelityScore(thin, cols);
    expect(f.dimensions.crossTenant).toBe(false);
    expect(f.dimensions.multiRow).toBe(false);
    expect(f.score).toBeLessThan(50);
  });
});
