// functions/score.test.ts
// Acceptance tests for the confidence scorer (ticket 0020).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import type { Diagnosis, Verdict, SafetyResult, TomlPatch } from './types.js';
import { scoreConfidence, tierFromScore, ceilingFromSignals, type ScoreInput } from './score.js';

// ── builders ─────────────────────────────────────────────────────────────────

const DEMO_PATCH: TomlPatch = {
  path: 'tables.orders.rls',
  before: "tenant_id = (auth.jwt() ->> 'tenant')::uuid",
  after:
    "tenant_id = (auth.jwt() ->> 'tenant')::uuid OR tenant_id = ANY((auth.jwt() -> 'tenant_ids')::uuid[])",
};

function diagnosis(over: Partial<Diagnosis> = {}): Diagnosis {
  return {
    summary: 'Orders page empty: RLS reads a stale singular tenant claim.',
    expectation: 'User sees their 3 orders.',
    observation: 'User sees 0 orders.',
    failingPolicy: 'orders.orders_select',
    failingJwtClaim: "auth.jwt() -> 'tenant'",
    tomlDiff: DEMO_PATCH,
    widensAccess: false,
    confidenceInputs: { diffLoc: 4, tablesTouched: 1, policyBlast: 1 },
    promptVersion: 'diagnose-v1.0.0',
    ...over,
  };
}

function verdict(over: Partial<Verdict> = {}): Verdict {
  return {
    prod: { status: 200, rowsReturned: 0, latencyMs: 142, snippet: '[]' },
    fork: { status: 200, rowsReturned: 3, latencyMs: 138, snippet: '[{...}]' },
    bugConfirmed: true,
    fixVerified: true,
    rationale: 'prod 0 rows, fork 3 rows — fix verified on branch',
    ...over,
  };
}

const SAFE: SafetyResult = { widens: false, reasons: [] };

function input(over: Partial<ScoreInput> = {}): ScoreInput {
  return {
    diagnosis: diagnosis(),
    verdict: verdict(),
    safety: SAFE,
    pgvectorSimilarity: 50, // no neighbours — neutral
    ...over,
  };
}

// ── the demo bug ──────────────────────────────────────────────────────────────

describe('scoreConfidence — the demo bug (slide 07)', () => {
  it('replay passes + small single-table diff → pr tier, high score', () => {
    const r = scoreConfidence(input());
    // 0.4*100 + 0.2*100 + 0.2*100 + 0.2*50 = 90
    expect(r.score).toBe(90);
    expect(r.tier).toBe('pr');
    expect(r.signals).toEqual({
      replayVerdictScore: 100,
      diffSizeScore: 100,
      policyBlastScore: 100,
      pgvectorSimilarityScore: 50,
    });
    expect(r.promptVersion).toBe('diagnose-v1.0.0');
    // 0035: neutral pgvector (50) must NOT veto — it's a prior, not evidence.
    expect(r.ceiling).toBe('pr');
    expect(r.veto).toBeUndefined();
  });

  it('with one merged neighbour at 90 similarity → crosses into the 90s', () => {
    const r = scoreConfidence(input({ pgvectorSimilarity: 90 }));
    // 40 + 20 + 20 + 18 = 98
    expect(r.score).toBe(98);
    expect(r.tier).toBe('pr');
  });
});

// ── hard cap 1: replay is load-bearing ───────────────────────────────────────

describe('scoreConfidence — replay verdict caps everything', () => {
  it('fix not verified on fork → capped at 30, forced to issue', () => {
    const r = scoreConfidence(
      input({ verdict: verdict({ fixVerified: false }) }),
    );
    expect(r.score).toBe(30);
    expect(r.tier).toBe('issue');
    expect(r.signals.replayVerdictScore).toBe(0);
  });

  it('bug not reproduced on prod → capped at 30 even with perfect static signals', () => {
    const r = scoreConfidence(
      input({
        verdict: verdict({ bugConfirmed: false }),
        pgvectorSimilarity: 100,
      }),
    );
    expect(r.score).toBeLessThanOrEqual(30);
    expect(r.tier).toBe('issue');
  });
});

// ── hard cap 2: unintended widening ──────────────────────────────────────────

