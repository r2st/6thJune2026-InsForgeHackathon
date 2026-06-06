// functions/memory.ts
// Memoir — Hush's learn-from-rejections memory layer.
//
// Ticket:  agents/tasks/0043-memoir-learn-from-rejections-memory.md
// Sponsor: Memoir (https://www.memoir-ai.dev/ — "git for AI memory")
//
// Every resolved fix outcome (merged / rejected / dismissed / duplicate) is
// recorded; at score time Hush recalls similar past outcomes and turns them
// into the scorer's pgvector-similarity signal. A *merged* neighbour raises
// confidence ("we've shipped a fix like this before"); a *rejected* neighbour
// lowers it ("we already decided this isn't a bug"). With no corpus the signal
// is the honest neutral 50 — we never invent a neighbour.
//
// Honesty + robustness boundary: the recall→similarity math, the fallback, and
// the orchestrator wiring are real and unit-tested here. The actual Memoir SDK
// adapter (`RealMemoir`) is deliberately NOT guessed — web search surfaced two
// products under the name; the exact API must be confirmed against the sponsor's
// docs (see ticket). Until it is, `createMemoirClient` returns the null client,
// so the pipeline behaves exactly as today (neutral 50) and never breaks.

import type { TomlPatch } from './types.js';

/** No corpus → neutral signal. Mirrors fix-trigger's constant; the honest default. */
export const NEUTRAL_SIMILARITY = 50;

/** How hard a similar *rejected* outcome pulls confidence down. */
const REJECTION_WEIGHT = 0.6;

export type OutcomeDecision = 'merged' | 'rejected' | 'dismissed' | 'duplicate' | 'pending';

/** A past run's outcome, as written to Memoir. */
export interface OutcomeRecord {
  runId: string; // idempotency key — re-recording a run updates, never duplicates
  failingPolicy: string; // "<table>.<policy>"
  tomlDiff: TomlPatch;
  bugConfirmed: boolean;
  decision: OutcomeDecision;
  at: string; // ISO8601
}

/** The shape Hush recalls against at diagnose/score time. */
export interface RecallQuery {
  failingPolicy: string;
  tomlDiff: TomlPatch;
  schemaSlice?: string;
}

export interface Neighbour {
  runId: string;
  similarity: number; // 0..100
  outcome: OutcomeDecision;
  diff: TomlPatch;
}

export interface RecallResult {
  neighbours: Neighbour[];
}

/** Vendor-agnostic seam. RealMemoir and the null fallback both implement this. */
export interface MemoirClient {
  recordOutcome(record: OutcomeRecord): Promise<void>;
  recallSimilar(query: RecallQuery): Promise<RecallResult>;
}

// ── the heart: recall → scorer signal (pure, fully tested) ───────────────────

/**
 * Project a recall result onto the scorer's 0–100 pgvector-similarity input.
 *
 *   - no neighbours                  → 50 (neutral; no corpus, no pretending)
 *   - best MERGED neighbour          → its similarity (positive evidence)
 *   - best REJECTED/dismissed neighbour subtracts REJECTION_WEIGHT × its
 *     similarity (negative evidence — "we tried this, it wasn't a bug")
 *
 * A near-identical past rejection can therefore outweigh a weaker merged match,
 * which is the whole point of learning from rejections.
 */
export function similarityForScorer(recall: RecallResult): number {
  const ns = recall.neighbours;
  if (ns.length === 0) return NEUTRAL_SIMILARITY;

  const topMerged = bestSimilarity(ns, (o) => o === 'merged');
  const topRejected = bestSimilarity(ns, (o) => o === 'rejected' || o === 'dismissed');

  const base = topMerged ?? NEUTRAL_SIMILARITY;
  const penalty = topRejected != null ? Math.round(topRejected * REJECTION_WEIGHT) : 0;
  return clamp(base - penalty);
}

function bestSimilarity(ns: Neighbour[], pick: (o: OutcomeDecision) => boolean): number | null {
  let best: number | null = null;
  for (const n of ns) {
    if (!pick(n.outcome)) continue;
    if (best == null || n.similarity > best) best = clamp(n.similarity);
  }
  return best;
}

/** Convenience: recall and project in one call. The orchestrator's score input. */
export async function recallSimilarity(client: MemoirClient, query: RecallQuery): Promise<number> {
  try {
    return similarityForScorer(await client.recallSimilar(query));
  } catch {
    // Memory must never break a run — degrade to neutral.
    return NEUTRAL_SIMILARITY;
  }
}

// ── client resolution: real adapter (pending SDK) vs working fallback ─────────

/** The honest no-op: empty recall, no-op record. Preserves the neutral-50 path. */
export const nullMemoir: MemoirClient = {
  async recallSimilar() {
    return { neighbours: [] };
  },
  async recordOutcome() {
    /* no corpus to write to — handled by RealMemoir once the SDK is wired */
  },
};

/**
 * Resolve a Memoir client from the environment.
 *
 * NOTE(0043): when `MEMOIR_API_KEY` is set the real adapter should be returned,
 * but the Memoir SDK surface is not yet confirmed (two products share the name —
 * see the ticket). Returning a *guessed* adapter would violate the project's
 * honesty rail, so until the SDK is confirmed this returns `nullMemoir` and logs
 * once. Wiring the real client is a one-function change here; nothing downstream
 * moves, because every caller goes through `recallSimilarity`/this interface.
 */
export function createMemoirClient(env: NodeJS.ProcessEnv = process.env): MemoirClient {
  if (env.MEMOIR_API_KEY) {
    warnOnce(
      'MEMOIR_API_KEY is set but the Memoir SDK adapter is not wired yet ' +
        '(confirm the API per ticket 0043). Using the neutral fallback.',
    );
    // return new RealMemoir(env.MEMOIR_API_KEY);  ← drop-in once the SDK is confirmed
  }
  return nullMemoir;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function clamp(n: number, lo = 0, hi = 100): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

let _warned = false;
function warnOnce(msg: string): void {
  if (_warned) return;
  _warned = true;
  console.warn(`[hush:memory] ${msg}`);
}
