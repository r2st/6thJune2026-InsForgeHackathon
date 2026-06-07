// functions/regressionWatch.test.ts
// Acceptance tests for post-fix regression detection & auto-rollback (ticket 0069).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import {
  decideRollback,
  detectRegression,
  frustrationRate,
  isIneffective,
  regressionSeverity,
  type RegressionWindow,
} from './regressionWatch.js';

const win = (over: Partial<RegressionWindow> = {}): RegressionWindow => ({
  policy: 'orders.orders_select', route: '/orders',
  sessionsBefore: 100, sessionsAfter: 100,
  frustrationBefore: 10, frustrationAfter: 10,
  failingShapesBefore: ['get /orders -> 0 rows'],
  failingShapesAfter: ['get /orders -> 0 rows'],
  safetyViolation: false, accessWidened: false, ...over,
});

describe('frustrationRate — guards divide-by-zero', () => {
  it('is signals/sessions, 0 when no sessions', () => {
    expect(frustrationRate(10, 100)).toBeCloseTo(0.1);
    expect(frustrationRate(5, 0)).toBe(0);
  });
});

describe('detectRegression — the four regression kinds', () => {
  it('a steady window with no new shapes is not a regression', () => {
    const f = detectRegression(win());
    expect(f.regressed).toBe(false);
    expect(f.severity).toBe('none');
  });

  it('a >50% rise in per-session frustration is a regression', () => {
    const f = detectRegression(win({ frustrationBefore: 5, frustrationAfter: 20 }));
    expect(f.regressed).toBe(true);
    expect(f.kinds).toContain('frustration_rise');
  });

  it('a small frustration wobble under the threshold is not flagged', () => {
    const f = detectRegression(win({ frustrationBefore: 10, frustrationAfter: 12 }));
    expect(f.regressed).toBe(false);
  });

  it('a tiny post-merge sample cannot establish a frustration rise', () => {
    const f = detectRegression(win({ sessionsAfter: 2, frustrationBefore: 1, frustrationAfter: 2 }));
    expect(f.kinds).not.toContain('frustration_rise');
  });

  it('a new failing request shape that did not exist pre-merge is a regression', () => {
    const f = detectRegression(win({ failingShapesAfter: ['get /orders -> 0 rows', 'get /orders/items -> 500'] }));
    expect(f.regressed).toBe(true);
    expect(f.kinds).toContain('new_failing_shape');
    expect(f.newShapes).toEqual(['get /orders/items -> 500']);
    expect(f.severity).toBe('high');
  });

  it('a safety-rail violation post-merge is a critical regression', () => {
    const f = detectRegression(win({ safetyViolation: true }));
    expect(f.kinds).toContain('safety_violation');
    expect(f.severity).toBe('critical');
  });

  it('access widening from the differential suite is a critical regression', () => {
    const f = detectRegression(win({ accessWidened: true }));
    expect(f.kinds).toContain('access_widened');
    expect(f.severity).toBe('critical');
  });
});

describe('regressionSeverity — security dominates, behavioral scales', () => {
  it('any security regression is critical', () => {
    expect(regressionSeverity(['safety_violation'], 0.1, 0.1)).toBe('critical');
    expect(regressionSeverity(['access_widened', 'frustration_rise'], 0.1, 0.5)).toBe('critical');
  });
  it('a new failing shape is high', () => {
    expect(regressionSeverity(['new_failing_shape'], 0.1, 0.1)).toBe('high');
  });
  it('frustration-only scales with the jump ratio', () => {
    expect(regressionSeverity(['frustration_rise'], 0.1, 0.16)).toBe('low');
    expect(regressionSeverity(['frustration_rise'], 0.1, 0.25)).toBe('medium');
    expect(regressionSeverity(['frustration_rise'], 0.1, 0.4)).toBe('high');
  });
});

describe('decideRollback — honors workspace mode, never sits on a leak', () => {
  it('no regression → no action', () => {
    expect(decideRollback(detectRegression(win()), 'auto_revert').action).toBe('none');
  });

  it('behavioral regression in auto mode → revert PR', () => {
    const f = detectRegression(win({ frustrationBefore: 5, frustrationAfter: 20 }));
    expect(decideRollback(f, 'auto_revert').action).toBe('revert_pr');
  });

  it('behavioral regression in alert-only mode → alert, no auto-revert', () => {
    const f = detectRegression(win({ frustrationBefore: 5, frustrationAfter: 20 }));
    expect(decideRollback(f, 'alert_only').action).toBe('alert');
  });

  it('a security regression in auto mode reverts', () => {
    const f = detectRegression(win({ accessWidened: true }));
    expect(decideRollback(f, 'auto_revert').action).toBe('revert_pr');
  });

  it('a security regression even in alert-only mode drafts a revert — never just an alert', () => {
    const f = detectRegression(win({ safetyViolation: true }));
    const d = decideRollback(f, 'alert_only');
    expect(d.action).toBe('revert_draft');
    expect(d.reason).toMatch(/critical security/);
  });
});

describe('isIneffective — a fix that did not reduce frustration', () => {
  it('frustration unchanged after merge → ineffective (but not a regression)', () => {
    const w = win({ frustrationBefore: 10, frustrationAfter: 10 });
    const f = detectRegression(w);
    expect(f.regressed).toBe(false);
    expect(isIneffective(w, f)).toBe(true);
  });

  it('a clear frustration drop → effective', () => {
    const w = win({ frustrationBefore: 10, frustrationAfter: 2 });
    expect(isIneffective(w, detectRegression(w))).toBe(false);
  });

  it('a regression is never merely "ineffective"', () => {
    const w = win({ safetyViolation: true });
    expect(isIneffective(w, detectRegression(w))).toBe(false);
  });

  it('too small a sample is not judged ineffective', () => {
    const w = win({ sessionsAfter: 3, frustrationBefore: 10, frustrationAfter: 10 });
    expect(isIneffective(w, detectRegression(w))).toBe(false);
  });
});
