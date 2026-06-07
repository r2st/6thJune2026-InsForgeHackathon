// functions/regressionWatch.ts
// Auto-rollback & post-fix regression detection — Hush can never quietly break prod.
//
// Ticket:  agents/tasks/0069-auto-rollback-regression-detection.md
// Defends: the scariest objection to an agent that ships code is "what if its fix
//          is wrong?". The pre-merge safety rail is necessary but not sufficient —
//          the answer must include POST-merge monitoring and a fast automatic undo.
//
// Pure, testable core: after a fix merges, we watch the same (policy, route) and
// compare a baseline window to a post-merge window. A regression is any of:
// frustration signals rose, a NEW empty/wrong-row request shape appeared, a
// safety-rail violation slipped through, or the differential suite shows the fix
// WIDENED access on other tenants/queries. On regression we propose a revert
// (PR or draft, per workspace config); a fix that merely fails to *help*
// (frustration unchanged, no hard regression) is flagged as ineffective, not
// reverted. The scheduled watcher + replay re-run are the integration seam.

export type RegressionKind =
  | 'frustration_rise'    // signals per session went up on the watched route
  | 'new_failing_shape'   // an empty/wrong-row request shape that did not exist pre-merge
  | 'safety_violation'    // a widening that slipped past the pre-merge rail
  | 'access_widened';     // differential suite: fork now exposes rows prod didn't

export type RegressionSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

/**
 * Two windows of the same (policy, route): the baseline captured before/at merge
 * and the post-merge window the scheduler just closed. Counts only — no raw rows.
 */
export interface RegressionWindow {
  policy: string;
  route: string;
  /** Sessions observed in each window — the denominator for the frustration rate. */
  sessionsBefore: number;
  sessionsAfter: number;
  /** Frustration signals (rage/dead-click/abandon) seen in each window. */
  frustrationBefore: number;
  frustrationAfter: number;
  /** Normalized failing request shapes present in each window. */
  failingShapesBefore: string[];
  failingShapesAfter: string[];
  /** A safety-rail violation observed live post-merge (widening that slipped through). */
  safetyViolation: boolean;
  /** Re-run differential suite (ticket 0033): fork exposed rows on OTHER tenants. */
  accessWidened: boolean;
}

export interface RegressionFinding {
  regressed: boolean;
  kinds: RegressionKind[];
  severity: RegressionSeverity;
  /** A new failing request shape, when one appeared — evidence for the revert PR. */
  newShapes: string[];
  reason: string;
}

/**
 * Minimum relative rise in the per-session frustration rate that counts as a
 * regression. A little noise is expected; a 50% jump on a watched route is not.
 */
const FRUSTRATION_RISE_THRESHOLD = 0.5;

/** Per-session frustration rate, guarding divide-by-zero. */
export function frustrationRate(signals: number, sessions: number): number {
  return sessions > 0 ? signals / sessions : 0;
}

/**
 * Detect whether the post-merge window regressed vs. baseline. Security regressions
 * (safety violation, access widening) dominate severity — they are critical even
 * with low volume, because a leak does not need many sessions to matter.
 */
export function detectRegression(w: RegressionWindow): RegressionFinding {
  const kinds: RegressionKind[] = [];

  const before = frustrationRate(w.frustrationBefore, w.sessionsBefore);
  const after = frustrationRate(w.frustrationAfter, w.sessionsAfter);
  // Only a meaningful sample after merge counts — 1 session can't establish a rise.
  if (w.sessionsAfter >= 5 && after > before * (1 + FRUSTRATION_RISE_THRESHOLD) && after > before) {
    kinds.push('frustration_rise');
  }

  const beforeShapes = new Set(w.failingShapesBefore.map(norm));
  const newShapes = uniq(w.failingShapesAfter.map(norm).filter((s) => !beforeShapes.has(s)));
  if (newShapes.length > 0) kinds.push('new_failing_shape');

  if (w.safetyViolation) kinds.push('safety_violation');
  if (w.accessWidened) kinds.push('access_widened');

  const severity = regressionSeverity(kinds, before, after);
  return {
    regressed: kinds.length > 0,
    kinds,
    severity,
    newShapes,
    reason: kinds.length === 0
      ? 'no regression — frustration steady, no new failing shapes, no widening'
      : describe(kinds, before, after, newShapes),
  };
}

