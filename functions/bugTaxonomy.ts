// functions/bugTaxonomy.ts
// Generalize the bug surface — classify the bug class and gate what's safe to fix.
//
// Ticket:  agents/tasks/0062-generalize-bug-surface.md
// Defends: the demo hardcodes one bug (the `orders_select` JWT-claim RLS misfire) —
//          expected-row count, table, claim shape, all constants. A product meets
//          bugs it hasn't seen. The pipeline must DERIVE the bug class from the run
//          and know which classes it can safely auto-fix versus which it must
//          escalate to a human issue ("can't safely fix this").
//
// Pure, testable core: from generalized run signals (row deltas, policy/claim
// presence, cross-tenant evidence, joins, auth-config drift) classify the bug into
// a taxonomy, then decide the dispatch SCOPE per class — deny-by-default on
// anything outside the proven-safe set, and route over-permissive/leak classes to
// the canary path (ticket 0088) rather than a frustration-triggered auto-fix.
// The expected-row oracle lives in oracle.ts; this module is classification + scope.

export type BugClass =
  | 'rls_filter_misfire'      // policy predicate drops rows it shouldn't (the demo case)
  | 'stale_jwt_claim'         // policy keys on a claim that's missing/renamed in the token
  | 'over_restrictive_policy' // policy is too narrow — legitimate rows hidden
  | 'over_permissive_leak'    // policy is too broad — cross-tenant rows exposed
  | 'policy_regression_join'  // a multi-table/join policy regressed visibility
  | 'auth_config_drift'       // live auth config diverged from the repo (not a row bug)
  | 'unknown';                // unclassifiable from the signals — escalate

/** Generalized, source-agnostic signals — derived from the run, not constants. */
export interface BugSignals {
  rowsBefore: number;          // pre-RLS row count (policy evidence; ticket 0086)
  rowsAfter: number;           // post-RLS rows the user actually got
  status: number;              // HTTP status of the failing request
  hasNamedPolicy: boolean;     // a "<table>.<policy>" was identified
  /** The auth claim the policy keys on is absent/renamed in the live token. */
  jwtClaimMissing: boolean;
  /** Canary/probe evidence the principal saw rows it does not own. */
  crossTenantRowsSeen: boolean;
  /** The failing query joins across tables (multi-table policy surface). */
  involvesJoin: boolean;
  /** Live insforge.toml auth/policy config drifted from the repo (ticket 0060/tomlDrift). */
  authConfigDrift: boolean;
}

export interface Classification {
  bugClass: BugClass;
  /** Other plausible classes, for the receipt — classification is not always crisp. */
  alternatives: BugClass[];
  reason: string;
}

/**
 * Classify the bug from the signals. Order matters: a cross-tenant leak is the most
 * dangerous and is checked first (it must never be treated as a vanished-row fix);
 * auth-config drift is structural, not a row bug; then the row-delta shapes.
 */
export function classifyBug(s: BugSignals): Classification {
  const alternatives: BugClass[] = [];

  // 1. Leak dominates — extra rows visible / cross-tenant evidence.
  if (s.crossTenantRowsSeen || (s.status < 300 && s.rowsAfter > s.rowsBefore)) {
    return { bugClass: 'over_permissive_leak', alternatives, reason: 'cross-tenant rows visible / post-RLS count exceeds pre-RLS — over-permissive policy (leak)' };
  }

  // 2. Auth-config drift — structural divergence, handle before row shapes.
  if (s.authConfigDrift) {
    return { bugClass: 'auth_config_drift', alternatives, reason: 'live auth/policy config drifted from the repo — not a row-count bug' };
  }

  // 3. Vanished-rows family (the silent-failure core): rows existed pre-RLS, user got fewer.
  const vanished = s.rowsBefore > s.rowsAfter;
  if (vanished && s.hasNamedPolicy) {
    if (s.jwtClaimMissing) {
      alternatives.push('rls_filter_misfire');
      return { bugClass: 'stale_jwt_claim', alternatives, reason: 'policy keys on a JWT claim that is missing/renamed in the token — rows dropped' };
    }
    if (s.involvesJoin) {
      alternatives.push('rls_filter_misfire');
      return { bugClass: 'policy_regression_join', alternatives, reason: 'multi-table/join policy dropped rows — join-path regression' };
    }
    alternatives.push('over_restrictive_policy');
    return { bugClass: 'rls_filter_misfire', alternatives, reason: 'named RLS policy filtered rows that existed pre-RLS — filter misfire' };
  }
  if (vanished && !s.hasNamedPolicy) {
    return { bugClass: 'over_restrictive_policy', alternatives, reason: 'rows hidden but no single policy identified — likely over-restrictive, needs more evidence' };
  }

  return { bugClass: 'unknown', alternatives, reason: 'signals do not match a known bug class — escalate' };
}

