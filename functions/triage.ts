// functions/triage.ts
// Signal triage — turn raw frustration signals into a small, high-quality queue.
//
// Ticket:  agents/tasks/0087-signal-triage-dedup-noise-budget.md
// Defends: the product becomes quiet enough to run in production. Rage-clicks are
//          smoke, not proof — slow networks, confusing UI, disabled buttons, and
//          browser extensions all produce them. If every signal starts an LLM
//          diagnosis + fork replay, Hush is noisy, expensive, and untrusted.
//
// Pure, testable core: a candidate is GATED on backend evidence (a clear failing
// route with 200-OK-but-empty/wrong rows or a 4xx, plus policy-level evidence
// when an auto-fix is possible); survivors are FINGERPRINTED and CLUSTERED so a
// recurring bug is one run with a count, not N duplicate PRs; and a per-workspace
// daily BUDGET caps how many diagnoses/forks/outputs we spend — overflow becomes
// dashboard-only evidence, never dropped data. Conservative by default: collect
// freely, spend forks/LLM sparingly, auto-PR only on repeated or very strong proof.

export type SignalKind = 'rage_click' | 'dead_click' | 'abandoned_form';

/**
 * One captured signal joined with the backend request-log evidence the ingest
 * step found for its session. This is the unit triage scores — before any LLM or
 * fork work runs.
 */
export interface CandidateEvent {
  workspaceId: string;
  siteId: string;
  sessionId: string;
  kind: SignalKind;
  route: string;
  at: string;                     // ISO8601 — when the signal fired
  /** Backend evidence for this session+route, from the request log. Null = none found. */
  evidence: BackendEvidence | null;
}

/**
 * The backend-side facts the gate needs. Mirrors a RequestLogEntry slice plus the
 * release SHA and the normalized auth-claim shape used in the fingerprint.
 */
export interface BackendEvidence {
  status: number;                 // HTTP status of the failing request
  rowsBefore: number | null;      // pre-RLS row count (policy evidence; see ticket 0086)
  rowsAfter: number | null;       // post-RLS row count the user actually got
  failingPolicy: string | null;   // "<table>.<policy>" when RLS dropped the rows
  authClaimShape: string | null;  // e.g. "tenant" — which claim the policy keys on
  releaseSha: string | null;      // build SHA at capture time
  queryShape: string | null;      // normalized query (literals stripped)
}

export type Disposition =
  | 'ignored'          // no backend agreement — smoke, dashboard-only
  | 'clustered'        // matches an open run — attach as evidence, no new work
  | 'budget_deferred'  // would diagnose, but the workspace is over budget today
  | 'diagnosed';       // open a fresh run — spend the diagnose/fork

export interface TriageResult {
  disposition: Disposition;
  fingerprint: string;
  reason: string;
  /** True when this disposition consumes a diagnose from the budget. */
  spendsDiagnose: boolean;
}

// ── evidence gate ──────────────────────────────────────────────────────────────

export interface GateResult {
  pass: boolean;
  reason: string;
  /** True when there is policy-level evidence — the precondition for an auto-fix. */
  hasPolicyEvidence: boolean;
}

/**
 * Does the behavioral signal and the backend log AGREE that something silent and
 * policy-shaped happened? A signal with no backend evidence is smoke. We accept:
 *   - a 4xx on the failing route (the backend itself refused), OR
 *   - a 200 OK that returned empty/fewer rows than RLS saw (silent policy drop).
 * Policy evidence (rowsBefore > rowsAfter with a named failingPolicy) is what
 * makes an auto-fix possible; without it we can still open a run, but never auto-PR.
 */
export function gateCandidate(ev: CandidateEvent): GateResult {
  const e = ev.evidence;
  if (!e) {
    return { pass: false, reason: 'no backend evidence for this session+route — frontend/UX smoke', hasPolicyEvidence: false };
  }

  const before = e.rowsBefore ?? 0;
  const after = e.rowsAfter ?? 0;
  const silentDrop = e.status >= 200 && e.status < 300 && before > after; // RLS hid rows
  const emptyOk = e.status >= 200 && e.status < 300 && after === 0 && before === 0; // 200 + nothing
  const backendRefused = e.status >= 400 && e.status < 500;

  const hasPolicyEvidence = silentDrop && e.failingPolicy != null;

  if (silentDrop) {
    return { pass: true, reason: `200 OK but ${before}→${after} rows — policy dropped data silently`, hasPolicyEvidence };
  }
  if (backendRefused) {
    return { pass: true, reason: `backend returned ${e.status} on ${ev.route}`, hasPolicyEvidence: false };
  }
  if (emptyOk) {
    return { pass: true, reason: '200 OK with zero rows pre- and post-RLS — possible missing data', hasPolicyEvidence: false };
  }
  return { pass: false, reason: `200 OK with rows returned (${after}) — no silent failure`, hasPolicyEvidence: false };
}

// ── fingerprint ─────────────────────────────────────────────────────────────────

