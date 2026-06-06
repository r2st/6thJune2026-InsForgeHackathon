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

// ── Per-signal floor (ticket 0035) ───────────────────────────────────────────
// The composite is an average; an average can hide one weak signal. The floor
// is a second layer on top of 0020's hard caps: the weakest single signal sets
// a ceiling on the dispatch tier. The badge still shows the composite; the
// floor only clamps where the run is allowed to go.
//
// Thresholds follow the ticket's Goal narrative and its worked test examples
// (signal 55 → draft_pr, signal 45 → issue), NOT the ticket's "ceiling" bullet
// (≥85→pr / ≥60→draft_pr / <60→issue), which contradicts those examples — it is
// a copy-paste of the composite tier thresholds. The concrete examples are the
// contract; see score.test.ts. Flagged in the ticket Outcome.
const FLOOR_PR_MIN = 70;     // every signal ≥70 → ceiling allows pr
const FLOOR_DRAFT_MIN = 50;  // every signal ≥50 → ceiling allows draft_pr; else issue

/** Human-readable labels for veto attribution on the receipt page. */
const SIGNAL_LABELS: Record<string, string> = {
  replayVerdictScore: 'replay verdict',
  diffSizeScore: 'diff size',
  policyBlastScore: 'policy blast radius',
  pgvectorSimilarityScore: 'pgvector similarity',
};

/**
 * The floor guards *evidence* signals only. pgvector similarity is a prior over
 * merge history, not evidence about this fix's correctness — and on hackathon
 * day it is the neutral default 50 (no corpus). Including it would veto the
 * demo (pgvector 50 = worst signal) down to draft_pr, contradicting ticket
 * 0020's demo→pr. A verified fix must not be punished for the tool having no
 * history yet. See the 0035 Outcome for this cross-ticket reconciliation.
 */
const FLOOR_SIGNALS = [
  'replayVerdictScore',
  'diffSizeScore',
  'policyBlastScore',
] as const;

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

  // Hard cap 3 (ticket 0037) — the model's OWN escalation. widensAccess=true is
  // the model saying "I can't fix this safely" (e.g. schema change required).
  // Trust it: such a run can never reach pr/draft_pr, independent of the safety
  // rail above (which only fires when the model did NOT self-flag).
  if (diagnosis.widensAccess) {
    score = Math.min(score, CAP_UNINTENDED_WIDEN);
  }

  // Composite tier — what the (post-cap) score alone would dispatch to.
  const compositeTier = tierFromScore(score);

  // Per-signal floor (0035) — the weakest single signal sets a ceiling.
  const ceiling = ceilingFromSignals(signals);

  // Final tier is the stricter of the two. The badge (score) is unchanged.
  const tier = minTier(compositeTier, ceiling);

  // Attribute the veto only when the per-signal floor (not a hard cap) is what
  // pulled the dispatch below the composite's tier.
  const veto =
    tierRank(ceiling) < tierRank(compositeTier) ? weakestSignal(signals) : undefined;

  return {
    score,
    tier,
    signals,
    ceiling,
    ...(veto ? { veto } : {}),
    promptVersion: diagnosis.promptVersion,
  };
}

/** Map a 0–100 score to a dispatch tier. */
export function tierFromScore(score: number): ConfidenceTier {
  if (score >= TIER_PR_MIN) return 'pr';
  if (score >= TIER_DRAFT_MIN) return 'draft_pr';
  return 'issue';
}

// ── per-signal floor helpers (ticket 0035) ───────────────────────────────────

type SignalMap = ConfidenceResult['signals'];

/** The strictest tier the weakest *evidence* signal permits (pgvector excluded). */
export function ceilingFromSignals(signals: SignalMap): ConfidenceTier {
  const worst = Math.min(...FLOOR_SIGNALS.map((k) => signals[k]));
  if (worst >= FLOOR_PR_MIN) return 'pr';
  if (worst >= FLOOR_DRAFT_MIN) return 'draft_pr';
  return 'issue';
}

/** The evidence signal that set the ceiling — for veto attribution. */
function weakestSignal(signals: SignalMap): { signal: string; value: number } {
  let signal = '';
  let value = Infinity;
  for (const k of FLOOR_SIGNALS) {
    if (signals[k] < value) {
      value = signals[k];
      signal = SIGNAL_LABELS[k] ?? k;
    }
  }
  return { signal, value };
}

/** pr is the most permissive tier (highest rank); issue the strictest. */
function tierRank(t: ConfidenceTier): number {
  return t === 'pr' ? 2 : t === 'draft_pr' ? 1 : 0;
}

function minTier(a: ConfidenceTier, b: ConfidenceTier): ConfidenceTier {
  return tierRank(a) <= tierRank(b) ? a : b;
}

// ── Per-signal scorers ──────────────────────────────────────────────────────

/**
 * 100 only when the bug reproduced on prod AND the fix verified on the fork.
 * Anything else is 0 — there is no partial credit on the load-bearing signal.
 */
function replayVerdictScore(verdict: Verdict): number {
  // Ticket 0033: a suite-derived verdict carries a graded 100/60/30/0 score
  // (a corroborating-probe regression scores 60, not 100). Prefer it. A bare
  // single-probe verdict falls back to the binary reproduce-then-fix signal.
  if (typeof verdict.suiteScore === 'number') return verdict.suiteScore;
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