// ── scope gate: what can we safely auto-fix? ────────────────────────────────────────

export type ScopeTier = 'pr' | 'draft_pr' | 'issue';

export interface ScopeDecision {
  /** The strictest tier this bug class may reach, regardless of model confidence. */
  ceiling: ScopeTier;
  /** False ⇒ Hush must not propose a code fix — escalate to a human issue. */
  autoFixable: boolean;
  reason: string;
}

/**
 * Deny-by-default scope per bug class. The proven-safe auto-fix set is the
 * narrow-the-data-OUT-of-hiding classes (filter misfire, stale claim) where the
 * fix only RESTORES legitimately-owned rows. Anything that WIDENS access
 * (over-permissive leak) or is ambiguous/structural is capped at draft or issue —
 * a human decides. This generalizes the existing self-escalation route.
 */
export function scopeFor(bugClass: BugClass, oracleAbstained: boolean): ScopeDecision {
  // If the expectation oracle abstained, we don't even know it's a bug — issue only.
  if (oracleAbstained) {
    return { ceiling: 'issue', autoFixable: false, reason: 'expectation oracle abstained — not confidently a bug; route to issue' };
  }
  switch (bugClass) {
    case 'rls_filter_misfire':
    case 'stale_jwt_claim':
      // Proven-safe: the fix restores the user's own hidden rows. Full tier allowed.
      return { ceiling: 'pr', autoFixable: true, reason: `${bugClass}: fix restores legitimately-owned rows — auto-fixable to PR` };
    case 'over_restrictive_policy':
      // Plausibly safe but less crisp without a named policy — cap at draft.
      return { ceiling: 'draft_pr', autoFixable: true, reason: 'over-restrictive policy: likely safe but evidence is softer — cap at draft PR' };
    case 'policy_regression_join':
      // Joins fan out; a fix can widen visibility through indirection — human glance.
      return { ceiling: 'draft_pr', autoFixable: true, reason: 'join-path regression: widening risk through indirection — cap at draft PR' };
    case 'over_permissive_leak':
      // Security boundary. Never a frustration-triggered auto-PR — canary path + human.
      return { ceiling: 'issue', autoFixable: false, reason: 'over-permissive leak: security boundary — route to canary probes (0088) + human review' };
    case 'auth_config_drift':
      // Not a code diff Hush should silently apply — surface the drift to a human.
      return { ceiling: 'issue', autoFixable: false, reason: 'auth-config drift: surface to a human, not an auto-applied code fix' };
    case 'unknown':
    default:
      return { ceiling: 'issue', autoFixable: false, reason: 'unclassified bug shape — deny-by-default, escalate to issue' };
  }
}

/** Convenience: classify + scope in one call. */
export function assessBug(s: BugSignals, oracleAbstained: boolean): { classification: Classification; scope: ScopeDecision } {
  const classification = classifyBug(s);
  const scope = scopeFor(classification.bugClass, oracleAbstained);
  return { classification, scope };
}
