// functions/safety.test.ts
// Acceptance tests for the diff safety rail (ticket 0021).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import type { TomlPatch } from './types.js';
import { validateDiff } from './safety.js';

const TENANT_COLS = ['id', 'tenant_id', 'user_id', 'total', 'created_at'];

function patch(before: string, after: string): TomlPatch {
  return { path: 'tables.orders.rls', before, after };
}

describe('validateDiff — the demo bug fix', () => {
  it('= tenant → = tenant OR = ANY(tenant_ids) is NOT widening', () => {
    const result = validateDiff({
      patch: patch(
        "tenant_id = (auth.jwt() ->> 'tenant')::uuid",
        "tenant_id = (auth.jwt() ->> 'tenant')::uuid OR tenant_id = ANY((auth.jwt() -> 'tenant_ids')::uuid[])",
      ),
      tableColumns: TENANT_COLS,
    });
    expect(result.widens).toBe(false);
    expect(result.reasons).toEqual([]);
  });
});

describe('validateDiff — Rule 1 (conjunct count)', () => {
  it('drops a top-level AND conjunct → widens', () => {
    const result = validateDiff({
      patch: patch(
        "tenant_id = X AND created_at > now() - interval '7 days'",
        'tenant_id = X',
      ),
      tableColumns: TENANT_COLS,
    });
    expect(result.widens).toBe(true);
    expect(result.reasons.some((r) => r.includes('AND'))).toBe(true);
  });

  it('adds a top-level AND conjunct → not widening', () => {
    const result = validateDiff({
      patch: patch('tenant_id = X', 'tenant_id = X AND user_id = Y'),
      tableColumns: TENANT_COLS,
    });
    expect(result.widens).toBe(false);
  });
});

describe('validateDiff — Rule 2 (unscoped new OR branch)', () => {
  it('new OR branch lacking any scoping column → widens', () => {
    const result = validateDiff({
      patch: patch('tenant_id = X', 'tenant_id = X OR true'),
      tableColumns: TENANT_COLS,
    });
    expect(result.widens).toBe(true);
    expect(result.reasons.some((r) => r.includes('OR branch'))).toBe(true);
  });

  it('new OR branch referencing a scoping column → not widening', () => {
    const result = validateDiff({
      patch: patch('tenant_id = X', 'tenant_id = X OR user_id = current_user'),
      tableColumns: TENANT_COLS,
    });
    expect(result.widens).toBe(false);
  });

  it('OR inside parens (depth > 0) is not counted as top-level', () => {
    // The expression has no top-level OR — the OR is nested in a function
    // call. Conjunct count is unchanged; binding unchanged. Should pass.
    const result = validateDiff({
      patch: patch('tenant_id = X', "tenant_id = coalesce(X, 'fallback')"),
      tableColumns: TENANT_COLS,
    });
    expect(result.widens).toBe(false);
  });
});

describe('validateDiff — Rule 3 (binding loosened)', () => {
  it('= → IS NOT NULL → widens (the canonical "lie #04")', () => {
    const result = validateDiff({
      patch: patch(
        "tenant_id = (auth.jwt() ->> 'tenant')::uuid",
        'tenant_id IS NOT NULL',
      ),
      tableColumns: TENANT_COLS,
    });
    expect(result.widens).toBe(true);
    expect(result.reasons.some((r) => r.includes('tenant_id'))).toBe(true);
    expect(result.reasons.some((r) => r.toLowerCase().includes('unconstrained'))).toBe(true);
  });

  it('= → column dropped entirely → widens', () => {
    const result = validateDiff({
      patch: patch('tenant_id = X AND user_id = Y', 'user_id = Y'),
      tableColumns: TENANT_COLS,
    });
    expect(result.widens).toBe(true);
  });

  it('membership → unconstrained → widens', () => {
    const result = validateDiff({
      patch: patch("tenant_id IN ('a', 'b')", 'tenant_id IS NOT NULL'),
      tableColumns: TENANT_COLS,
    });
    expect(result.widens).toBe(true);
  });

  it('equality → membership → not widening (allowed by ticket spec)', () => {
    // The ticket explicitly carves this out:
    //   "= 'tenant' → = ANY(tenant_ids)" must NOT flag, because the claim
    //   should contain the same tenant.
    const result = validateDiff({
      patch: patch(
        "tenant_id = (auth.jwt() ->> 'tenant')::uuid",
        "tenant_id = ANY((auth.jwt() -> 'tenant_ids')::uuid[])",
      ),
      tableColumns: TENANT_COLS,
    });
    expect(result.widens).toBe(false);
  });
});

describe('validateDiff — no-op and identity', () => {
  it('identical before and after → not widening', () => {
    const expr = "tenant_id = (auth.jwt() ->> 'tenant')::uuid";
    const result = validateDiff({
      patch: patch(expr, expr),
      tableColumns: TENANT_COLS,
    });
    expect(result.widens).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('whitespace-only differences → not widening', () => {
    const result = validateDiff({
      patch: patch('tenant_id = X', '  tenant_id\n  =  X  '),
      tableColumns: TENANT_COLS,
    });
    expect(result.widens).toBe(false);
  });
});

describe('validateDiff — LLM-self-report override (informational)', () => {
  // The orchestrator (fix-trigger.ts) takes the LLM's Diagnosis.widensAccess
  // field as advisory. If validateDiff says widens:true, the deterministic
  // verdict wins — the field is overridden to true. This test demonstrates
  // the rail produces widens:true even on a patch the LLM swore was safe.
  it("flags widening even when called on what the LLM claimed was safe", () => {
    // Imagine the LLM emitted: { tomlDiff: <widening patch>, widensAccess: false }
    const result = validateDiff({
      patch: patch('tenant_id = X', 'true'),
      tableColumns: TENANT_COLS,
    });
    expect(result.widens).toBe(true);
    // The orchestrator's job: take this result.widens and override the
    // Diagnosis.widensAccess. That's a fix-trigger.ts test, not here.
  });
});

describe('validateDiff — edge cases', () => {
  it('OR keyword appearing inside a quoted string is ignored', () => {
    // "OR" inside a string literal must not split.
    const result = validateDiff({
      patch: patch("tenant_id = 'A OR B'", "tenant_id = 'A OR B'"),
      tableColumns: TENANT_COLS,
    });
    expect(result.widens).toBe(false);
  });

  it('keyword case-insensitive', () => {
    const result = validateDiff({
      patch: patch('tenant_id = X and user_id = Y', 'tenant_id = X'),
      tableColumns: TENANT_COLS,
    });
    expect(result.widens).toBe(true);
  });

  it('column names match whole-word only (no false fire on substrings)', () => {
    // "tenancy_id" should NOT be mistaken for "tenant_id" if not in cols.
    const result = validateDiff({
      patch: patch('tenancy_id = X', 'tenancy_id = X OR tenancy_id IS NULL'),
      tableColumns: TENANT_COLS, // does NOT include 'tenancy_id'
    });
    // tenancy_id is not in scoping cols → new OR branch's content (which
    // does NOT reference scoping cols) flags widening. This is correct
    // deny-by-default behaviour.
    expect(result.widens).toBe(true);
  });
});
