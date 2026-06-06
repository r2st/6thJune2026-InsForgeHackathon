// functions/score.ts
// Combine four signals into a 0–100 confidence score and a tier.
//
// Ticket:  agents/tasks/0020-confidence-scorer-and-tier-routing.md
// Drives:  the on-stage confidence badge (slide 07) and PR / draft / issue
//          routing (slide 08).
//
// Design principle — the replay verdict is load-bearing. A high static-signal
// score must NOT survive a failing replay. The two hard caps below encode that:
// a run that didn't reproduce-then-fix on the fork can never reach the PR tier,
// no matter how clean the diff looks. This is the "a passing replay plus a
// non-widening diff is proof; neither alone is" discipline from
// docs/the-hardest-part.html, expressed as arithmetic.

import type {
  Diagnosis,
  Verdict,
  SafetyResult,
  ConfidenceResult,
  ConfidenceTier,
} from './types.js';

export interface ScoreInput {
  diagnosis: Diagnosis;
  verdict: Verdict;
  safety: SafetyResult;
  /**
   * kNN cosine similarity to past merged diffs, already projected onto 0–100.
   * 50 (neutral) when no neighbours exist — the hackathon-day reality. We do
   * not pretend to have a corpus.
   */
  pgvectorSimilarity: number;
}

/** Signal weights. Sum to 1.0. Tuned in score.test.ts; safe to adjust there. */
const WEIGHTS = {
  replayVerdict: 0.4,
  diffSize: 0.2,
  policyBlast: 0.2,
  pgvectorSimilarity: 0.2,
} as const;

/** Tier thresholds (inclusive low bound). */
const TIER_PR_MIN = 85;
const TIER_DRAFT_MIN = 60;

/** Hard caps — see module header. */
const CAP_REPLAY_FAILED = 30;     // bug didn't reproduce-then-fix on the fork
const CAP_UNINTENDED_WIDEN = 59;  // safety rail says it widens; model didn't flag it

export function scoreConfidence(input: ScoreInput): ConfidenceResult {
  const { diagnosis, verdict, safety, pgvectorSimilarity } = input;

  const signals = {
    replayVerdictScore: replayVerdictScore(verdict),
    diffSizeScore: diffSizeScore(diagnosis),
    policyBlastScore: policyBlastScore(diagnosis),
    pgvectorSimilarityScore: clamp(pgvectorSimilarity),
  };

  // Weighted composite. This number is the badge; it is reported verbatim even
  // when a hard cap lowers it — the cap is applied to the composite, not faked.
  const composite =
    signals.replayVerdictScore * WEIGHTS.replayVerdict +
    signals.diffSizeScore * WEIGHTS.diffSize +
    signals.policyBlastScore * WEIGHTS.policyBlast +
    signals.pgvectorSimilarityScore * WEIGHTS.pgvectorSimilarity;

  let score = Math.round(composite);

  // Hard cap 1 — the replay is the strongest signal. If the fork didn't make
  // the failing session pass while prod still fails, nothing else can rescue it.
  if (!verdict.bugConfirmed || !verdict.fixVerified) {
    score = Math.min(score, CAP_REPLAY_FAILED);
  }

  // Hard cap 2 — deterministic safety rail overrides the model's optimism. If
  // the diff actually widens access (safety.widens) and the diagnosis didn't
  // declare that intent (widensAccess=false), force it below the PR/draft line.
  if (safety.widens && !diagnosis.widensAccess) {
    score = Math.min(score, CAP_UNINTENDED_WIDEN);
  }

  return {
    score,
    tier: tierFromScore(score),
    signals,
    promptVersion: diagnosis.promptVersion,
  };
}

/** Map a 0–100 score to a dispatch tier. Exported for ticket 0035's floor layer. */
export function tierFromScore(score: number): ConfidenceTier {
  if (score >= TIER_PR_MIN) return 'pr';
  if (score >= TIER_DRAFT_MIN) return 'draft_pr';
  return 'issue';
}

// ── Per-signal scorers ──────────────────────────────────────────────────────

/**
 * 100 only when the bug reproduced on prod AND the fix verified on the fork.
 * Anything else is 0 — there is no partial credit on the load-bearing signal.
 */
function replayVerdictScore(verdict: Verdict): number {
  return verdict.bugConfirmed && verdict.fixVerified ? 100 : 0;
}

/**
 * Smaller diffs score higher. A single-table patch of ≤6 lines is the ideal
 * shape Hush emits; >2 tables touched is disqualifying (score 0). Line overflow
 * past 6 decays at 8pts/line; a second table costs a flat 40.
 */
function diffSizeScore(diagnosis: Diagnosis): number {
  const { diffLoc, tablesTouched } = diagnosis.confidenceInputs;
  if (tablesTouched > 2) return 0;
  const locPenalty = Math.max(0, diffLoc - 6) * 8;
  const tablePenalty = Math.max(0, tablesTouched - 1) * 40;
  return clamp(100 - locPenalty - tablePenalty);
}

/**
 * Inverse of policy blast radius — how many routes/tables the changed policy
 * gates. A single-route policy is a contained change (100); each extra gated
 * surface costs 20.
 */
function policyBlastScore(diagnosis: Diagnosis): number {
  const blast = diagnosis.confidenceInputs.policyBlast;
  return clamp(100 - Math.max(0, blast - 1) * 20);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function clamp(n: number, lo = 0, hi = 100): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
