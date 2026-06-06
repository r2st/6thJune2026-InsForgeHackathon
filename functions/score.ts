// functions/score.ts
// Combine four signals into a 0–100 confidence score and a tier.
//
// Ticket: agents/inbox/0020-confidence-scorer-and-tier-routing.md
// Drives:  the on-stage "92%" badge and PR / draft / issue routing.

import type { Diagnosis, Verdict, ConfidenceResult, SafetyResult } from './types.js';

export interface ScoreInput {
  diagnosis: Diagnosis;
  verdict: Verdict;
  safety: SafetyResult;
  /** kNN cosine similarity to past merged diffs; 50 if no neighbours exist. */
  pgvectorSimilarity: number;
}

export function scoreConfidence(input: ScoreInput): ConfidenceResult {
  // TODO(0020): implement per the ticket's weight scheme.
  //   Hard floors (must remain):
  //     - if !verdict.fixVerified || !verdict.bugConfirmed → cap at 30
  //     - if safety.widens && !diagnosis.widensAccess     → cap at 59 (force 'issue')
  //
  // Reference weights (mutable; tune in tests):
  //   replay_verdict_score     0.4
  //   diff_size_score          0.2
  //   policy_blast_score       0.2
  //   pgvector_similarity      0.2
  //
  // Tier thresholds: pr ≥85, draft_pr 60–84, issue <60.
  void input;
  throw new Error('not implemented');
}
