// functions/calibration.test.ts
// Acceptance tests for confidence calibration (ticket 0091).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import {
  calibrationReport,
  recalibrate,
  meetsAutonomyBar,
  type CalibrationSample,
} from './calibration.js';

/** Build n samples at a given predicted confidence with a given true correct-rate. */
function samplesAt(predicted: number, correctRate: number, n: number): CalibrationSample[] {
  const correctCount = Math.round(n * correctRate);
  return Array.from({ length: n }, (_, i) => ({ predicted, correct: i < correctCount }));
}

describe('calibrationReport — honest about sample size', () => {
  it('flags small samples as unreliable', () => {
    const r = calibrationReport(samplesAt(90, 0.9, 5));
    expect(r.sampleSize).toBe(5);
    expect(r.reliable).toBe(false);
  });

  it('reliable once past the minimum', () => {
    expect(calibrationReport(samplesAt(90, 0.9, 40)).reliable).toBe(true);
  });
});

describe('calibrationReport — well-calibrated vs over-confident', () => {
  it('a perfectly-calibrated set has ~0 ECE', () => {
    // 90%-predicted are right 90% of the time, 50%-predicted right 50%.
    const r = calibrationReport([...samplesAt(90, 0.9, 50), ...samplesAt(50, 0.5, 50)]);
    expect(r.ece).toBeLessThan(2);
  });

  it('an over-confident model has high ECE (predicts 90, only 50 correct)', () => {
    const r = calibrationReport(samplesAt(90, 0.5, 60));
    // bin mean predicted ~90, observed ~50 → ECE ~40
    expect(r.ece).toBeGreaterThan(30);
    const bin = r.bins.find((b) => b.lo >= 85)!;
    expect(Math.round(bin.observed)).toBe(50);
    expect(Math.round(bin.meanPredicted)).toBe(90);
  });

  it('Brier score is lower (better) for the calibrated set', () => {
    const good = calibrationReport([...samplesAt(90, 0.9, 50), ...samplesAt(10, 0.1, 50)]).brier;
    const bad = calibrationReport([...samplesAt(90, 0.5, 50), ...samplesAt(10, 0.5, 50)]).brier;
    expect(good).toBeLessThan(bad);
  });
});

describe('recalibrate — maps a raw score to observed reality', () => {
  it('pulls an over-confident 90 down toward its observed correct-rate', () => {
    const report = calibrationReport(samplesAt(90, 0.5, 60));
    const cal = recalibrate(90, report);
    expect(cal).toBeLessThanOrEqual(55); // ~50 observed, not 90
  });

  it('passes through unchanged when data is insufficient (no faking)', () => {
    const report = calibrationReport(samplesAt(90, 0.5, 5)); // unreliable
    expect(recalibrate(90, report)).toBe(90);
  });

  it('is monotonic — a higher raw score never recalibrates below a lower one', () => {
    const report = calibrationReport([
      ...samplesAt(30, 0.2, 40),
      ...samplesAt(60, 0.55, 40),
      ...samplesAt(90, 0.92, 40),
    ]);
    expect(recalibrate(90, report)).toBeGreaterThanOrEqual(recalibrate(60, report));
    expect(recalibrate(60, report)).toBeGreaterThanOrEqual(recalibrate(30, report));
  });
});

describe('meetsAutonomyBar — gate auto-PR on demonstrated calibration', () => {
  it('blocks autonomy when high-tier fixes are not actually high-merge', () => {
    const report = calibrationReport(samplesAt(90, 0.6, 60)); // 90%-tier only 60% correct
    expect(meetsAutonomyBar(report)).toBe(false);
  });

  it('allows autonomy when high-tier fixes are empirically high-merge', () => {
    const report = calibrationReport([...samplesAt(92, 0.93, 60), ...samplesAt(50, 0.5, 40)]);
    expect(meetsAutonomyBar(report)).toBe(true);
  });

  it('blocks autonomy with insufficient data regardless', () => {
    expect(meetsAutonomyBar(calibrationReport(samplesAt(95, 1.0, 5)))).toBe(false);
  });
});
