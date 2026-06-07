// functions/bugTaxonomy.test.ts
// Acceptance tests for bug classification + scope gating (ticket 0062).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import {
  assessBug,
  classifyBug,
  scopeFor,
  type BugSignals,
} from './bugTaxonomy.js';

const sig = (over: Partial<BugSignals> = {}): BugSignals => ({
  rowsBefore: 5, rowsAfter: 0, status: 200, hasNamedPolicy: true,
  jwtClaimMissing: false, crossTenantRowsSeen: false, involvesJoin: false, authConfigDrift: false, ...over,
});

describe('classifyBug — derive the class from generalized signals', () => {
  it('the demo case: named policy hid existing rows → rls_filter_misfire', () => {
    expect(classifyBug(sig()).bugClass).toBe('rls_filter_misfire');
  });

  it('a missing/renamed JWT claim → stale_jwt_claim', () => {
    expect(classifyBug(sig({ jwtClaimMissing: true })).bugClass).toBe('stale_jwt_claim');
  });

  it('a join-path policy drop → policy_regression_join', () => {
    expect(classifyBug(sig({ involvesJoin: true })).bugClass).toBe('policy_regression_join');
  });

  it('cross-tenant rows visible → over_permissive_leak (checked first, dominates)', () => {
    // even with a join flag, a leak is the classification
    expect(classifyBug(sig({ crossTenantRowsSeen: true, involvesJoin: true })).bugClass).toBe('over_permissive_leak');
  });

  it('post-RLS count exceeding pre-RLS is also a leak', () => {
    expect(classifyBug(sig({ rowsBefore: 2, rowsAfter: 9, status: 200 })).bugClass).toBe('over_permissive_leak');
  });

  it('auth-config drift is structural, not a row bug', () => {
    expect(classifyBug(sig({ authConfigDrift: true })).bugClass).toBe('auth_config_drift');
  });

  it('rows hidden but no named policy → over_restrictive_policy', () => {
    expect(classifyBug(sig({ hasNamedPolicy: false })).bugClass).toBe('over_restrictive_policy');
  });

  it('no vanished rows and no other evidence → unknown (escalate)', () => {
    expect(classifyBug(sig({ rowsBefore: 3, rowsAfter: 3 })).bugClass).toBe('unknown');
  });
});

describe('scopeFor — deny-by-default, proven-safe set only auto-fixes', () => {
  it('filter misfire and stale claim are auto-fixable to PR', () => {
    expect(scopeFor('rls_filter_misfire', false)).toMatchObject({ ceiling: 'pr', autoFixable: true });
    expect(scopeFor('stale_jwt_claim', false)).toMatchObject({ ceiling: 'pr', autoFixable: true });
  });

  it('softer / widening-risk classes are capped at draft', () => {
    expect(scopeFor('over_restrictive_policy', false).ceiling).toBe('draft_pr');
    expect(scopeFor('policy_regression_join', false).ceiling).toBe('draft_pr');
  });

  it('a leak is never a frustration-triggered auto-PR — issue + human', () => {
    const s = scopeFor('over_permissive_leak', false);
    expect(s.ceiling).toBe('issue');
    expect(s.autoFixable).toBe(false);
    expect(s.reason).toMatch(/canary/);
  });

  it('auth-config drift and unknown are escalated to issue', () => {
    expect(scopeFor('auth_config_drift', false).autoFixable).toBe(false);
    expect(scopeFor('unknown', false).autoFixable).toBe(false);
  });

  it('if the oracle abstained, even the safe classes are capped to issue', () => {
    const s = scopeFor('rls_filter_misfire', true);
    expect(s.ceiling).toBe('issue');
    expect(s.autoFixable).toBe(false);
    expect(s.reason).toMatch(/oracle abstained/);
  });
});

describe('assessBug — classify + scope together', () => {
  it('the demo bug is classified and scoped to a PR', () => {
    const { classification, scope } = assessBug(sig(), false);
    expect(classification.bugClass).toBe('rls_filter_misfire');
    expect(scope.ceiling).toBe('pr');
  });

  it('a leak is classified and firmly routed away from an auto-fix', () => {
    const { classification, scope } = assessBug(sig({ crossTenantRowsSeen: true }), false);
    expect(classification.bugClass).toBe('over_permissive_leak');
    expect(scope.autoFixable).toBe(false);
  });
});
