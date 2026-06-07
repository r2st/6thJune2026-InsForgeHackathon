// functions/canaryProbes.ts
// Canary policy probes — proactive detection of silent LEAKS / over-permissive RLS.
//
// Ticket:  agents/tasks/0088-canary-policy-probes-for-silent-leaks.md
// Defends: the behavioral trigger (rage-click → vanished rows) catches *missing*
//          data well. Leaks are the opposite and silent: a user who briefly sees
//          someone else's row rarely rage-clicks. If Hush claims it catches leaked
//          tenants and over-permissive RLS, it needs a PROACTIVE path — scheduled
//          canary principals that try to read across the tenant boundary and prove
//          they can't. This complements 0087, it does not replace it.
//
// Pure, testable core: a probe pairs a canary PRINCIPAL (a synthetic tenant/claim
// owning known fixture ids) with a TARGET (route / count / join / object url). We
// run it and compare what it OBSERVED against what it should own. Any foreign id
// it can see is cross-tenant evidence of a leak. Severity scales with how many
// foreign ids / how broad the surface; dispatch is conservative — a widening fix
// routes to draft/human unless the blast radius is demonstrably tiny. Privacy:
// the core takes only ids/counts, never raw customer rows.

export type ProbeKind = 'neighbor_read' | 'count' | 'join' | 'object_url' | 'baseline_drift';

/**
 * A canary principal: a synthetic tenant/user with known, minimal fixture data.
 * `ownedIds` is the complete set of resource ids this principal legitimately owns
 * on the target surface — anything else it observes is foreign.
 */
export interface CanaryPrincipal {
  tenantId: string;
  claim: string;                  // the auth-claim shape the policy keys on, e.g. "tenant"
  ownedIds: string[];             // ids this principal is allowed to see
}

export interface ProbeSpec {
  id: string;
  kind: ProbeKind;
  route: string;                  // e.g. "/orders" or an object key for object_url
  principal: CanaryPrincipal;
  /** Policy this probe exercises — "<table>.<policy>" — for routing the fix. */
  policy: string;
  /** Routes/tables gated by this policy — the blast radius for tier selection. */
  policyBlast: number;
}

/**
 * What the probe actually observed when run against a backend (prod or fork).
 * Ids only — never raw rows. For `count` probes, `observedCount` is the headline.
 */
export interface ProbeObservation {
  observedIds: string[];
  observedCount?: number;         // for count endpoints; defaults to observedIds.length
  status: number;
}

export type LeakSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface ProbeResult {
  probeId: string;
  leak: boolean;
  /** Ids the canary saw that it does not own — the cross-tenant evidence. */
  foreignIds: string[];
  severity: LeakSeverity;
  reason: string;
}

// ── evaluation ───────────────────────────────────────────────────────────────────

/**
 * Evaluate a single probe observation. A leak requires CROSS-TENANT evidence: the
 * canary principal observed an id it does not own. The number of foreign ids and
 * the policy blast radius set severity. A 4xx/5xx is not a leak — it's the policy
 * doing its job (or a flake); we report no leak.
 */
export function evaluateProbe(spec: ProbeSpec, obs: ProbeObservation): ProbeResult {
  if (obs.status >= 400) {
    return { probeId: spec.id, leak: false, foreignIds: [], severity: 'none', reason: `canary got ${obs.status} — denied as expected` };
  }
  const owned = new Set(spec.principal.ownedIds);
  const foreignIds = obs.observedIds.filter((id) => !owned.has(id));

  // A count endpoint can leak the *existence* of foreign rows even without ids.
  const countLeak = obs.observedCount !== undefined && obs.observedCount > spec.principal.ownedIds.length;

  if (foreignIds.length === 0 && !countLeak) {
    return { probeId: spec.id, leak: false, foreignIds: [], severity: 'none', reason: 'canary saw only its own data — boundary holds' };
  }

  const leakedN = foreignIds.length > 0
    ? foreignIds.length
    : Math.max(1, (obs.observedCount ?? 0) - spec.principal.ownedIds.length);
  const severity = leakSeverity(leakedN, spec.policyBlast, spec.kind);
  return {
    probeId: spec.id,
    leak: true,
    foreignIds,
    severity,
    reason: foreignIds.length > 0
      ? `canary saw ${foreignIds.length} foreign id(s) via ${spec.kind} on ${spec.route} — cross-tenant leak`
      : `count endpoint exposed ${leakedN} foreign row(s) beyond the canary's own — cross-tenant count leak`,
  };
}

