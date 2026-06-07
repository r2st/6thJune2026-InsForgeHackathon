// functions/oracle.test.ts
// Acceptance tests for the expectation oracle (ticket 0078).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import { assessExpectation } from './oracle.js';

describe('assessExpectation — the policy counterfactual is near-definitive', () => {
  it('relaxing the policy reveals hidden rows → confident bug, expectedRows set', () => {
    const v = assessExpectation({ counterfactual: { current: 0, relaxed: 3 } });
    expect(v.isLikelyBug).toBe(true);
    expect(v.abstain).toBe(false);
    expect(v.confidence).toBeGreaterThanOrEqual(90);
    expect(v.expectedRows).toBe(3);
    expect(v.reasons[0]).toMatch(/data exists, the policy hid it/);
  });

  it('relaxing the policy reveals NOTHING → correct-empty, not a bug', () => {
    const v = assessExpectation({ counterfactual: { current: 0, relaxed: 0 } });
    expect(v.isLikelyBug).toBe(false);
    expect(v.abstain).toBe(false); // we're confident it's NOT a bug
    expect(v.expectedRows).toBe(0);
    expect(v.reasons[0]).toMatch(/likely correct-empty/);
  });
});

describe('assessExpectation — abstain by default (precision before recall)', () => {
  it('no evidence → abstain, not flagged', () => {
    const v = assessExpectation({});
    expect(v.abstain).toBe(true);
    expect(v.isLikelyBug).toBe(false);
    expect(v.confidence).toBeLessThan(60);
  });

  it('frustration alone is not enough to flag a bug', () => {
    const v = assessExpectation({ frustrationCorroborated: true });
    expect(v.abstain).toBe(true);
    expect(v.isLikelyBug).toBe(false);
  });

  it('a population spike alone stays below the flag threshold', () => {
    const v = assessExpectation({ population: { normalEmptyRate: 0.05, observedEmptyRate: 0.6 } });
    expect(v.confidence).toBeLessThan(60);
    expect(v.abstain).toBe(true);
  });
});

describe('assessExpectation — baseline + corroboration', () => {
  it('a user who used to see rows and now sees 0 → likely bug', () => {
    const v = assessExpectation({ baseline: { previousRows: 3 } });
    expect(v.isLikelyBug).toBe(true);
    expect(v.expectedRows).toBe(3);
    expect(v.confidence).toBeGreaterThanOrEqual(60);
  });

  it('baseline + population spike + frustration stack into high confidence', () => {
    const v = assessExpectation({
      baseline: { previousRows: 5 },
      population: { normalEmptyRate: 0.05, observedEmptyRate: 0.7 },
      frustrationCorroborated: true,
    });
    expect(v.isLikelyBug).toBe(true);
    expect(v.confidence).toBeGreaterThan(90);
    expect(v.expectedRows).toBe(5);
  });

  it('a user with no history (previousRows 0) is not evidence of a bug', () => {
    const v = assessExpectation({ baseline: { previousRows: 0 } });
    expect(v.abstain).toBe(true);
    expect(v.isLikelyBug).toBe(false);
  });
});

describe('assessExpectation — counterfactual overrides a weak baseline', () => {
  it('counterfactual-positive wins even if baseline is unknown', () => {
    const v = assessExpectation({ counterfactual: { current: 0, relaxed: 7 }, baseline: { previousRows: null } });
    expect(v.isLikelyBug).toBe(true);
    expect(v.expectedRows).toBe(7);
  });
});
