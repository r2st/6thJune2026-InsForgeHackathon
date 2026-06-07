// functions/reviewGate.test.ts
// Acceptance tests for the human-in-the-loop review gate + feedback (ticket 0068).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import {
  canShipAfterReview,
  decisionToLearning,
  DEFAULT_AUTONOMY,
  requiresReview,
  type ReviewDecision,
} from './reviewGate.js';

describe('default autonomy — review first', () => {
  it('a new workspace reviews everything', () => {
    expect(DEFAULT_AUTONOMY).toBe('review-all');
  });
});

describe('requiresReview — graduated trust, monotonic', () => {
  it('review-all gates both high and medium', () => {
    expect(requiresReview('review-all', 'pr')).toBe(true);
    expect(requiresReview('review-all', 'draft_pr')).toBe(true);
  });

  it('review-medium-only auto-ships high, reviews medium', () => {
    expect(requiresReview('review-medium-only', 'pr')).toBe(false);
    expect(requiresReview('review-medium-only', 'draft_pr')).toBe(true);
  });

  it('auto-PR-high gates nothing actionable', () => {
    expect(requiresReview('auto-PR-high', 'pr')).toBe(false);
    expect(requiresReview('auto-PR-high', 'draft_pr')).toBe(false);
  });

  it('an issue is never gated in any mode (not a code write)', () => {
    for (const a of ['review-all', 'review-medium-only', 'auto-PR-high'] as const) {
      expect(requiresReview(a, 'issue')).toBe(false);
    }
  });

  it('autonomy is monotonic — more autonomy never adds a review for the same tier', () => {
    const order = ['review-all', 'review-medium-only', 'auto-PR-high'] as const;
    for (const tier of ['pr', 'draft_pr'] as const) {
      const flags = order.map((a) => requiresReview(a, tier));
      // once false, never true again as autonomy increases
      const firstFalse = flags.indexOf(false);
      if (firstFalse !== -1) expect(flags.slice(firstFalse).every((f) => f === false)).toBe(true);
    }
  });
});

describe('decisionToLearning — feedback maps to a Memoir signal', () => {
  it('approve raises confidence and ships without re-validation', () => {
    const s = decisionToLearning({ kind: 'approve' });
    expect(s.polarity).toBe('raise');
    expect(s.confidenceDelta).toBeGreaterThan(0);
    expect(s.needsRevalidation).toBe(false);
    expect(s.shipApproved).toBe(true);
  });

  it('edit is mildly positive but demands re-validation', () => {
    const s = decisionToLearning({ kind: 'edit', edited: true });
    expect(s.confidenceDelta).toBeGreaterThan(0);
    expect(s.confidenceDelta).toBeLessThan(decisionToLearning({ kind: 'approve' }).confidenceDelta);
    expect(s.needsRevalidation).toBe(true);
    expect(s.shipApproved).toBe(true);
  });

  it('reject (not a bug) lowers confidence hardest — the precision signal', () => {
    const s = decisionToLearning({ kind: 'reject', rejectCategory: 'not_a_bug' });
    expect(s.polarity).toBe('lower');
    expect(s.shipApproved).toBe(false);
    expect(s.confidenceDelta).toBeLessThan(decisionToLearning({ kind: 'reject', rejectCategory: 'wrong_fix' }).confidenceDelta);
  });

  it('reject (out of scope) is near-neutral — a preference, not a quality miss', () => {
    const s = decisionToLearning({ kind: 'reject', rejectCategory: 'out_of_scope' });
    expect(s.polarity).toBe('neutral');
    expect(Math.abs(s.confidenceDelta)).toBeLessThanOrEqual(2);
    expect(s.shipApproved).toBe(false);
  });

  it('a reject with no category defaults to wrong_fix', () => {
    expect(decisionToLearning({ kind: 'reject' }).polarity).toBe('lower');
  });
});

describe('canShipAfterReview — pulls the gates together', () => {
  const edit: ReviewDecision = { kind: 'edit', edited: true };

  it('approve ships immediately', () => {
    expect(canShipAfterReview({ kind: 'approve' }, false).ship).toBe(true);
  });

  it('an edited diff cannot ship until re-validated', () => {
    expect(canShipAfterReview(edit, false).ship).toBe(false);
    expect(canShipAfterReview(edit, true).ship).toBe(true);
  });

  it('a rejected run never ships', () => {
    expect(canShipAfterReview({ kind: 'reject', rejectCategory: 'not_a_bug' }, true).ship).toBe(false);
  });
});