describe('scoreConfidence — safety rail overrides model optimism', () => {
  it('diff widens (safety) but model did not declare intent → capped at 59 → issue', () => {
    const r = scoreConfidence(
      input({ safety: { widens: true, reasons: ['dropped AND conjunct'] } }),
    );
    expect(r.score).toBe(59);
    expect(r.tier).toBe('issue');
  });

  it('diff widens but the diagnosis declared intent → NOT capped (deliberate relaxation)', () => {
    const r = scoreConfidence(
      input({
        diagnosis: diagnosis({ widensAccess: true }),
        safety: { widens: true, reasons: ['new OR branch'] },
      }),
    );
    expect(r.score).toBe(90); // composite stands
    expect(r.tier).toBe('pr');
  });
});

// ── diff-size signal ─────────────────────────────────────────────────────────

describe('diffSizeScore via composite', () => {
  it('>2 tables touched → diff signal 0, composite 70 but floored to issue (0035)', () => {
    const r = scoreConfidence(
      input({ diagnosis: diagnosis({ confidenceInputs: { diffLoc: 4, tablesTouched: 3, policyBlast: 1 } }) }),
    );
    expect(r.signals.diffSizeScore).toBe(0);
    // Composite = 40 + 0 + 20 + 10 = 70 (unchanged). But the per-signal floor
    // (0035) sees diffSize=0 < 50 → ceiling issue → dispatch issue, veto names it.
    expect(r.score).toBe(70);
    expect(r.tier).toBe('issue');
    expect(r.ceiling).toBe('issue');
    expect(r.veto).toEqual({ signal: 'diff size', value: 0 });
  });

  it('a second table costs a flat 40', () => {
    const r = scoreConfidence(
      input({ diagnosis: diagnosis({ confidenceInputs: { diffLoc: 6, tablesTouched: 2, policyBlast: 1 } }) }),
    );
    expect(r.signals.diffSizeScore).toBe(60);
  });

  it('line overflow past 6 decays at 8pts/line', () => {
    const r = scoreConfidence(
      input({ diagnosis: diagnosis({ confidenceInputs: { diffLoc: 16, tablesTouched: 1, policyBlast: 1 } }) }),
    );
    expect(r.signals.diffSizeScore).toBe(20); // 100 - 10*8
  });
});

// ── policy-blast signal ──────────────────────────────────────────────────────

describe('policyBlastScore via composite', () => {
  it('single-route policy → 100', () => {
    const r = scoreConfidence(input());
    expect(r.signals.policyBlastScore).toBe(100);
  });

  it('blast of 6 routes → 0', () => {
    const r = scoreConfidence(
      input({ diagnosis: diagnosis({ confidenceInputs: { diffLoc: 4, tablesTouched: 1, policyBlast: 6 } }) }),
    );
    expect(r.signals.policyBlastScore).toBe(0);
  });
});

// ── tier boundaries ──────────────────────────────────────────────────────────

describe('tierFromScore — boundaries', () => {
  it('85 is pr, 84 is draft_pr', () => {
    expect(tierFromScore(85)).toBe('pr');
    expect(tierFromScore(84)).toBe('draft_pr');
  });

  it('60 is draft_pr, 59 is issue', () => {
    expect(tierFromScore(60)).toBe('draft_pr');
    expect(tierFromScore(59)).toBe('issue');
  });

  it('extremes', () => {
    expect(tierFromScore(100)).toBe('pr');
    expect(tierFromScore(0)).toBe('issue');
  });
});

// ── per-signal floor + veto (ticket 0035) ────────────────────────────────────