/**
 * Stable dedup key: workspace, site, route, policy, auth-claim shape, row-delta
 * bucket, release SHA, normalized query shape. Same bug ⇒ same fingerprint, so a
 * recurring failure clusters into one run instead of opening duplicate PRs.
 * Cosmetic differences (route trailing slash/query, case, whitespace) normalize out.
 */
export function fingerprint(ev: CandidateEvent): string {
  const e = ev.evidence;
  const before = e?.rowsBefore ?? 0;
  const after = e?.rowsAfter ?? 0;
  const parts = [
    norm(ev.workspaceId),
    norm(ev.siteId),
    normRoute(ev.route),
    norm(e?.failingPolicy ?? ''),
    norm(e?.authClaimShape ?? ''),
    rowDeltaBucket(before, after),     // bucket, not raw counts — 5→0 and 7→0 are one bug
    norm(e?.releaseSha ?? ''),
    normQuery(e?.queryShape ?? ''),
  ];
  return parts.join('::');
}

/** Coarse row-delta classes so near-identical drops share a fingerprint. */
function rowDeltaBucket(before: number, after: number): string {
  if (before > 0 && after === 0) return 'all-hidden';
  if (before > after) return 'some-hidden';
  if (before === 0 && after === 0) return 'empty';
  return 'other';
}

// ── per-workspace noise budget ───────────────────────────────────────────────────

export interface BudgetLimits {
  maxDiagnosesPerDay: number;
  maxForkReplaysPerDay: number;
  maxOutputsPerDay: number;       // PRs + drafts + issues
}

export interface BudgetUsage {
  diagnoses: number;
  forkReplays: number;
  outputs: number;
}

export const DEFAULT_BUDGET: BudgetLimits = {
  maxDiagnosesPerDay: 50,
  maxForkReplaysPerDay: 50,
  maxOutputsPerDay: 20,
};

/**
 * Per-workspace daily spend tracker. Conservative: when a budget is exhausted the
 * candidate is DEFERRED to dashboard-only evidence, never dropped — the customer
 * still sees it, Hush just doesn't spend an LLM call or a fork on it today.
 */
export class NoiseBudget {
  constructor(
    private readonly limits: BudgetLimits = DEFAULT_BUDGET,
    private usage: BudgetUsage = { diagnoses: 0, forkReplays: 0, outputs: 0 },
  ) {}

  canDiagnose(): boolean { return this.usage.diagnoses < this.limits.maxDiagnosesPerDay; }
  canForkReplay(): boolean { return this.usage.forkReplays < this.limits.maxForkReplaysPerDay; }
  canOutput(): boolean { return this.usage.outputs < this.limits.maxOutputsPerDay; }

  spendDiagnose(): void { this.usage.diagnoses += 1; }
  spendForkReplay(): void { this.usage.forkReplays += 1; }
  spendOutput(): void { this.usage.outputs += 1; }

  snapshot(): BudgetUsage { return { ...this.usage }; }
  remaining(): BudgetUsage {
    return {
      diagnoses: Math.max(0, this.limits.maxDiagnosesPerDay - this.usage.diagnoses),
      forkReplays: Math.max(0, this.limits.maxForkReplaysPerDay - this.usage.forkReplays),
      outputs: Math.max(0, this.limits.maxOutputsPerDay - this.usage.outputs),
    };
  }
}

// ── triage decision ───────────────────────────────────────────────────────────────

/**
 * The single decision: ignore (no backend agreement), cluster (matches an open
 * run — attach as evidence), defer (over budget), or diagnose (spend the work).
 * `openFingerprints` is the set of fingerprints with a run already open, so a
 * recurring bug never opens a second run. The budget is consulted but NOT spent
 * here — the caller spends it iff it acts on a `diagnosed` result (keeps this pure).
 */
export function triageEvent(
  ev: CandidateEvent,
  openFingerprints: ReadonlySet<string>,
  budget: NoiseBudget,
): TriageResult {
  const fp = fingerprint(ev);
  const gate = gateCandidate(ev);

  if (!gate.pass) {
    return { disposition: 'ignored', fingerprint: fp, reason: gate.reason, spendsDiagnose: false };
  }
  if (openFingerprints.has(fp)) {
    return { disposition: 'clustered', fingerprint: fp, reason: 'matches an open run — attached as evidence (count++)', spendsDiagnose: false };
  }
  if (!budget.canDiagnose()) {
    return { disposition: 'budget_deferred', fingerprint: fp, reason: 'workspace over daily diagnose budget — dashboard-only evidence', spendsDiagnose: false };
  }
  return { disposition: 'diagnosed', fingerprint: fp, reason: gate.reason, spendsDiagnose: true };
}

// ── normalization ─────────────────────────────────────────────────────────────────

function norm(s: string): string { return s.trim().toLowerCase(); }
function normRoute(r: string): string { return (r.split('?')[0] ?? '').replace(/\/+$/, '').toLowerCase() || '/'; }
function normQuery(q: string): string { return q.replace(/\s+/g, ' ').trim().toLowerCase(); }
