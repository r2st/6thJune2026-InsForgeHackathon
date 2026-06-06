import { describe, it, expect } from 'vitest';
import { validateTomlPatch, tableSchemaFromToml } from './tomlValidate.js';
import type { TomlPatch, TableSchema } from './types.js';

const TOML_CONTEXT = `[tables.orders]
columns = [
  "id uuid pk default gen_random_uuid()",
  "tenant_id uuid not null references tenants(id)",
  "user_id uuid not null",
  "total numeric(10,2) not null",
  "created_at timestamptz not null default now()",
]
rls = "tenant_id = (auth.jwt() ->> 'tenant')::uuid"`;

const SCHEMA: TableSchema = tableSchemaFromToml(TOML_CONTEXT, 'orders');

function patch(after: string, path = 'tables.orders.rls'): TomlPatch {
  return { path, before: "tenant_id = (auth.jwt() ->> 'tenant')::uuid", after };
}

function validate(after: string, path?: string) {
  return validateTomlPatch({ patch: patch(after, path), tomlContext: TOML_CONTEXT, tableSchema: SCHEMA });
}

describe('tableSchemaFromToml', () => {
  it('parses column names and types', () => {
    expect(SCHEMA.columns).toEqual([
      { name: 'id', type: 'uuid' },
      { name: 'tenant_id', type: 'uuid' },
      { name: 'user_id', type: 'uuid' },
      { name: 'total', type: 'numeric' },
      { name: 'created_at', type: 'timestamptz' },
    ]);
  });
});

describe('validateTomlPatch', () => {
  it('accepts the demo bug patch', () => {
    const r = validate(
      "tenant_id = (auth.jwt() ->> 'tenant')::uuid OR tenant_id = ANY(array(select jsonb_array_elements_text(auth.jwt() -> 'tenant_ids'))::uuid[])",
    );
    expect(r.ok).toBe(true);
  });

  it('rejects a column from the wrong table', () => {
    const r = validate("account_id = (auth.jwt() ->> 'tenant')::uuid");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reasons.join(' ')).toMatch(/account_id.*not a column/);
  });

  it('rejects an incompatible cast (uuid::int)', () => {
    const r = validate("tenant_id::int = 5");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reasons.join(' ')).toMatch(/tenant_id::int.*incompatible/);
  });

  it('rejects a fabricated function', () => {
    const r = validate("tenant_id = auth.tenant_id()");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reasons.join(' ')).toMatch(/auth\.tenant_id\(\).*whitelist/);
  });

  it('rejects a widening sub-select with no scoping column', () => {
    const r = validate("tenant_id IN (SELECT id FROM tenants)");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reasons.join(' ')).toMatch(/sub-select does not reference a scoping column/);
  });

  it('accepts a benign sub-select that references a scoping column', () => {
    const r = validate(
      "tenant_id IN (SELECT tenant_id FROM orders WHERE tenant_id = (auth.jwt() ->> 'tenant')::uuid)",
    );
    expect(r.ok).toBe(true);
  });

  it('rejects a path that does not resolve to an existing key', () => {
    const r = validate("tenant_id = (auth.jwt() ->> 'tenant')::uuid", 'tables.orders.rls.read');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reasons.join(' ')).toMatch(/does not resolve/);
  });
});
