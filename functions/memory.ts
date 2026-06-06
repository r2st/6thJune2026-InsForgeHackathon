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

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TomlPatch } from './types.js';

const execFileAsync = promisify(execFile);

/** No corpus → neutral signal. Mirrors fix-trigger's constant; the honest default. */
export const NEUTRAL_SIMILARITY = 50;

/** How hard a similar *rejected* outcome pulls confidence down. */
const REJECTION_WEIGHT = 0.6;

/** memoir namespace Hush writes its outcomes under (keeps them off the user's taxonomy). */
const MEMOIR_NAMESPACE = 'hush';

/** Recall hits below this relevance (0–1) are dropped, so a weak match can't
 *  pull the scorer *below* neutral. No real neighbour → empty → neutral 50. */
const MIN_RELEVANCE = 0.2;

/** How many recall hits to consider. */
const RECALL_LIMIT = 5;

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

// ── RealMemoir: the memoir-ai.dev CLI adapter (ticket 0046) ───────────────────
//
// Sponsor confirmed as memoir-ai.dev (zhangfengcdt/memoir): a LOCAL CLI, no
// token. We shell out to `memoir` against a store path (MEMOIR_STORE). Outcomes
// are written as JSON blobs under the `hush` namespace, keyed by runId, so
// recall round-trips structured data we control rather than parsing prose.
//
// Every CLI path is wrapped: a missing binary, a non-zero exit, malformed JSON,
// or an Anthropic-credit failure on semantic recall all degrade to "no
// neighbours" (recall) or a logged no-op (record). Memory never breaks a run.

/** Injectable exec seam — tests pass a fake; prod spawns the real binary. */
export type MemoirRunner = (args: string[]) => Promise<string>;

/** Default runner: spawn `memoir` and return stdout. 10s cap. */
export const defaultMemoirRunner: MemoirRunner = async (args) => {
  const { stdout } = await execFileAsync('memoir', args, {
    timeout: 10_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
};

/** memoir taxonomy paths are `[a-z0-9._-]`; sanitise a runId into one segment. */
function keyForRun(runId: string): string {
  const safe = runId.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
  return `outcome.${safe || 'unknown'}`;
}

/** The JSON blob we store as a memory's content and parse back on recall. */
interface OutcomeBlob {
  runId: string;
  decision: OutcomeDecision;
  failingPolicy: string;
  bugConfirmed: boolean;
  diff: TomlPatch;
}

const DECISION_WORDS: OutcomeDecision[] = ['merged', 'rejected', 'dismissed', 'duplicate', 'pending'];

/** Recover an outcome from a recalled memory: prefer our JSON blob; fall back to
 *  a leading keyword for plain-text/seed memories; else 'pending' (counts as
 *  neither positive nor negative evidence). */
function parseOutcome(content: string, fallbackDiff: TomlPatch): { decision: OutcomeDecision; runId: string; diff: TomlPatch } {
  try {
    const blob = JSON.parse(content) as Partial<OutcomeBlob>;
    if (blob && typeof blob === 'object' && blob.decision && DECISION_WORDS.includes(blob.decision)) {
      return {
        decision: blob.decision,
        runId: blob.runId ?? 'unknown',
        diff: blob.diff ?? fallbackDiff,
      };
    }
  } catch {
    /* not our JSON — fall through to keyword detection */
  }
  const head = content.trimStart().toLowerCase();
  const word = DECISION_WORDS.find((w) => head.startsWith(w));
  return { decision: word ?? 'pending', runId: 'unknown', diff: fallbackDiff };
}

export class RealMemoir implements MemoirClient {
  constructor(
    private readonly store: string,
    private readonly run: MemoirRunner = defaultMemoirRunner,
  ) {}

  async recordOutcome(record: OutcomeRecord): Promise<void> {
    const blob: OutcomeBlob = {
      runId: record.runId,
      decision: record.decision,
      failingPolicy: record.failingPolicy,
      bugConfirmed: record.bugConfirmed,
      diff: record.tomlDiff,
    };
    try {
      // Same runId → same path → memoir versions it (update, not duplicate).
      await this.run([
        '-s', this.store, '--json',
        'remember', JSON.stringify(blob),
        '-n', MEMOIR_NAMESPACE,
        '-p', keyForRun(record.runId),
      ]);
    } catch (err) {
      warnOnce(`recordOutcome failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async recallSimilar(query: RecallQuery): Promise<RecallResult> {
    const q = `${query.failingPolicy} ${query.tomlDiff.after ?? ''}`.trim();
    let stdout: string;
    try {
      stdout = await this.run([
        '-s', this.store, '--json',
        'recall', q,
        '-n', MEMOIR_NAMESPACE,
        '-l', String(RECALL_LIMIT),
      ]);
    } catch {
      return { neighbours: [] }; // missing binary / non-zero exit / timeout
    }

    let parsed: { memories?: Array<{ content?: string; relevance_score?: number }> };
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return { neighbours: [] }; // non-JSON (e.g. an error banner)
    }

    const neighbours: Neighbour[] = [];
    for (const m of parsed.memories ?? []) {
      const relevance = typeof m.relevance_score === 'number' ? m.relevance_score : 0;
      if (relevance < MIN_RELEVANCE) continue; // weak match → not a neighbour
      const { decision, runId, diff } = parseOutcome(m.content ?? '', query.tomlDiff);
      neighbours.push({ runId, similarity: clamp(relevance * 100), outcome: decision, diff });
    }
    return { neighbours };
  }
}

/**
 * Resolve a Memoir client from the environment.
 *
 * `MEMOIR_STORE` set → the real memoir-ai.dev CLI adapter (ticket 0046).
 * Unset → the honest no-op (`nullMemoir`), so the pipeline behaves exactly as
 * before (neutral 50). Either way, callers go through `recallSimilarity`/this
 * interface, so nothing downstream changes.
 */
export function createMemoirClient(
  env: NodeJS.ProcessEnv = process.env,
  runner: MemoirRunner = defaultMemoirRunner,
): MemoirClient {
  const store = env.MEMOIR_STORE?.trim();
  if (store) return new RealMemoir(store, runner);
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
