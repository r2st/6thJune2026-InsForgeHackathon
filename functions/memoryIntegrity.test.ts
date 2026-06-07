// functions/memoryIntegrity.test.ts
// Acceptance tests for feedback/Memoir integrity (ticket 0092).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import {
  trustWeight,
  recencyWeight,
  effectiveWeight,
  integritySignal,
  sourceDominance,
  type IntegrityRecord,
} from './memoryIntegrity.js';

const NOW = Date.parse('2026-06-06T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function rec(over: Partial<IntegrityRecord>): IntegrityRecord {
  return { sign: 1, provenance: 'human_review', at: daysAgo(0), source: 's1', ...over };
}

describe('trust + recency weighting', () => {
  it('human review outranks an unverified signal', () => {
    expect(trustWeight('human_review')).toBeGreaterThan(trustWeight('unverified'));
  });
  it('recency halves at one half-life', () => {
    expect(recencyWeight(daysAgo(90), NOW, 90)).toBeCloseTo(0.5, 2);
    expect(recencyWeight(daysAgo(0), NOW, 90)).toBeCloseTo(1, 5);
  });
  it('effective weight combines trust × recency', () => {
    expect(effectiveWeight(rec({ provenance: 'human_review', at: daysAgo(90) }), NOW, 90)).toBeCloseTo(0.5, 2);
    expect(effectiveWeight(rec({ provenance: 'unverified', at: daysAgo(0) }), NOW, 90)).toBeCloseTo(0.2, 2);
  });
});

describe('integritySignal — outlier resistance & corroboration', () => {
  it('a lone unverified reject is NOT confident (needs corroboration)', () => {
    const s = integritySignal([rec({ sign: -1, provenance: 'unverified' })], NOW);
    expect(s.confident).toBe(false);
  });

  it('two trusted agreeing records → confident', () => {
    const s = integritySignal(
      [rec({ sign: 1, provenance: 'human_review', source: 'a' }), rec({ sign: 1, provenance: 'merge', source: 'b' })],
      NOW,
    );
    expect(s.confident).toBe(true);
    expect(s.net).toBeGreaterThan(0.5);
  });

  it("a single reject can't tank an established positive pattern", () => {
    const established = Array.from({ length: 6 }, (_, i) =>
      rec({ sign: 1, provenance: 'merge', source: `m${i}`, at: daysAgo(i) }),
    );
    const withOutlier = integritySignal([...established, rec({ sign: -1, provenance: 'unverified', source: 'x' })], NOW);
    expect(withOutlier.net).toBeGreaterThan(0.5); // pattern survives the lone reject
  });

  it('empty history → inconclusive (net 0, not confident)', () => {
    expect(integritySignal([], NOW)).toMatchObject({ net: 0, confident: false });
  });

  it('stale records lose influence vs fresh ones', () => {
    const fresh = integritySignal([rec({ sign: 1, at: daysAgo(0) }), rec({ sign: 1, at: daysAgo(0), source: 's2' })], NOW);
    const stale = integritySignal([rec({ sign: 1, at: daysAgo(400) }), rec({ sign: 1, at: daysAgo(400), source: 's2' })], NOW);
    expect(fresh.support).toBeGreaterThan(stale.support);
  });
});

describe('sourceDominance — anti-poisoning', () => {
  it('flags when one source dominates recent volume', () => {
    const recs = [
      ...Array.from({ length: 8 }, () => rec({ source: 'attacker', provenance: 'unverified' })),
      rec({ source: 'real', provenance: 'human_review' }),
    ];
    const d = sourceDominance(recs, NOW);
    expect(d.dominated).toBe(true);
    expect(d.topSource).toBe('attacker');
    expect(d.share).toBeGreaterThan(0.5);
  });

  it('balanced sources are not flagged', () => {
    const recs = ['a', 'b', 'c', 'd'].map((s) => rec({ source: s }));
    expect(sourceDominance(recs, NOW).dominated).toBe(false);
  });

  it('a single source with no alternative is not "domination" (nothing to compare)', () => {
    const recs = [rec({ source: 'only' }), rec({ source: 'only' })];
    expect(sourceDominance(recs, NOW).dominated).toBe(false);
  });
});
