import { describe, it, expect } from 'vitest';
import { applyTomlDiff } from './applyDiff.js';
import type { TomlPatch } from './types.js';

const TOML = `[tables.orders]
rls = "tenant_id = (auth.jwt() ->> 'tenant')::uuid"
`;

const DIFF: TomlPatch = {
  path: 'tables.orders.rls',
  before: "tenant_id = (auth.jwt() ->> 'tenant')::uuid",
  after: "tenant_id = (auth.jwt() ->> 'tenant')::uuid OR tenant_id = ANY((auth.jwt() -> 'tenant_ids')::uuid[])",
};

describe('applyTomlDiff', () => {
  it('patches then applies, returning the new version', async () => {
    let applied = '';
    const r = await applyTomlDiff('hush-fork-0', DIFF, {
      loadToml: () => TOML,
      runApply: async (_id, patched) => {
        applied = patched;
        return { ok: true, version: 'v42' };
      },
    });
    expect(r).toEqual({ ok: true, version: 'v42', changed: true });
    expect(applied).toContain(DIFF.after);
  });

  it('returns a lint error without applying when the patch does not match', async () => {
    let calls = 0;
    const r = await applyTomlDiff('hush-fork-0', { ...DIFF, before: 'wrong' }, {
      loadToml: () => TOML,
      runApply: async () => {
        calls++;
        return { ok: true, version: 'v1' };
      },
    });
    expect(r.ok).toBe(false);
    expect(calls).toBe(0); // never reached the CLI
  });

  it('surfaces the CLI lint error on apply failure', async () => {
    const r = await applyTomlDiff('hush-fork-0', DIFF, {
      loadToml: () => TOML,
      runApply: async () => ({ ok: false, lintError: 'insforge.toml:2 invalid predicate' }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.lintError).toMatch(/insforge\.toml:2/);
  });

  it('is idempotent — re-applying reports changed=false but still succeeds', async () => {
    const r = await applyTomlDiff('hush-fork-0', DIFF, {
      loadToml: () => TOML.replace(DIFF.before, DIFF.after),
      runApply: async () => ({ ok: true, version: 'v42' }),
    });
    expect(r).toEqual({ ok: true, version: 'v42', changed: false });
  });
});
