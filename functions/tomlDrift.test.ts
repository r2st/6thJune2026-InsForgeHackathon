// functions/tomlDrift.test.ts
// Acceptance tests for config-drift detection (ticket 0090).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import { diffToml, summarizeDrift } from './tomlDrift.js';

const ORDERS = (rls: string, cols = '"id uuid pk", "tenant_id uuid", "total numeric"') => `
[tables.orders]
columns = [ ${cols} ]
rls = "${rls}"
`;

const OLD_RLS = "tenant_id = (auth.jwt() ->> 'tenant')::uuid";
const HOTFIX_RLS = "tenant_id = (auth.jwt() ->> 'tenant')::uuid OR true"; // a bad dashboard hotfix

describe('diffToml — no drift', () => {
  it('identical configs → not drifted', () => {
    const t = ORDERS(OLD_RLS);
    expect(diffToml(t, t)).toEqual({ drifted: false, changes: [] });
  });

  it('cosmetic differences (comments / whitespace) are not drift', () => {
    const applied = `[tables.orders]\ncolumns = [ "id uuid pk" ]\nrls = "${OLD_RLS}"`;
    const repo = `[tables.orders]\n# the orders table\ncolumns = [\n  "id uuid pk"\n]\nrls = "${OLD_RLS}"  # tenant scope`;
    expect(diffToml(applied, repo).drifted).toBe(false);
  });
});

describe('diffToml — the dangerous case: live RLS drifted from repo', () => {
  const drift = diffToml(ORDERS(HOTFIX_RLS), ORDERS(OLD_RLS));

  it('detects the changed RLS predicate', () => {
    expect(drift.drifted).toBe(true);
    expect(drift.changes).toHaveLength(1);
    const c = drift.changes[0]!;
    expect(c.block).toBe('[tables.orders]');
    expect(c.kind).toBe('changed');
    expect(c.fields).toEqual([{ field: 'rls', applied: HOTFIX_RLS, repo: OLD_RLS }]);
  });

  it('summary tells reviewers the patch grounds on live', () => {
    expect(summarizeDrift(drift)[0]).toMatch(/live and repo differ \(rls\).*grounded on live/);
  });
});

describe('diffToml — added / removed blocks', () => {
  it('a table present live but not in repo → added', () => {
    const applied = ORDERS(OLD_RLS) + '\n[tables.audit]\ncolumns = [ "id uuid pk" ]\n';
    const repo = ORDERS(OLD_RLS);
    const d = diffToml(applied, repo);
    expect(d.changes).toContainEqual({ block: '[tables.audit]', kind: 'added' });
  });

  it('a table in repo but dropped live → removed', () => {
    const applied = ORDERS(OLD_RLS);
    const repo = ORDERS(OLD_RLS) + '\n[tables.legacy]\ncolumns = [ "id uuid pk" ]\n';
    const d = diffToml(applied, repo);
    expect(d.changes).toContainEqual({ block: '[tables.legacy]', kind: 'removed' });
  });
});

describe('diffToml — column drift', () => {
  it('detects a column added live (a dashboard schema change)', () => {
    const applied = ORDERS(OLD_RLS, '"id uuid pk", "tenant_id uuid", "total numeric", "currency text"');
    const repo = ORDERS(OLD_RLS);
    const d = diffToml(applied, repo);
    const c = d.changes[0]!;
    expect(c.kind).toBe('changed');
    expect(c.fields?.some((f) => f.field === 'columns')).toBe(true);
  });
});

describe('diffToml — only compares tables and auth.policies', () => {
  it('ignores storage / realtime / functions blocks', () => {
    const applied = '[storage.buckets.clips]\nttl_seconds = 3600\n';
    const repo = '[storage.buckets.clips]\nttl_seconds = 7200\n';
    expect(diffToml(applied, repo).drifted).toBe(false);
  });

  it('does compare auth.policies blocks', () => {
    const applied = '[auth.policies.tenant_scope]\nclaim = "tenant"\n';
    const repo = '[auth.policies.tenant_scope]\nclaim = "tenant_ids"\n';
    expect(diffToml(applied, repo).drifted).toBe(true);
  });
});
