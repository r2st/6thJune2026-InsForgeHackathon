// functions/reviewGate.ts
// Human-in-the-loop review gate + feedback→confidence learning.
//
// Ticket:  agents/tasks/0068-human-in-the-loop-feedback.md
// Defends: teams don't grant an agent write-access on day one. A review step is how
//          trust is earned — and the captured approve/reject is the HIGHEST-signal
//          training data for Memoir (sharper than the merge/close signal alone).
//          Hush proves value in observe-only, then lets humans approve the first
//          draft/fix path before the workspace graduates to auto-PR.
//
// Pure, testable core: a per-workspace AUTONOMY setting gates whether a run needs
// human review before shipping (graduated trust, monotonic), and a customer's
// decision (approve / edit / reject-with-category) maps to a LEARNING SIGNAL that
// raises or lowers confidence on similar future bugs. Edited diffs always demand
// re-validation (safety + fork replay) before they can ship. The review surface,
// the Memoir write, and the autonomy setting in toml are the integration seam.

export type Autonomy = 'review-all' | 'review-medium-only' | 'auto-PR-high';

/** The confidence tier a run earned (matches workspaceMode/score). */
export type DispatchTier = 'pr' | 'draft_pr' | 'issue';

/** Production default — review first, earn autonomy. */
export const DEFAULT_AUTONOMY: Autonomy = 'review-all';

/**
 * Does this run need a human review before it can ship, given the workspace's
 * autonomy? Monotonic by trust:
 *   - review-all        → review every actionable run (high AND medium)
 *   - review-medium-only→ auto-ship high-confidence (pr); review medium (draft_pr)
 *   - auto-PR-high      → auto-ship without review; nothing actionable is gated
 * An `issue` is never gated — filing an issue is not a write to the customer's code.
 */
export function requiresReview(autonomy: Autonomy, tier: DispatchTier): boolean {
  if (tier === 'issue') return false;
  switch (autonomy) {
    case 'review-all': return true;                       // both pr and draft_pr
    case 'review-medium-only': return tier === 'draft_pr'; // pr auto-ships, medium reviewed
    case 'auto-PR-high': return false;                    // nothing gated
  }
}

// ── decision → learning signal ───────────────────────────────────────────────────

export type DecisionKind = 'approve' | 'edit' | 'reject';
export type RejectCategory = 'not_a_bug' | 'wrong_fix' | 'out_of_scope';

export interface ReviewDecision {
  kind: DecisionKind;
  /** Required when kind === 'reject' — sharpens the prompt + confidence model. */
  rejectCategory?: RejectCategory;
  /** Present when the reviewer edited the diff before approving. */
  edited?: boolean;
}

export type MemoirPolarity = 'raise' | 'lower' | 'neutral';

export interface LearningSignal {
  /** Signed confidence nudge applied to SIMILAR future bugs (Memoir prior). */
  confidenceDelta: number;
  polarity: MemoirPolarity;
  /** True ⇒ the proposed fix must be re-validated (safety + fork replay) before ship. */
  needsRevalidation: boolean;
  /** True ⇒ this run may ship (after re-validation if required). */
  shipApproved: boolean;
  reason: string;
}

/**
 * Map a review decision to a Memoir learning signal. An approve is the strongest
 * positive; an edit is mildly positive (the diagnosis was close, the human refined
 * it) but the edited diff must be re-validated. Rejections are categorized so the
 * loss lands on the right model: `not_a_bug` is a detection false-positive (lower
 * hard — this is the existential precision signal), `wrong_fix` keeps the bug but
 * penalizes the fix, `out_of_scope` is a policy preference, not a quality miss
 * (near-neutral so we don't punish correct-but-unwanted diagnoses).
 */
export function decisionToLearning(decision: ReviewDecision): LearningSignal {
  switch (decision.kind) {
    case 'approve':
      return {
        confidenceDelta: +10, polarity: 'raise', needsRevalidation: false, shipApproved: true,
        reason: 'approved — raises confidence on similar future bugs',
      };
    case 'edit':
      return {
        confidenceDelta: +4, polarity: 'raise', needsRevalidation: true, shipApproved: true,
        reason: 'approved with edits — mild positive; edited diff must be re-validated (safety + fork replay) before ship',
      };
    case 'reject': {
      const cat = decision.rejectCategory ?? 'wrong_fix';
      switch (cat) {
        case 'not_a_bug':
          return { confidenceDelta: -15, polarity: 'lower', needsRevalidation: false, shipApproved: false, reason: 'rejected (not a bug) — detection false positive, lowers confidence hard on similar signals' };
        case 'wrong_fix':
          return { confidenceDelta: -10, polarity: 'lower', needsRevalidation: false, shipApproved: false, reason: 'rejected (wrong fix) — bug stands but the fix was wrong; penalizes the fix model' };
        case 'out_of_scope':
          return { confidenceDelta: -2, polarity: 'neutral', needsRevalidation: false, shipApproved: false, reason: 'rejected (out of scope) — a policy preference, not a quality miss; near-neutral' };
      }
    }
  }
}

/**
 * Whether a decision's run may proceed to ship. Pulls the two gates together:
 * the human approved, AND if they edited the diff it has been re-validated. A
 * caller passes `revalidated` only after re-running safety + the fork verdict.
 */
export function canShipAfterReview(decision: ReviewDecision, revalidated: boolean): { ship: boolean; reason: string } {
  const signal = decisionToLearning(decision);
  if (!signal.shipApproved) return { ship: false, reason: signal.reason };
  if (signal.needsRevalidation && !revalidated) {
    return { ship: false, reason: 'edited diff not yet re-validated — re-run safety + fork replay before shipping' };
  }
  return { ship: true, reason: signal.needsRevalidation ? 'approved with edits, re-validated — clear to ship' : 'approved — clear to ship' };
}
