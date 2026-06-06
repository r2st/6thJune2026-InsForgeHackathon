// functions/toml.test.ts
// Acceptance tests for the TOML context extractor (ticket 0019).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { extractTomlContext, sliceTomlContext } from './toml.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEMO = readFileSync(resolve(here, 'fixtures', 'insforge.demo.toml'), 'utf8');

describe('sliceTomlContext — the orders slice (demo grounding)', () => {
  const slice = sliceTomlContext(DEMO, 'orders');

  it('includes the orders table block and its buggy RLS predicate', () => {
    expect(slice).toContain('[tables.orders]');
    expect(slice).toContain("rls = \"tenant_id = (auth.jwt() ->> 'tenant')::uuid\"");
  });

  it('includes every real column so the model cannot invent one', () => {
    for (const col of ['id ', 'tenant_id ', 'user_id ', 'total ', 'created_at ']) {
      expect(slice).toContain(col);
    }
  });

  it('pulls in the FK-referenced tenants table', () => {
    expect(slice).toContain('[tables.tenants]');
  });

  it('does NOT leak unrelated tables (bug_runs)', () => {
    expect(slice).not.toContain('[tables.bug_runs]');
  });
});

describe('sliceTomlContext — FK slices are minimal (id + tenant scoping only)', () => {
  it('tenants FK slice keeps id, drops name/created_at', () => {
    const slice = sliceTomlContext(DEMO, 'orders');
    // isolate the tenants block within the slice
    const tenants = slice.slice(slice.indexOf('[tables.tenants]'));
    expect(tenants).toContain('"id uuid pk');
    expect(tenants).not.toContain('"name text');
    expect(tenants).not.toContain('created_at');
  });

  it('keeps any column mentioning tenant in an FK table', () => {
    const toml = [
      '[tables.orders]',
      'columns = [',
      '  "id uuid pk",',
      '  "tenant_id uuid not null references accounts(id)",',
      ']',
      'rls = "tenant_id = x"',
      '',
      '[tables.accounts]',
      'columns = [',
      '  "id uuid pk",',
      '  "tenant_id uuid not null",',
      '  "label text",',
      ']',
    ].join('\n');
    const accounts = sliceTomlContext(toml, 'orders');
    const acctSlice = accounts.slice(accounts.indexOf('[tables.accounts]'));
    expect(acctSlice).toContain('"id uuid pk"');
    expect(acctSlice).toContain('"tenant_id uuid not null"');
    expect(acctSlice).not.toContain('"label text"');
  });
});

describe('sliceTomlContext — auth.policies referenced by name', () => {
  const toml = [
    '[tables.orders]',
    'columns = [ "id uuid pk", "tenant_id uuid" ]',
    'rls = "current_setting(\'policy.orders_select\') = tenant_id"',
    '',
    '[auth.policies.orders_select]',
    'claim = "tenant"',
    '',
    '[auth.policies.unrelated]',
    'claim = "role"',
  ].join('\n');

  it('includes the policy named in the RLS predicate', () => {
    const slice = sliceTomlContext(toml, 'orders');
    expect(slice).toContain('[auth.policies.orders_select]');
  });

  it('excludes a policy not referenced by the predicate', () => {
    const slice = sliceTomlContext(toml, 'orders');
    expect(slice).not.toContain('[auth.policies.unrelated]');
  });
});

describe('sliceTomlContext — 4kb budget', () => {
  it('drops FK slices before the target when over budget; target always survives', () => {
    // One target with many FK references, each a fat table → forces eviction.
    const fkNames = Array.from({ length: 40 }, (_, i) => `big${i}`);
    const targetCols = [
      'columns = [',
      '  "id uuid pk",',
      ...fkNames.map((n) => `  "${n}_id uuid references ${n}(id)",`),
      ']',
    ].join('\n');
    const fkTables = fkNames
      .map((n) =>
        [
          `[tables.${n}]`,
          'columns = [',
          '  "id uuid pk",',
          `  "${'tenant_padding_'.repeat(8)} text",`, // bulk so the slice is fat
          ']',
        ].join('\n'),
      )
      .join('\n\n');
    const toml = `[tables.orders]\n${targetCols}\nrls = "id = id"\n\n${fkTables}`;

    const slice = sliceTomlContext(toml, 'orders');
    expect(Buffer.byteLength(slice, 'utf8')).toBeLessThanOrEqual(4096);
    expect(slice).toContain('[tables.orders]'); // target never evicted
  });
});

describe('sliceTomlContext — errors', () => {
  it('throws when the target table is absent', () => {
    expect(() => sliceTomlContext(DEMO, 'nonexistent')).toThrow(/table not found/);
  });
});

describe('extractTomlContext — disk loader (applied canonical config)', () => {
  it('reads infra/insforge.toml when no toml is passed', () => {
    // The orchestrator calls this shape; verifies the default source resolves.
    const slice = extractTomlContext({ table: 'orders' });
    expect(slice).toContain('[tables.orders]');
    expect(slice).toContain("(auth.jwt() ->> 'tenant')");
  });
});
