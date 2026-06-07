// functions/evalHarness.test.ts
// Acceptance tests for the prompt/model eval harness (ticket 0072).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import {
  pickModels,
  regressionGate,
  scoreCase,
  scoreRun,
  type EvalCase,
  type EvalOutput,
  type ModelProfile,
  type RunIdentity,
} from './evalHarness.js';

const ID: RunIdentity = { promptVersion: 'diagnose-v1.0.0', provider: 'gemini', model: 'gemini-2.5-flash' };

const ecase = (over: Partial<EvalCase> = {}): EvalCase => ({
  id: 'c1', difficulty: 'medium', expectedPolicy: 'orders.orders_select', ...over,
});
const out = (over: Partial<EvalOutput> = {}): EvalOutput => ({
  caseId: 'c1', policy: 'orders.orders_select', diffValidAndSafe: true,
  forkVerdictPass: true, hallucinatedIdentifiers: [], ...over,
});

describe('scoreCase — correctness with hard-fail gates', () => {
  it('right policy + passing fork verdict → perfect score', () => {
    const s = scoreCase(ecase(), out());
    expect(s.score).toBe(1);
    expect(s.hardFail).toBe(false);
  });

  it('wrong policy but passing fork → partial (0.5)', () => {
    const s = scoreCase(ecase(), out({ policy: 'invoices.inv_select' }));
    expect(s.score).toBe(0.5);
    expect(s.policyMatch).toBe(false);
  });

  it('a hallucinated identifier is a hard fail — score 0 regardless of correctness', () => {
    const s = scoreCase(ecase(), out({ hallucinatedIdentifiers: ['orders.tenant_ids_typo'] }));
    expect(s.score).toBe(0);
    expect(s.hardFail).toBe(true);
    expect(s.reason).toMatch(/hallucinated/);
  });

  it('an unsafe/invalid diff is a hard fail even with the right policy', () => {
    const s = scoreCase(ecase(), out({ diffValidAndSafe: false }));
    expect(s.score).toBe(0);
    expect(s.hardFail).toBe(true);
    expect(s.reason).toMatch(/widens access|invalid/);
  });

  it('policy case/whitespace differences still match', () => {
    expect(scoreCase(ecase(), out({ policy: '  Orders.Orders_Select  ' })).policyMatch).toBe(true);
  });
});

describe('scoreRun — aggregate with per-difficulty breakdown', () => {
  const cases = [ecase({ id: 'e', difficulty: 'easy' }), ecase({ id: 'h', difficulty: 'hard' })];

  it('mean, pass-rate, and difficulty buckets', () => {
    const outputs = [out({ caseId: 'e' }), out({ caseId: 'h', forkVerdictPass: false })]; // easy perfect, hard 0.5
    const r = scoreRun(ID, cases, outputs);
    expect(r.meanScore).toBeCloseTo(0.75);
    expect(r.passRate).toBe(0.5);
    expect(r.byDifficulty.easy.meanScore).toBe(1);
    expect(r.byDifficulty.hard.meanScore).toBe(0.5);
    expect(r.hardFails).toBe(0);
  });

  it('a missing output for a case scores 0 and counts as a hard fail', () => {
    const r = scoreRun(ID, cases, [out({ caseId: 'e' })]); // no output for 'h'
    expect(r.hardFails).toBe(1);
    expect(r.byDifficulty.hard.meanScore).toBe(0);
  });
});

describe('regressionGate — no silent degradation may merge', () => {
  const run = (meanScore: number, hardFails = 0): ReturnType<typeof scoreRun> => ({
    identity: ID, meanScore, passRate: meanScore, hardFails,
    byDifficulty: { easy: { n: 1, meanScore }, medium: { n: 0, meanScore: 0 }, hard: { n: 1, meanScore } },
    cases: [],
  });

  it('an equal-or-better candidate passes', () => {
    expect(regressionGate(run(0.9), run(0.92)).pass).toBe(true);
  });

  it('a candidate below the absolute floor is blocked', () => {
    expect(regressionGate(run(0.9), run(0.7)).pass).toBe(false);
  });

  it('a small regression beyond maxDrop is blocked', () => {
    const g = regressionGate(run(0.95), run(0.9), { maxDrop: 0.02 });
    expect(g.pass).toBe(false);
    expect(g.reason).toMatch(/regression/);
  });

  it('any NEW hard fail blocks the merge even if the score holds', () => {
    const g = regressionGate(run(0.95, 0), run(0.95, 1));
    expect(g.pass).toBe(false);
    expect(g.reason).toMatch(/new hard fail/);
  });
});

describe('pickModels — choose by evidence, tier by difficulty', () => {
  const profile = (over: Partial<ModelProfile> & { quality: number; easyQ: number; hardQ: number }): ModelProfile => ({
    provider: over.provider ?? 'p', model: over.model ?? 'm',
    costPer1kUsd: over.costPer1kUsd ?? 1, latencyMsP50: over.latencyMsP50 ?? 100,
    run: {
      identity: ID, meanScore: over.quality, passRate: over.quality, hardFails: 0,
      byDifficulty: { easy: { n: 1, meanScore: over.easyQ }, medium: { n: 1, meanScore: over.quality }, hard: { n: 1, meanScore: over.hardQ } },
      cases: [],
    },
  });

  it('default is the highest quality that clears the bar, cheapest tie-break', () => {
    const a = profile({ model: 'cheap', quality: 0.85, easyQ: 0.95, hardQ: 0.7, costPer1kUsd: 0.1 });
    const b = profile({ model: 'strong', quality: 0.92, easyQ: 0.93, hardQ: 0.9, costPer1kUsd: 5 });
    const sel = pickModels([a, b]);
    expect(sel.defaultModel.model).toBe('strong');
  });

  it('easy tier picks the cheapest near-perfect-on-easy model', () => {
    const cheap = profile({ model: 'cheap', quality: 0.85, easyQ: 0.95, hardQ: 0.6, costPer1kUsd: 0.1 });
    const strong = profile({ model: 'strong', quality: 0.92, easyQ: 0.99, hardQ: 0.95, costPer1kUsd: 5 });
    expect(pickModels([cheap, strong]).easyModel.model).toBe('cheap');
  });

  it('hard tier picks the best-on-hard model regardless of cost', () => {
    const cheap = profile({ model: 'cheap', quality: 0.85, easyQ: 0.95, hardQ: 0.6, costPer1kUsd: 0.1 });
    const strong = profile({ model: 'strong', quality: 0.92, easyQ: 0.99, hardQ: 0.95, costPer1kUsd: 5 });
    expect(pickModels([cheap, strong]).hardModel.model).toBe('strong');
  });

  it('falls back to the best available when none clear the bar', () => {
    const a = profile({ model: 'a', quality: 0.5, easyQ: 0.5, hardQ: 0.4 });
    const b = profile({ model: 'b', quality: 0.7, easyQ: 0.7, hardQ: 0.6 });
    expect(pickModels([a, b]).defaultModel.model).toBe('b');
  });

  it('throws on an empty profile set', () => {
    expect(() => pickModels([])).toThrow();
  });
});