/** Security regressions dominate; behavioral regressions scale with the rate jump. */
export function regressionSeverity(kinds: RegressionKind[], before: number, after: number): RegressionSeverity {
  if (kinds.includes('safety_violation') || kinds.includes('access_widened')) return 'critical';
  if (kinds.length === 0) return 'none';
  if (kinds.includes('new_failing_shape')) return 'high'; // the fix introduced a new broken shape
  // frustration-only: scale with how big the jump was.
  const ratio = before > 0 ? after / before : after > 0 ? Infinity : 1;
  if (ratio >= 3) return 'high';
  if (ratio >= 2) return 'medium';
  return 'low';
}

// ── rollback decision ──────────────────────────────────────────────────────────────

export type WorkspaceMode = 'auto_revert' | 'alert_only';
export type RollbackAction = 'revert_pr' | 'revert_draft' | 'alert' | 'none';

export interface RollbackDecision {
  action: RollbackAction;
  reason: string;
}

/**
 * Turn a finding into an action, honoring the workspace's auto-revert vs alert-only
 * config. A security regression always at least drafts a revert even in alert-only
 * mode (you don't sit on a live leak); behavioral regressions respect the mode.
 */
export function decideRollback(finding: RegressionFinding, mode: WorkspaceMode): RollbackDecision {
  if (!finding.regressed) return { action: 'none', reason: finding.reason };

  const security = finding.kinds.includes('safety_violation') || finding.kinds.includes('access_widened');
  if (security) {
    // Never leave a live security regression un-actioned. Auto mode reverts; even
    // alert-only opens a draft revert so a human has a one-click undo waiting.
    return mode === 'auto_revert'
      ? { action: 'revert_pr', reason: `critical security regression (${finding.kinds.join(', ')}) — auto-revert PR opened` }
      : { action: 'revert_draft', reason: `critical security regression (${finding.kinds.join(', ')}) — draft revert prepared for human` };
  }
  if (mode === 'auto_revert') {
    return { action: 'revert_pr', reason: `${finding.severity} regression (${finding.kinds.join(', ')}) — auto-revert PR opened` };
  }
  return { action: 'alert', reason: `${finding.severity} regression (${finding.kinds.join(', ')}) — alert raised, no auto-revert (alert-only mode)` };
}

// ── effectiveness (ties to outcome measurement, ticket 0071) ────────────────────────

/**
 * A fix can be a non-regression yet still useless: frustration on the route did not
 * drop after the merge. That's not a revert, but it should be flagged so the model's
 * calibration and the customer's trust account for it. Needs a meaningful sample.
 */
export function isIneffective(w: RegressionWindow, finding: RegressionFinding): boolean {
  if (finding.regressed) return false; // a regression is a different, worse thing
  if (w.sessionsAfter < 5) return false; // not enough signal to judge
  const before = frustrationRate(w.frustrationBefore, w.sessionsBefore);
  const after = frustrationRate(w.frustrationAfter, w.sessionsAfter);
  // "Reduced frustration" = at least a 20% relative drop. Anything less = ineffective.
  return before > 0 && after >= before * 0.8;
}

// ── helpers ──────────────────────────────────────────────────────────────────────

function norm(s: string): string { return s.replace(/\s+/g, ' ').trim().toLowerCase(); }
function uniq(xs: string[]): string[] { return [...new Set(xs)]; }
function describe(kinds: RegressionKind[], before: number, after: number, newShapes: string[]): string {
  const bits: string[] = [];
  if (kinds.includes('frustration_rise')) bits.push(`frustration ${before.toFixed(2)}→${after.toFixed(2)}/session`);
  if (kinds.includes('new_failing_shape')) bits.push(`${newShapes.length} new failing shape(s)`);
  if (kinds.includes('safety_violation')) bits.push('safety-rail violation slipped through');
  if (kinds.includes('access_widened')) bits.push('fix widened access on other tenants');
  return `regression: ${bits.join('; ')}`;
}
