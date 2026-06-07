// functions/canaryProbes.test.ts
// Acceptance tests for canary policy probes — leak detection + dispatch (ticket 0088).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import {
  confirmLeakFix,
  evaluateProbe,
  leakDispatchTier,
  leakSeverity,
  type ProbeObservation,
  type ProbeResult,
  type ProbeSpec,
} from './canaryProbes.js';

const spec = (over: Partial<ProbeSpec> = {}): ProbeSpec => ({
  id: 'p1', kind: 'neighbor_read', route: '/orders', policy: 'orders.orders_select', policyBlast: 1,
  principal: { tenantId: 'canary-a', claim: 'tenant', ownedIds: ['a1', 'a2'] }, ...over,
});

const obs = (over: Partial<ProbeObservation> = {}): ProbeObservation => ({
  observedIds: ['a1', 'a2'], status: 200, ...over,
});

describe('evaluateProbe — cross-tenant evidence is required', () => {
  it('canary seeing only its own ids → no leak, boundary holds', () => {
    const r = evaluateProbe(spec(), obs({ observedIds: ['a1', 'a2'] }));
    expect(r.leak).toBe(false);
    expect(r.severity).toBe('none');
  });

  it('canary seeing a foreign id → leak with that id as evidence', () => {
    const r = evaluateProbe(spec(), obs({ observedIds: ['a1', 'a2', 'b9'] }));
    expect(r.leak).toBe(true);
    expect(r.foreignIds).toEqual(['b9']);
    expect(r.reason).toMatch(/cross-tenant leak/);
  });

  it('a 403 denial is the policy working — not a leak', () => {
    const r = evaluateProbe(spec(), obs({ status: 403, observedIds: [] }));
    expect(r.leak).toBe(false);
    expect(r.reason).toMatch(/denied as expected/);
  });

  it('a count endpoint exceeding the canary’s own count leaks existence even without ids', () => {
    const r = evaluateProbe(spec({ kind: 'count' }), obs({ observedIds: [], observedCount: 50 }));
    expect(r.leak).toBe(true);
    expect(r.reason).toMatch(/count leak/);
  });

  it('a count endpoint reporting exactly the owned count is fine', () => {
    const r = evaluateProbe(spec({ kind: 'count' }), obs({ observedIds: [], observedCount: 2 }));
    expect(r.leak).toBe(false);
  });
});

describe('leakSeverity — scales with leaked volume, surface, and blast', () => {
  it('a single neighbor-read leak on a narrow policy is low', () => {
    expect(leakSeverity(1, 1, 'neighbor_read')).toBe('low');
  });
  it('many leaked rows escalate', () => {
    expect(leakSeverity(10, 1, 'neighbor_read')).toBe('high');
    expect(leakSeverity(100, 1, 'neighbor_read')).toBe('critical');
  });
  it('a single leaked object URL or join is weighted up', () => {
    expect(leakSeverity(1, 1, 'object_url')).toBe('medium');
    expect(leakSeverity(1, 1, 'join')).toBe('medium');
  });
  it('a wide policy blast raises severity a notch', () => {
    expect(leakSeverity(1, 5, 'neighbor_read')).toBe('medium');
  });
});

describe('confirmLeakFix — prod vs fork differential', () => {
  const leaky = (foreign: string[]): ProbeResult => ({
    probeId: 'p1', leak: foreign.length > 0, foreignIds: foreign,
    severity: foreign.length ? 'low' : 'none', reason: '',
  });

  it('prod leaks and fork does not → fix closes', () => {
    const d = confirmLeakFix(leaky(['b9']), leaky([]));
    expect(d.fixCloses).toBe(true);
    expect(d.widens).toBe(false);
  });

  it('fork leaks MORE than prod → widens (hard block)', () => {
    const d = confirmLeakFix(leaky(['b9']), leaky(['b9', 'c3']));
    expect(d.widens).toBe(true);
  });

  it('fork newly leaks where prod did not → widens', () => {
    const d = confirmLeakFix(leaky([]), leaky(['c3']));
    expect(d.widens).toBe(true);
  });
});

describe('leakDispatchTier — conservative by default', () => {
  const res = (over: Partial<ProbeResult>): ProbeResult => ({
    probeId: 'p1', leak: true, foreignIds: ['b9'], severity: 'low', reason: '', ...over,
  });

  it('a widening fix is blocked to human review', () => {
    const diff = confirmLeakFix(res({}), res({ foreignIds: ['b9', 'c3'] }));
    expect(leakDispatchTier(diff, spec()).tier).toBe('human_review');
  });

  it('a tiny-blast, low-severity, confirmed-closed leak can auto-PR', () => {
    const diff = confirmLeakFix(res({ severity: 'low' }), res({ leak: false, foreignIds: [], severity: 'none' }));
    expect(leakDispatchTier(diff, spec({ policyBlast: 1 })).tier).toBe('pr');
  });

  it('a high/critical leak always goes to human review even if closed', () => {
    const diff = confirmLeakFix(res({ severity: 'high' }), res({ leak: false, foreignIds: [], severity: 'none' }));
    expect(leakDispatchTier(diff, spec({ policyBlast: 1 })).tier).toBe('human_review');
  });

  it('a closed leak on a wider policy goes to draft PR, not auto-PR', () => {
    const diff = confirmLeakFix(res({ severity: 'low' }), res({ leak: false, foreignIds: [], severity: 'none' }));
    expect(leakDispatchTier(diff, spec({ policyBlast: 4 })).tier).toBe('draft_pr');
  });

  it('a leak the fork did not close → no dispatch', () => {
    const diff = confirmLeakFix(res({}), res({})); // still leaks on fork
    expect(leakDispatchTier(diff, spec()).tier).toBe('none');
  });
});
