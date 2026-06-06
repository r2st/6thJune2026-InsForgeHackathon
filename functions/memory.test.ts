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
  RealMemoir,
  NEUTRAL_SIMILARITY,
  type RecallResult,
  type Neighbour,
  type MemoirClient,
  type MemoirRunner,
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

  it('createMemoirClient returns the null client when MEMOIR_STORE is unset', async () => {
    const c = createMemoirClient({} as NodeJS.ProcessEnv);
    expect(await c.recallSimilar({ failingPolicy: 'x', tomlDiff: DIFF })).toEqual({ neighbours: [] });
  });

  it('a stale MEMOIR_API_KEY (no MEMOIR_STORE) still falls back to neutral', async () => {
    // The old token env is dead; only MEMOIR_STORE activates the real adapter.
    const c = createMemoirClient({ MEMOIR_API_KEY: 'sk-test' } as NodeJS.ProcessEnv);
    expect(await c.recallSimilar({ failingPolicy: 'x', tomlDiff: DIFF })).toEqual({ neighbours: [] });
  });

  it('through createMemoirClient, recallSimilarity yields the neutral 50', async () => {
    const sim = await recallSimilarity(createMemoirClient({} as NodeJS.ProcessEnv), { failingPolicy: 'x', tomlDiff: DIFF });
    expect(sim).toBe(NEUTRAL_SIMILARITY);
  });
});

// ── RealMemoir: the memoir-ai.dev CLI adapter (ticket 0046) ───────────────────

describe('RealMemoir — CLI adapter (injected runner, never spawns the binary)', () => {
  const STORE = '/tmp/test-store';
  const Q = { failingPolicy: 'orders.orders_select', tomlDiff: DIFF };

  // A fake `memoir` whose recall returns the given memories and records remember calls.
  function fakeRunner(memories: Array<{ content: string; relevance_score: number }>) {
    const calls: string[][] = [];
    const run: MemoirRunner = async (args) => {
      calls.push(args);
      if (args.includes('recall')) return JSON.stringify({ success: true, memories });
      if (args.includes('remember')) return JSON.stringify({ success: true, commit_hash: 'abc' });
      return '{}';
    };
    return { run, calls };
  }

  const blob = (over: Partial<{ runId: string; decision: string; diff: TomlPatch }>) =>
    JSON.stringify({ runId: 'r1', decision: 'merged', failingPolicy: 'orders.orders_select', bugConfirmed: true, diff: DIFF, ...over });

  it('parses a merged JSON-blob neighbour; relevance → 0–100 similarity', async () => {
    const { run } = fakeRunner([{ content: blob({ decision: 'merged' }), relevance_score: 0.6 }]);
    const r = await new RealMemoir(STORE, run).recallSimilar(Q);
    expect(r.neighbours).toEqual([{ runId: 'r1', similarity: 60, outcome: 'merged', diff: DIFF }]);
  });

  it('parses a rejected neighbour (negative evidence)', async () => {
    const { run } = fakeRunner([{ content: blob({ runId: 'r2', decision: 'rejected' }), relevance_score: 0.8 }]);
    const r = await new RealMemoir(STORE, run).recallSimilar(Q);
    expect(r.neighbours[0]).toMatchObject({ outcome: 'rejected', similarity: 80, runId: 'r2' });
  });

  it('drops hits below the relevance floor (a weak match is not a neighbour)', async () => {
    const { run } = fakeRunner([{ content: blob({}), relevance_score: 0.1 }]);
    const r = await new RealMemoir(STORE, run).recallSimilar(Q);
    expect(r.neighbours).toEqual([]); // → similarityForScorer returns neutral 50
  });

  it('falls back to a leading keyword for plain-text (seed) memories', async () => {
    const { run } = fakeRunner([{ content: 'merged: orders_select RLS fix, tenant claim', relevance_score: 0.9 }]);
    const r = await new RealMemoir(STORE, run).recallSimilar(Q);
    expect(r.neighbours[0]).toMatchObject({ outcome: 'merged', similarity: 90 });
  });

  it('a CLI error (missing binary / non-zero exit) → no neighbours, never throws', async () => {
    const run: MemoirRunner = async () => { throw new Error('spawn memoir ENOENT'); };
    await expect(new RealMemoir(STORE, run).recallSimilar(Q)).resolves.toEqual({ neighbours: [] });
  });

  it('non-JSON stdout (e.g. an error banner) → no neighbours', async () => {
    const run: MemoirRunner = async () => 'Error: credit balance too low';
    await expect(new RealMemoir(STORE, run).recallSimilar(Q)).resolves.toEqual({ neighbours: [] });
  });

  it('recordOutcome shells out to `remember` under a runId-keyed path', async () => {
    const { run, calls } = fakeRunner([]);
    await new RealMemoir(STORE, run).recordOutcome({
      runId: 'run abc/123', failingPolicy: 'orders.orders_select', tomlDiff: DIFF,
      bugConfirmed: true, decision: 'merged', at: '2026-06-06',
    });
    const call = calls.find((c) => c.includes('remember'))!;
    expect(call).toContain('-s'); expect(call).toContain(STORE);
    expect(call).toContain('-n'); expect(call).toContain('hush');
    expect(call).toContain('-p'); expect(call).toContain('outcome.run-abc-123'); // sanitised
  });

  it('recordOutcome swallows a CLI failure (memory never breaks a run)', async () => {
    const run: MemoirRunner = async () => { throw new Error('disk full'); };
    await expect(new RealMemoir(STORE, run).recordOutcome({
      runId: 'r', failingPolicy: 'x', tomlDiff: DIFF, bugConfirmed: true, decision: 'merged', at: '2026-06-06',
    })).resolves.toBeUndefined();
  });

  it('createMemoirClient returns RealMemoir when MEMOIR_STORE is set, and recall flows through', async () => {
    const { run } = fakeRunner([{ content: blob({ decision: 'merged' }), relevance_score: 0.75 }]);
    const client = createMemoirClient({ MEMOIR_STORE: STORE } as NodeJS.ProcessEnv, run);
    expect(client).toBeInstanceOf(RealMemoir);
    await expect(recallSimilarity(client, Q)).resolves.toBe(75); // real neighbour → real signal
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
