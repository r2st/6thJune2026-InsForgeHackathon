// functions/outcome.test.ts
// Acceptance tests for outcome measurement — impact, significance, ROI (ticket 0071).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import {
  isCalibrationMiss,
  measureImpact,
  twoProportionZ,
  workspaceRoi,
  type FixOutcome,
  type ImpactResult,
  type SignalWindow,
} from './outcome.js';

const w = (count: number, total: number): SignalWindow => ({ count, total });

describe('measureImpact — honest, significance-gated verdict', () => {
  it('a large, significant drop is "improved"', () => {
    const r = measureImpact(w(50, 100), w(10, 100));
    expect(r.verdict).toBe('improved');
    expect(r.significant).toBe(true);
    expect(r.relativeReduction).toBeCloseTo(0.8);
    expect(r.reason).toMatch(/fell 80%/);
  });

  it('a tiny, non-significant wobble is "no_change"', () => {
    const r = measureImpact(w(50, 100), w(48, 100));
    expect(r.verdict).toBe('no_change');
    expect(r.significant).toBe(false);
  });

  it('a significant RISE is "worsened"', () => {
    const r = measureImpact(w(10, 100), w(40, 100));
    expect(r.verdict).toBe('worsened');
    expect(r.significant).toBe(true);
  });

  it('too little traffic is "inconclusive" — never a fabricated number', () => {
    const r = measureImpact(w(5, 10), w(2, 10));
    expect(r.verdict).toBe('inconclusive');
    expect(r.z).toBeNull();
    expect(r.reason).toMatch(/too little traffic/);
  });

  it('inconclusive triggers when only ONE window is thin', () => {
    expect(measureImpact(w(50, 100), w(1, 5)).verdict).toBe('inconclusive');
    expect(measureImpact(w(1, 5), w(50, 100)).verdict).toBe('inconclusive');
  });
});

describe('twoProportionZ — the underlying statistic', () => {
  it('positive when the before-rate is higher (an improvement)', () => {
    expect(twoProportionZ(w(50, 100), w(10, 100))).toBeGreaterThan(1.96);
  });
  it('zero when a window has no observations', () => {
    expect(twoProportionZ(w(0, 0), w(10, 100))).toBe(0);
  });
  it('zero when there is no variance (both rates identical extremes)', () => {
    expect(twoProportionZ(w(0, 100), w(0, 100))).toBe(0);
    expect(twoProportionZ(w(100, 100), w(100, 100))).toBe(0);
  });
});

describe('isCalibrationMiss — a sure fix that did nothing is a learning signal', () => {
  const improved: ImpactResult = measureImpact(w(50, 100), w(10, 100));
  const noChange: ImpactResult = measureImpact(w(50, 100), w(48, 100));
  const inconclusive: ImpactResult = measureImpact(w(5, 10), w(2, 10));

  it('high confidence + no measurable impact → calibration miss', () => {
    expect(isCalibrationMiss(90, noChange)).toBe(true);
  });
  it('high confidence + proven improvement → not a miss', () => {
    expect(isCalibrationMiss(90, improved)).toBe(false);
  });
  it('low confidence + no impact → not flagged (model was not sure)', () => {
    expect(isCalibrationMiss(50, noChange)).toBe(false);
  });
  it('inconclusive is never a calibration miss', () => {
    expect(isCalibrationMiss(95, inconclusive)).toBe(false);
  });
});

describe('workspaceRoi — only proven impact counts toward ROI', () => {
  const fix = (over: Partial<FixOutcome>): FixOutcome => ({
    runId: 'r', shipped: true, baselineSignalCount: 50,
    impact: measureImpact(w(50, 100), w(10, 100)), ...over,
  });

  it('sums frustration averted from significantly-improved fixes only', () => {
    const roi = workspaceRoi([
      fix({ runId: 'a' }),                                              // improved, baseline 50, reduction 0.8 → 40
      fix({ runId: 'b', impact: measureImpact(w(50, 100), w(48, 100)) }), // no_change → 0
      fix({ runId: 'c', impact: measureImpact(w(5, 10), w(2, 10)) }),     // inconclusive → 0
    ]);
    expect(roi.bugsCaught).toBe(3);
    expect(roi.fixesShipped).toBe(3);
    expect(roi.fixesWithProvenImpact).toBe(1);
    expect(roi.frustrationAverted).toBe(40);
    expect(roi.supportTicketsLikelyAvoided).toBe(4); // 10% escalation
    expect(roi.inconclusive).toBe(1);
  });

  it('an unshipped or worsened fix never contributes ROI', () => {
    const roi = workspaceRoi([
      fix({ shipped: false }),
      fix({ impact: measureImpact(w(10, 100), w(40, 100)) }), // worsened
    ]);
    expect(roi.fixesWithProvenImpact).toBe(0);
    expect(roi.frustrationAverted).toBe(0);
  });

  it('an empty workspace rolls up to all zeros', () => {
    expect(workspaceRoi([])).toMatchObject({ bugsCaught: 0, fixesShipped: 0, frustrationAverted: 0 });
  });
});