/**
 * Severity from how much leaked and how broad the policy is. Object-URL and join
 * leaks are weighted up (a single leaked object/receipt URL is already serious;
 * joins can fan out across tables). A wide policy blast raises severity a notch.
 */
export function leakSeverity(leakedCount: number, policyBlast: number, kind: ProbeKind): LeakSeverity {
  let base = leakedCount >= 100 ? 4 : leakedCount >= 10 ? 3 : leakedCount >= 2 ? 2 : 1; // 1..4
  if (kind === 'object_url' || kind === 'join') base += 1;        // a single leaked object/join is serious
  if (policyBlast >= 5) base += 1;                                // wide policy → bigger blast
  const clamped = Math.min(4, base);
  return (['none', 'low', 'medium', 'high', 'critical'] as const)[clamped] ?? 'critical';
}

// ── cross-backend confirmation (prod vs fork) ─────────────────────────────────────

export interface DifferentialLeak {
  /** Leak confirmed on prod. */
  prod: ProbeResult;
  /** The same probe on the fork AFTER the candidate fix. */
  fork: ProbeResult;
  /** True when the fix closes the leak: prod leaks, fork does not. */
  fixCloses: boolean;
  /** True when the fix would WIDEN access — fork leaks more than prod. Hard block. */
  widens: boolean;
}

/**
 * Confirm a leak fix the way the differential replay suite (ticket 0033) confirms
 * a vanished-row fix: it must reproduce on prod and be gone on the fork, and the
 * fork must never expose MORE than prod (that would be a fix that widens access).
 */
export function confirmLeakFix(prod: ProbeResult, fork: ProbeResult): DifferentialLeak {
  const fixCloses = prod.leak && !fork.leak;
  const widens = fork.foreignIds.length > prod.foreignIds.length || (fork.leak && !prod.leak);
  return { prod, fork, fixCloses, widens };
}

// ── conservative dispatch ──────────────────────────────────────────────────────────

export type DispatchTier = 'pr' | 'draft_pr' | 'human_review' | 'none';

/**
 * Conservative by default. A leak fix touches a security boundary, so it never
 * auto-PRs unless: the fix is confirmed closed on the fork, does not widen, the
 * blast radius is demonstrably tiny (policyBlast ≤ 1), and severity is not
 * critical. Anything wider or more severe goes to draft PR or human review. A fix
 * that widens access is blocked outright.
 */
export function leakDispatchTier(diff: DifferentialLeak, spec: ProbeSpec): { tier: DispatchTier; reason: string } {
  if (diff.widens) {
    return { tier: 'human_review', reason: 'candidate fix WIDENS access on the fork — blocked from any PR, human review required' };
  }
  if (!diff.fixCloses) {
    return { tier: 'none', reason: diff.prod.leak ? 'leak not closed by the candidate fork fix — no dispatch' : 'no leak reproduced on prod — nothing to fix' };
  }
  if (diff.prod.severity === 'critical' || diff.prod.severity === 'high') {
    return { tier: 'human_review', reason: `${diff.prod.severity} leak — security-sensitive, human review before any change` };
  }
  if (spec.policyBlast <= 1 && diff.prod.severity === 'low') {
    return { tier: 'pr', reason: 'leak closed, no widening, tiny blast radius, low severity — safe to auto-PR' };
  }
  return { tier: 'draft_pr', reason: 'leak closed and does not widen, but blast/severity warrants a human glance — draft PR' };
}
