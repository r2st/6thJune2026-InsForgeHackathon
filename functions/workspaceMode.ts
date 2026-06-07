// functions/workspaceMode.ts
// Observe-only / dry-run mode + graduated-trust dispatch gate.
//
// Ticket:  agents/tasks/0070-observe-only-dry-run-mode.md
// Defends: no team flips on an autonomous code-fixer cold. The production default
//          must be OBSERVE-only — the full loop runs and shows what it *would*
//          ship, but never touches the repo — until the customer has seen real
//          findings and explicitly graduated Hush to draft, then auto PRs. This is
//          a first-customer blocker, not polish.
//
// Pure, testable core: a per-workspace `mode` (observe → draft → auto) gates the
// FINAL dispatch. `observe` makes ship a no-op-with-record (dashboard only);
// `draft` caps every output at a draft PR; `auto` honors the confidence tier.
// Graduation is a simple, reversible rank transition. This sits AFTER triage
// (0087) and scoring — it never bypasses the noise budget or the safety rail; it
// only ever makes dispatch MORE conservative, never less. Wiring the gate into
// fix-trigger.ts's ship stage + the workspace mode in toml is the seam.

export type WorkspaceMode = 'observe' | 'draft' | 'auto';

/** The dispatch tier a run earned from confidence/scope, before the mode gate. */
export type DispatchTier = 'pr' | 'draft_pr' | 'issue';

/** The action actually taken after the mode gate. */
export type DispatchAction = 'record_only' | 'open_issue' | 'open_draft_pr' | 'open_pr';

export interface GateResult {
  action: DispatchAction;
  /** True when `ship` must be a no-op that only records the would-be fix. */
  shipIsNoOp: boolean;
  /** The tier the run earned, before the mode gate clamped it — for the receipt. */
  earnedTier: DispatchTier;
  reason: string;
}

/** Production default. A brand-new workspace watches only until it graduates. */
export const DEFAULT_MODE: WorkspaceMode = 'observe';

const RANK: Record<WorkspaceMode, number> = { observe: 0, draft: 1, auto: 2 };

/**
 * Gate the earned dispatch tier through the workspace mode. The mode can only ever
 * make dispatch MORE conservative:
 *   - observe → record_only (no repo writes at all; ship is a no-op-with-record)
 *   - draft   → a would-be PR becomes a draft PR; issues stay issues
 *   - auto    → the confidence-tiered action, as earned
 * In every mode the full loop (capture→diagnose→fork-test→score) has already run;
 * this only decides what reaches the repo.
 */
export function gateDispatch(mode: WorkspaceMode, earnedTier: DispatchTier): GateResult {
  if (mode === 'observe') {
    return {
      action: 'record_only', shipIsNoOp: true, earnedTier,
      reason: `observe mode — would have ${describeTier(earnedTier)}; recorded for the dashboard, repo untouched`,
    };
  }
  if (mode === 'draft') {
    if (earnedTier === 'issue') {
      return { action: 'open_issue', shipIsNoOp: false, earnedTier, reason: 'draft mode — bug shape routes to an issue' };
    }
    return {
      action: 'open_draft_pr', shipIsNoOp: false, earnedTier,
      reason: earnedTier === 'pr' ? 'draft mode — PR-worthy fix capped to a draft PR for review' : 'draft mode — draft PR',
    };
  }
  // auto — honor the earned tier
  switch (earnedTier) {
    case 'pr': return { action: 'open_pr', shipIsNoOp: false, earnedTier, reason: 'auto mode — confident fix opens a PR' };
    case 'draft_pr': return { action: 'open_draft_pr', shipIsNoOp: false, earnedTier, reason: 'auto mode — medium-confidence fix opens a draft PR' };
    case 'issue': return { action: 'open_issue', shipIsNoOp: false, earnedTier, reason: 'auto mode — low-confidence routes to an issue' };
  }
}

// ── graduation ─────────────────────────────────────────────────────────────────────

export type ModeChange = 'upgrade' | 'downgrade' | 'noop';

/** observe(0) < draft(1) < auto(2). */
export function modeRank(mode: WorkspaceMode): number { return RANK[mode]; }

/** Human phrase for what an earned tier would have done — for the observe-mode receipt. */
function describeTier(tier: DispatchTier): string {
  return tier === 'pr' ? 'opened a PR' : tier === 'draft_pr' ? 'opened a draft PR' : 'opened an issue';
}

export function classifyChange(from: WorkspaceMode, to: WorkspaceMode): ModeChange {
  const d = RANK[to] - RANK[from];
  return d > 0 ? 'upgrade' : d < 0 ? 'downgrade' : 'noop';
}

export interface GraduationDecision {
  allowed: boolean;
  change: ModeChange;
  reason: string;
}

/**
 * Graduation is one click and reversible. Upgrading one step at a time is the
 * intended path (observe→draft→auto); skipping a step (observe→auto) is allowed
 * but flagged so the UI can warn ("you haven't tried draft yet"). Downgrades and
 * no-ops are always allowed — a customer can pull back to safety at any time.
 */
export function decideGraduation(from: WorkspaceMode, to: WorkspaceMode): GraduationDecision {
  const change = classifyChange(from, to);
  if (change === 'noop') return { allowed: true, change, reason: `already in ${from} mode` };
  if (change === 'downgrade') return { allowed: true, change, reason: `downgrade ${from}→${to} — always allowed, pull back to safety anytime` };
  const skipped = RANK[to] - RANK[from] > 1;
  return {
    allowed: true,
    change,
    reason: skipped
      ? `upgrade ${from}→${to} skips a step — allowed, but consider trying draft mode first`
      : `upgrade ${from}→${to} — one step up as trust builds`,
  };
}
