// functions/prLifecycle.ts
// PR lifecycle management — Hush owns its PRs like a good teammate.
//
// Ticket:  agents/tasks/0067-pr-lifecycle-management.md
// Defends: an opened-and-abandoned PR rots. For Hush to be trusted, its PRs must
//          stay current, explain themselves, and clean up after themselves —
//          answer "what is this?" with the diagnosis/verdict, rebase on conflict,
//          re-verify when the base or policy moves, and auto-close stale PRs into
//          an issue. This is also where the merged/rejected signal for billing
//          (0058) and Memoir (0043) is captured.
//
// Pure, testable core: a reactive STATE MACHINE over GitHub PR webhook events that
// decides the next PR state + the action Hush should take, plus a stale-PR policy
// and idempotent event handling (webhook replays never double-act — ties to 0064).
// The actual webhook subscription, GitHub API calls, and the tracking table are
// the integration seam.

export type PrState =
  | 'open'                 // opened, awaiting review
  | 'changes_requested'    // a reviewer asked for changes
  | 'approved'             // approved, awaiting merge
  | 'merged'               // merged — terminal, record the win
  | 'closed'               // closed without merge — terminal, record the rejection
  | 'stale_closed';        // auto-closed past TTL — terminal, an issue was filed

export const PR_TERMINAL: ReadonlySet<PrState> = new Set(['merged', 'closed', 'stale_closed']);

export type PrEventKind =
  | 'review_submitted'     // a review came in (with a decision)
  | 'comment'              // a review/issue comment (maybe a question)
  | 'merged'
  | 'closed'
  | 'base_moved'           // the base branch advanced — may need a rebase
  | 'policy_changed';      // the underlying policy changed — re-verify the fix

export interface PrEvent {
  kind: PrEventKind;
  /** Stable webhook delivery id — for idempotent processing. */
  deliveryId: string;
  /** For review_submitted: the reviewer's decision. */
  decision?: 'approved' | 'changes_requested' | 'commented';
  /** For comment: is it a "what is this / why?" question Hush should answer? */
  isQuestion?: boolean;
  /** For policy_changed: does the bug still reproduce after the change? */
  bugStillPresent?: boolean;
  /** For base_moved: does the patch still apply cleanly? */
  conflicts?: boolean;
}

export type PrAction =
  | 'noop'
  | 'reply_with_diagnosis'        // answer a review question with diagnosis + verdict + confidence
  | 'rebase_and_reverify'         // base moved with conflicts — rebase, re-run the fork verdict
  | 'reverify_then_update'        // policy changed but bug remains — re-verify, update the PR
  | 'close_bug_gone'             // policy changed and the bug is gone — close the PR
  | 'record_merged'              // merged — outcome → Memoir + billing
  | 'record_rejected'           // closed unmerged — outcome → Memoir (learning signal)
  | 'auto_close_and_file_issue'; // stale past TTL — close + file an issue

export interface PrRecord {
  prId: string;
  state: PrState;
  /** ms epoch of the last activity on the PR — drives the stale policy. */
  lastActivityAt: number;
  /** Webhook delivery ids already processed — idempotency. */
  processedDeliveries: ReadonlySet<string>;
}

export interface Reaction {
  /** Whether this event was already processed (replay) — if so, action is noop. */
  duplicate: boolean;
  nextState: PrState;
  action: PrAction;
  /** Outcome to record, when the event is terminal. */
  outcome?: 'merged' | 'rejected';
  reason: string;
}

/**
 * React to a PR webhook event. Idempotent: a replayed delivery id is a no-op so
 * webhook retries never double-act (ticket 0064). Terminal states never transition.
 */
export function reactToEvent(record: PrRecord, event: PrEvent): Reaction {
  if (record.processedDeliveries.has(event.deliveryId)) {
    return { duplicate: true, nextState: record.state, action: 'noop', reason: `delivery ${event.deliveryId} already processed — idempotent no-op` };
  }
  if (PR_TERMINAL.has(record.state)) {
    return { duplicate: false, nextState: record.state, action: 'noop', reason: `PR already ${record.state} — terminal, ignoring ${event.kind}` };
  }

  switch (event.kind) {
    case 'merged':
      return { duplicate: false, nextState: 'merged', action: 'record_merged', outcome: 'merged', reason: 'PR merged — recording the win to Memoir + billing' };
    case 'closed':
      return { duplicate: false, nextState: 'closed', action: 'record_rejected', outcome: 'rejected', reason: 'PR closed unmerged — recording the rejection as a learning signal' };
    case 'review_submitted':
      if (event.decision === 'approved') {
        return { duplicate: false, nextState: 'approved', action: 'noop', reason: 'review approved — awaiting merge' };
      }
      if (event.decision === 'changes_requested') {
        return { duplicate: false, nextState: 'changes_requested', action: 'reply_with_diagnosis', reason: 'changes requested — replying with the diagnosis/verdict/confidence' };
      }
      return { duplicate: false, nextState: record.state, action: 'noop', reason: 'review comment with no decision — no state change' };
    case 'comment':
      return event.isQuestion
        ? { duplicate: false, nextState: record.state, action: 'reply_with_diagnosis', reason: 'review question — answering with diagnosis + prod/fork verdict + confidence breakdown' }
        : { duplicate: false, nextState: record.state, action: 'noop', reason: 'non-question comment — no action' };
    case 'base_moved':
      return event.conflicts
        ? { duplicate: false, nextState: record.state, action: 'rebase_and_reverify', reason: 'base advanced with conflicts — rebasing and re-running the fork verdict' }
        : { duplicate: false, nextState: record.state, action: 'noop', reason: 'base advanced, patch still applies cleanly — no action' };
    case 'policy_changed':
      return event.bugStillPresent === false
        ? { duplicate: false, nextState: 'closed', action: 'close_bug_gone', reason: 'policy changed and the bug is gone — closing the now-unnecessary PR' }
        : { duplicate: false, nextState: record.state, action: 'reverify_then_update', reason: 'policy changed but bug remains — re-verifying and updating the PR' };
  }
}

// ── stale-PR policy ────────────────────────────────────────────────────────────────

export interface StaleDecision {
  stale: boolean;
  action: PrAction;
  reason: string;
}

/** Default: a Hush PR unreviewed for 14 days is stale. Workspace-configurable. */
export const DEFAULT_STALE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * A Hush PR that sits unreviewed past the workspace TTL is auto-closed and an issue
 * is filed in its place — Hush cleans up after itself rather than leaving rot. Only
 * non-terminal, not-yet-approved PRs go stale (an approved PR is awaiting a human
 * merge, not ignored).
 */
export function staleDecision(record: PrRecord, nowMs: number, ttlMs: number = DEFAULT_STALE_TTL_MS): StaleDecision {
  if (PR_TERMINAL.has(record.state) || record.state === 'approved') {
    return { stale: false, action: 'noop', reason: `PR is ${record.state} — not subject to the stale policy` };
  }
  const idleMs = nowMs - record.lastActivityAt;
  if (idleMs <= ttlMs) {
    return { stale: false, action: 'noop', reason: `PR idle ${Math.round(idleMs / 86_400_000)}d, within the ${Math.round(ttlMs / 86_400_000)}d TTL` };
  }
  return { stale: true, action: 'auto_close_and_file_issue', reason: `PR unreviewed ${Math.round(idleMs / 86_400_000)}d past the ${Math.round(ttlMs / 86_400_000)}d TTL — auto-closing and filing an issue` };
}
