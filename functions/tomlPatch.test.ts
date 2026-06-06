import { describe, it, expect } from 'vitest';
import { applyPatch } from './tomlPatch.js';
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
  after: "tenant_id = (auth.jwt() ->> 'tenant')::uuid OR tenant_id = ANY(array(select jsonb_array_elements_text(auth.jwt() -> 'tenant_ids'))::uuid[])",
};

describe('applyPatch', () => {
  it('replaces the targeted scalar and preserves surrounding lines', () => {
    const r = applyPatch(TOML, PATCH);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(true);
    expect(r.toml).toContain(`rls = "${PATCH.after}"`);
    expect(r.toml).toContain('[tables.tenants]'); // untouched
    expect(r.toml).toContain('"id uuid pk"');
  });

  it('is idempotent — re-applying a satisfied patch is a no-op success', () => {
    const once = applyPatch(TOML, PATCH);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = applyPatch(once.toml, PATCH);
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    expect(twice.changed).toBe(false);
    expect(twice.toml).toBe(once.toml);
  });

  it('refuses to clobber when the current value matches neither before nor after', () => {
    const tampered = TOML.replace(PATCH.before, 'something_else = 1');
    const r = applyPatch(tampered, PATCH);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/refusing to clobber/);
    expect(r.error).toMatch(/orders\]\.rls:6/); // file:line
  });

  it('errors when the section is missing', () => {
    const r = applyPatch('[tables.tenants]\ncolumns = []\n', PATCH);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/\[tables\.orders\] not found/);
  });

  it('errors when the key is missing from the section', () => {
    const r = applyPatch('[tables.orders]\ncolumns = []\n', PATCH);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/not found/);
  });

  it('rejects a path without a section', () => {
    const r = applyPatch(TOML, { ...PATCH, path: 'rls' });
    expect(r.ok).toBe(false);
  });
});
