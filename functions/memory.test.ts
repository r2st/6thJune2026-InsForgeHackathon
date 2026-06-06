// functions/memory.test.ts
// Acceptance tests for the Memoir learning layer (ticket 0043).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import type { TomlPatch } from './types.js';
import {
  similarityForScorer,
  recallSimilarity,
  createMemoirClient,
  nullMemoir,
  NEUTRAL_SIMILARITY,
  type RecallResult,
  type Neighbour,
  type MemoirClient,
} from './memory.js';
import { scoreConfidence } from './score.js';

const DIFF: TomlPatch = { path: 'tables.orders.rls', before: 'a', after: 'b' };

function n(over: Partial<Neighbour>): Neighbour {
  return { runId: 'r', similarity: 60, outcome: 'merged', diff: DIFF, ...over };
}
const recall = (neighbours: Neighbour[]): RecallResult => ({ neighbours });

// ── the heart: recall → scorer signal ────────────────────────────────────────

describe('similarityForScorer', () => {
  it('no neighbours → neutral 50 (we do not invent a corpus)', () => {
    expect(similarityForScorer(recall([]))).toBe(NEUTRAL_SIMILARITY);
  });

  it('a merged neighbour → its similarity (positive evidence)', () => {
    expect(similarityForScorer(recall([n({ outcome: 'merged', similarity: 60 })]))).toBe(60);
  });

  it('takes the best merged neighbour when several exist', () => {
    const r = recall([
      n({ outcome: 'merged', similarity: 40 }),
      n({ outcome: 'merged', similarity: 72 }),
    ]);
    expect(similarityForScorer(r)).toBe(72);
  });

  it('a rejected neighbour pulls the signal down ("we tried this, not a bug")', () => {
    // no merged → base 50; rejected 90 → penalty round(90*0.6)=54 → 50-54 → clamp 0
    expect(similarityForScorer(recall([n({ outcome: 'rejected', similarity: 90 })]))).toBe(0);
  });

  it('a near-identical rejection outweighs a weaker merged match', () => {
    const r = recall([
      n({ runId: 'm', outcome: 'merged', similarity: 60 }),
      n({ runId: 'x', outcome: 'rejected', similarity: 80 }),
    ]);
    // base 60 - round(80*0.6)=48 → 12
    expect(similarityForScorer(r)).toBe(12);
  });

  it('dismissed counts as a rejection-class penalty', () => {
    expect(similarityForScorer(recall([n({ outcome: 'dismissed', similarity: 50 })]))).toBe(20); // 50 - 30
  });

  it('clamps out-of-range similarities', () => {
    expect(similarityForScorer(recall([n({ outcome: 'merged', similarity: 250 })]))).toBe(100);
  });
});

// ── the honest 92% path (resolves ticket 0040) ───────────────────────────────

describe('the learning loop makes the demo badge 92 honestly', () => {
  it('one merged neighbour at similarity 60 → scorer composite 92', () => {
    const pgvectorSimilarity = similarityForScorer(
      recall([n({ outcome: 'merged', similarity: 60 })]),
    );
    expect(pgvectorSimilarity).toBe(60);

    const confidence = scoreConfidence({
      diagnosis: {
        summary: '', expectation: '', observation: '',
        failingPolicy: 'orders.orders_select', failingJwtClaim: '',
        tomlDiff: DIFF, widensAccess: false,
        confidenceInputs: { diffLoc: 4, tablesTouched: 1, policyBlast: 1 },
        promptVersion: 'diagnose-v1.0.0',
      },
      verdict: {
        prod: { status: 200, rowsReturned: 0, latencyMs: 1, snippet: '[]' },
        fork: { status: 200, rowsReturned: 3, latencyMs: 1, snippet: '[...]' },
        bugConfirmed: true, fixVerified: true, rationale: '',
      },
      safety: { widens: false, reasons: [] },
      pgvectorSimilarity, // ← real recalled neighbour, not a hardcoded number
    });
    // 0.4*100 + 0.2*100 + 0.2*100 + 0.2*60 = 92
    expect(confidence.score).toBe(92);
    expect(confidence.tier).toBe('pr');
  });
});

// ── fallback discipline ──────────────────────────────────────────────────────

describe('nullMemoir + createMemoirClient — the honest no-op', () => {
  it('nullMemoir recall is empty and record is a no-op', async () => {
    await expect(nullMemoir.recallSimilar({ failingPolicy: 'x', tomlDiff: DIFF })).resolves.toEqual({ neighbours: [] });
    await expect(nullMemoir.recordOutcome({
      runId: 'r', failingPolicy: 'x', tomlDiff: DIFF, bugConfirmed: true, decision: 'pending', at: '2026-06-06',
    })).resolves.toBeUndefined();
  });

  it('createMemoirClient returns the null client when no key is set', async () => {
    const c = createMemoirClient({} as NodeJS.ProcessEnv);
    expect(await c.recallSimilar({ failingPolicy: 'x', tomlDiff: DIFF })).toEqual({ neighbours: [] });
  });

  it('createMemoirClient falls back (not a guessed adapter) even when a key IS set', async () => {
    // Until the Memoir SDK is confirmed, a set key must not silently mis-call a
    // guessed API — it falls back to neutral, never breaks the run.
    const c = createMemoirClient({ MEMOIR_API_KEY: 'sk-test' } as NodeJS.ProcessEnv);
    expect(await c.recallSimilar({ failingPolicy: 'x', tomlDiff: DIFF })).toEqual({ neighbours: [] });
  });

  it('through createMemoirClient, recallSimilarity yields the neutral 50', async () => {
    const sim = await recallSimilarity(createMemoirClient({} as NodeJS.ProcessEnv), { failingPolicy: 'x', tomlDiff: DIFF });
    expect(sim).toBe(NEUTRAL_SIMILARITY);
  });
});

// ── recall must never break a run ────────────────────────────────────────────

describe('recallSimilarity — robustness', () => {
  it('a throwing client degrades to neutral, does not propagate', async () => {
    const broken: MemoirClient = {
      async recallSimilar() { throw new Error('memoir 503'); },
      async recordOutcome() {},
    };
    await expect(recallSimilarity(broken, { failingPolicy: 'x', tomlDiff: DIFF })).resolves.toBe(NEUTRAL_SIMILARITY);
  });

  it('a fake corpus client feeds a real neighbour through', async () => {
    const fake: MemoirClient = {
      async recallSimilar() { return recall([n({ outcome: 'merged', similarity: 75 })]); },
      async recordOutcome() {},
    };
    await expect(recallSimilarity(fake, { failingPolicy: 'orders.orders_select', tomlDiff: DIFF })).resolves.toBe(75);
  });
});
