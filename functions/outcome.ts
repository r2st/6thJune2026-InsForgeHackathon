// functions/outcome.ts
// Outcome measurement — did the fix actually reduce frustration? Close the loop.
//
// Ticket:  agents/tasks/0071-outcome-measurement.md
// Defends: "we opened a PR" is an OUTPUT; "the customer stopped leaving" is the
//          OUTCOME that justifies the product. It also closes the learning loop
//          honestly — a fix that merges but doesn't move the signal is a weak fix,
//          and a high-confidence fix with no impact is a calibration signal.
//
// Pure, testable core: for a shipped fix, compare the targeted signal's rate in a
// baseline window vs a post-fix window with a real two-proportion z-test, so the
// "impact" verdict is statistically honest — and explicitly returns
// `inconclusive` when traffic is too thin rather than fabricating a number. A
// workspace-level ROI rollup aggregates frustration averted and likely support
// tickets avoided. The scheduled aggregator + dashboard view are the seam.

export type ImpactVerdict = 'improved' | 'no_change' | 'worsened' | 'inconclusive';

/** One window's count of the targeted signal out of N observations (sessions/requests). */
export interface SignalWindow {
  /** Signal occurrences (rage-clicks, empty results, errors) in the window. */
  count: number;
  /** Total observations (sessions or requests) — the denominator. */
  total: number;
}

export interface ImpactResult {
  verdict: ImpactVerdict;
  rateBefore: number;
  rateAfter: number;
  /** Relative reduction in the rate: (before - after) / before. Negative = got worse. */
  relativeReduction: number;
  /** Two-proportion z statistic; |z| ≥ 1.96 ⇒ p < 0.05. Null when inconclusive. */
  z: number | null;
  significant: boolean;
  reason: string;
}

/** Below this many post-fix observations we never claim an impact — too little traffic. */
export const MIN_OBSERVATIONS = 30;

/**
 * Compare the targeted signal before vs after the fix. Honest by construction:
 * with too few observations we return `inconclusive` and never invent a number;
 * otherwise a two-proportion z-test decides whether the change is real, and the
 * sign of the rate delta decides improved vs worsened.
 */
export function measureImpact(before: SignalWindow, after: SignalWindow): ImpactResult {
  const rateBefore = rate(before);
  const rateAfter = rate(after);
  const relativeReduction = rateBefore > 0 ? (rateBefore - rateAfter) / rateBefore : (rateAfter > 0 ? -Infinity : 0);

  if (before.total < MIN_OBSERVATIONS || after.total < MIN_OBSERVATIONS) {
    return {
      verdict: 'inconclusive', rateBefore, rateAfter, relativeReduction, z: null, significant: false,
      reason: `inconclusive — too little traffic (need ≥${MIN_OBSERVATIONS} obs/window, had ${before.total}/${after.total})`,
    };
  }

  const z = twoProportionZ(before, after);
  const significant = Math.abs(z) >= 1.96;
  if (!significant) {
    return {
      verdict: 'no_change', rateBefore, rateAfter, relativeReduction, z, significant: false,
      reason: `no statistically significant change (z=${z.toFixed(2)}, |z|<1.96)`,
    };
  }
  if (rateAfter < rateBefore) {
    return {
      verdict: 'improved', rateBefore, rateAfter, relativeReduction, z, significant: true,
      reason: `signal fell ${(relativeReduction * 100).toFixed(0)}% (${rateBefore.toFixed(3)}→${rateAfter.toFixed(3)}, z=${z.toFixed(2)})`,
    };
  }
  return {
    verdict: 'worsened', rateBefore, rateAfter, relativeReduction, z, significant: true,
    reason: `signal ROSE significantly (${rateBefore.toFixed(3)}→${rateAfter.toFixed(3)}, z=${z.toFixed(2)})`,
  };
}

/**
 * Two-proportion z-test statistic for H0: p_before = p_after. Pooled variance.
 * Positive z ⇒ before-rate higher than after (improvement). Returns 0 when both
 * windows are empty (no signal at all — nothing to compare).
 */
export function twoProportionZ(before: SignalWindow, after: SignalWindow): number {
  const n1 = before.total, n2 = after.total;
  if (n1 === 0 || n2 === 0) return 0;
  const p1 = before.count / n1, p2 = after.count / n2;
  const pPool = (before.count + after.count) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (se === 0) return 0; // no variance (e.g. both 0% or both 100%) — no detectable difference
  return (p1 - p2) / se;
}

// ── learning signal (feeds confidence/Memoir + regression watch) ────────────────────

/**
 * A high-confidence fix that shipped but produced no measurable improvement is a
 * calibration signal — the model was sure and wrong about impact. Returns true so
 * [[0043]]/[[0069]] can down-weight that pattern. `inconclusive` is NOT a learning
 * signal (we simply don't know yet).
 */
export function isCalibrationMiss(confidence: number, impact: ImpactResult): boolean {
  if (impact.verdict === 'inconclusive') return false;
  const highConfidence = confidence >= 80;
  return highConfidence && (impact.verdict === 'no_change' || impact.verdict === 'worsened');
}

// ── workspace ROI rollup ────────────────────────────────────────────────────────────

export interface FixOutcome {
  runId: string;
  shipped: boolean;
  impact: ImpactResult;
  /** Targeted signal occurrences in the baseline window — the "before" volume. */
  baselineSignalCount: number;
}

export interface RoiRollup {
  bugsCaught: number;
  fixesShipped: number;
  fixesWithProvenImpact: number;
  /** Sum of baseline signal volume on fixes that significantly improved. */
  frustrationAverted: number;
  /** Heuristic: a fraction of averted frustration that would have become tickets. */
  supportTicketsLikelyAvoided: number;
  inconclusive: number;
}

/** Fraction of averted frustration events assumed to have escalated to a ticket. */
const TICKET_ESCALATION_RATE = 0.1;

/**
 * Roll fix outcomes up to a workspace ROI summary. Only fixes with a *proven*
 * (significant `improved`) impact contribute to frustration-averted — we never
 * count an inconclusive or unproven fix as ROI. Honest numbers only.
 */
export function workspaceRoi(outcomes: FixOutcome[]): RoiRollup {
  let fixesShipped = 0, proven = 0, averted = 0, inconclusive = 0;
  for (const o of outcomes) {
    if (o.shipped) fixesShipped += 1;
    if (o.impact.verdict === 'inconclusive') inconclusive += 1;
    if (o.shipped && o.impact.verdict === 'improved' && o.impact.significant) {
      proven += 1;
      // Frustration averted ≈ baseline volume scaled by the proven relative reduction.
      averted += Math.max(0, Math.round(o.baselineSignalCount * clamp01(o.impact.relativeReduction)));
    }
  }
  return {
    bugsCaught: outcomes.length,
    fixesShipped,
    fixesWithProvenImpact: proven,
    frustrationAverted: averted,
    supportTicketsLikelyAvoided: Math.round(averted * TICKET_ESCALATION_RATE),
    inconclusive,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────────

function rate(w: SignalWindow): number { return w.total > 0 ? w.count / w.total : 0; }
function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }
