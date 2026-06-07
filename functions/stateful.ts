// functions/stateful.ts
// Stateful & multi-request bugs — detect, scope, and honestly decline.
//
// Ticket:  agents/tasks/0093-stateful-multistep-bugs.md
// Defends: ADR 0003 Risk 8 — the model assumes one failing request = the bug.
//          Many silent bugs are stateful: a sequence where a later step fails
//          because of state set in an earlier one. Single-request replay can't
//          reproduce these, and silently "fixing" the wrong request is worse than
//          abstaining.
//
// Pure, testable core: from a session window, decide whether the failing request
// depends on prior-request state; if the establishing requests are present and
// ordered, build a replay SEQUENCE; otherwise DECLINE to an issue with the full
// trace and a clear "stateful — needs a human" reason. Precision before recall.

import type { RequestLogEntry } from './types.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface SequenceAnalysis {
  stateful: boolean;
  /** Ordered requests to replay: establishing mutation(s) then the failing read. */
  sequence: RequestLogEntry[];
  /** True when the state can be deterministically reconstructed from the window. */
  reconstructable: boolean;
  reason: string;
}

export type StatefulAction = 'replay_single' | 'replay_sequence' | 'decline_to_issue';

export interface StatefulDecision {
  action: StatefulAction;
  sequence: RequestLogEntry[];
  reason: string;
}

/** First path segment, e.g. "/orders/42/items" → "orders". Resources relate by this. */
function resource(route: string): string {
  return (route.split('?')[0] ?? '').split('/').filter(Boolean)[0] ?? '';
}

/**
 * Analyze whether `failing` depends on earlier state in the same session window.
 * Heuristic on the data we have (method, route, ts): a GET that fails after a
 * same-resource mutation earlier in the session is stateful. Reconstructable iff
 * the establishing mutation(s) are present and ordered before it in the window.
 */
export function analyzeSequence(window: RequestLogEntry[], failing: RequestLogEntry): SequenceAnalysis {
  const ordered = [...window].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const failTime = Date.parse(failing.ts);
  const res = resource(failing.route);

  // Prior mutations in the session that touch the same resource family.
  const priorMutations = ordered.filter(
    (e) => e !== failing && Date.parse(e.ts) < failTime && MUTATING.has(e.method.toUpperCase()) && resource(e.route) === res,
  );

  // A read that fails with no prior mutation to the resource is the simple case.
  if (priorMutations.length === 0) {
    return { stateful: false, sequence: [failing], reconstructable: true, reason: 'no prior same-resource mutation — single-request bug' };
  }

  // There IS a state dependency. Can we reconstruct it from the window?
  // Reconstructable when every prior mutation succeeded (status < 400) and is in
  // the window in order — we can replay them, then the failing read.
  const reconstructable = priorMutations.every((m) => m.status < 400);
  const sequence = [...priorMutations, failing];

  return {
    stateful: true,
    sequence,
    reconstructable,
    reason: reconstructable
      ? `failing read depends on ${priorMutations.length} prior ${res} mutation(s) in-session — replay the sequence`
      : `failing read depends on prior ${res} state that did not cleanly establish (a mutation errored) — cannot safely reconstruct`,
  };
}

/**
 * Turn the analysis into an orchestrator action. Honest decline is the default
 * whenever state can't be reconstructed — never a confident single-request PR for
 * a stateful bug.
 */
export function decideStatefulHandling(analysis: SequenceAnalysis): StatefulDecision {
  if (!analysis.stateful) {
    return { action: 'replay_single', sequence: analysis.sequence, reason: analysis.reason };
  }
  if (analysis.reconstructable) {
    return { action: 'replay_sequence', sequence: analysis.sequence, reason: analysis.reason };
  }
  return {
    action: 'decline_to_issue',
    sequence: analysis.sequence,
    reason: `stateful — needs a human: ${analysis.reason}`,
  };
}