describe('scoreConfidence — per-signal floor vetoes its tier', () => {
  it('all evidence signals strong → pr, no veto', () => {
    const r = scoreConfidence(input({ pgvectorSimilarity: 100 }));
    expect(r.tier).toBe('pr');
    expect(r.ceiling).toBe('pr');
    expect(r.veto).toBeUndefined();
  });

  it('one evidence signal 60 (diff), composite high → tier draft_pr, veto names it', () => {
    const r = scoreConfidence(
      input({
        // diffLoc 11.625 isn't integer; use loc to hit diffSize 60, then assert veto on the lowest.
        diagnosis: diagnosis({ confidenceInputs: { diffLoc: 11, tablesTouched: 1, policyBlast: 1 } }),
        pgvectorSimilarity: 100,
      }),
    );
    // signals: replay100, diff60, blast100, pg100. worst evidence = 60 → ceiling draft_pr.
    // composite = 40 + 12 + 20 + 20 = 92 → composite tier pr. final = draft_pr, veto.
    expect(r.signals.diffSizeScore).toBe(60);
    expect(r.score).toBe(92);
    expect(r.tier).toBe('draft_pr');
    expect(r.ceiling).toBe('draft_pr');
    expect(r.veto).toEqual({ signal: 'diff size', value: 60 });
  });

  it('one evidence signal 40 (blast), composite high → tier issue, veto names it', () => {
    const r = scoreConfidence(
      input({
        diagnosis: diagnosis({ confidenceInputs: { diffLoc: 4, tablesTouched: 1, policyBlast: 4 } }),
        pgvectorSimilarity: 100,
      }),
    );
    // blast 4 → policyBlastScore = 100 - 3*20 = 40 → ceiling issue.
    // composite = 40 + 20 + 8 + 20 = 88 → composite tier pr. final = issue, veto.
    expect(r.signals.policyBlastScore).toBe(40);
    expect(r.score).toBe(88);
    expect(r.tier).toBe('issue');
    expect(r.ceiling).toBe('issue');
    expect(r.veto).toEqual({ signal: 'policy blast radius', value: 40 });
  });

  it('hard cap still wins: widening + all signals 100 → issue, and no per-signal veto', () => {
    const r = scoreConfidence(
      input({
        diagnosis: diagnosis({
          widensAccess: false,
          confidenceInputs: { diffLoc: 4, tablesTouched: 1, policyBlast: 1 },
        }),
        safety: { widens: true, reasons: ['dropped AND conjunct'] },
        pgvectorSimilarity: 100,
      }),
    );
    // Hard cap 2 → score 59 → composite tier issue. Evidence signals all 100 →
    // ceiling pr. The issue came from the hard cap, not the floor → no veto.
    expect(r.score).toBe(59);
    expect(r.tier).toBe('issue');
    expect(r.ceiling).toBe('pr');
    expect(r.veto).toBeUndefined();
  });

  it('pgvector is excluded from the floor — a low prior never vetoes on its own', () => {
    const r = scoreConfidence(input({ pgvectorSimilarity: 0 }));
    // Evidence signals all 100 → ceiling pr. composite = 40+20+20+0 = 80 → draft_pr.
    // Tier is draft_pr from the *composite*, not a veto (ceiling is pr).
    expect(r.score).toBe(80);
    expect(r.tier).toBe('draft_pr');
    expect(r.ceiling).toBe('pr');
    expect(r.veto).toBeUndefined();
  });
});

describe('ceilingFromSignals — boundaries (evidence signals only)', () => {
  const sig = (replay: number, diff: number, blast: number, pg: number) => ({
    replayVerdictScore: replay,
    diffSizeScore: diff,
    policyBlastScore: blast,
    pgvectorSimilarityScore: pg,
  });
  it('worst evidence ≥70 → pr (even if pgvector is 0)', () => {
    expect(ceilingFromSignals(sig(100, 70, 100, 0))).toBe('pr');
  });
  it('worst evidence in [50,70) → draft_pr', () => {
    expect(ceilingFromSignals(sig(100, 50, 100, 100))).toBe('draft_pr');
    expect(ceilingFromSignals(sig(100, 69, 100, 100))).toBe('draft_pr');
  });
  it('worst evidence <50 → issue', () => {
    expect(ceilingFromSignals(sig(100, 49, 100, 100))).toBe('issue');
  });
});

// ── input hygiene ────────────────────────────────────────────────────────────

describe('scoreConfidence — pgvector clamping', () => {
  it('out-of-range similarity is clamped to 0..100', () => {
    expect(scoreConfidence(input({ pgvectorSimilarity: 250 })).signals.pgvectorSimilarityScore).toBe(100);
    expect(scoreConfidence(input({ pgvectorSimilarity: -5 })).signals.pgvectorSimilarityScore).toBe(0);
  });
});
