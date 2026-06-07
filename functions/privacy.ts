// functions/privacy.ts
// Privacy policy core — retention/purge, consent/DNT gate, and DSAR cascade.
//
// Ticket:  agents/tasks/0056-privacy-retention-consent.md
// Defends: session capture + backend forking is inherently sensitive. A product
//          can't ship without a defensible data-handling story — it's a sales and
//          a legal blocker. The pieces exist (rrweb masking, scrubPii, the PII
//          guardrail); this makes them a POLICY, not a feature.
//
// Pure, testable core: a configurable RETENTION policy decides what to purge as
// entities age (and forks die on TTL/merge/close); a CONSENT gate honors DNT and
// per-site consent before any capture; and a DSAR plan computes the exact cascade
// (Storage keys + DB rows) to delete for a user-deletion request. The purge
// scheduler, the actual Storage/DB deletes, and the consent UI are the seam.

// ── retention / purge ────────────────────────────────────────────────────────────

export interface RetentionPolicy {
  sessionTtlDays: number;
  clipTtlDays: number;
  runTtlDays: number;
  /** Forks are ephemeral — destroyed fast regardless of the run's own TTL. */
  forkTtlHours: number;
}

/** Conservative defaults — short retention is the privacy-preserving choice. */
export const DEFAULT_RETENTION: RetentionPolicy = {
  sessionTtlDays: 30,
  clipTtlDays: 30,
  runTtlDays: 90,
  forkTtlHours: 24,
};

export type EntityKind = 'session' | 'clip' | 'run' | 'fork';

export interface Retainable {
  id: string;
  kind: EntityKind;
  createdAt: number;   // ms epoch
}

export interface PurgeItem {
  id: string;
  kind: EntityKind;
  ageDays: number;
  reason: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function ttlMsFor(kind: EntityKind, p: RetentionPolicy): number {
  switch (kind) {
    case 'session': return p.sessionTtlDays * DAY_MS;
    case 'clip': return p.clipTtlDays * DAY_MS;
    case 'run': return p.runTtlDays * DAY_MS;
    case 'fork': return p.forkTtlHours * 60 * 60 * 1000;
  }
}

/**
 * Which entities are past their TTL and must be purged now. Pure: takes `now` and
 * a snapshot of entities, returns the purge list (the scheduler executes it).
 */
export function purgePlan(entities: Retainable[], now: number, policy: RetentionPolicy = DEFAULT_RETENTION): PurgeItem[] {
  const out: PurgeItem[] = [];
  for (const e of entities) {
    const age = now - e.createdAt;
    if (age > ttlMsFor(e.kind, policy)) {
      out.push({ id: e.id, kind: e.kind, ageDays: Math.floor(age / DAY_MS), reason: `${e.kind} exceeded its retention TTL` });
    }
  }
  return out;
}

export type ForkLifecycleEvent = 'ttl_expired' | 'merged' | 'closed' | 'run_failed';

/**
 * A fork is destroyed on ANY terminal signal — TTL, the PR merging or closing, or
 * the run failing — never left lingering with a copy of customer data.
 */
export function forkShouldDestroy(event: ForkLifecycleEvent): boolean {
  return event === 'ttl_expired' || event === 'merged' || event === 'closed' || event === 'run_failed';
}

// ── consent / DNT gate ───────────────────────────────────────────────────────────

export interface ConsentState {
  /** The end-user's Do-Not-Track signal (navigator.doNotTrack === '1'). */
  dnt: boolean;
  /** The customer site requires explicit opt-in consent before capture. */
  siteRequiresConsent: boolean;
  /** The end-user has given consent (when the site requires it). */
  userConsented: boolean;
}

export interface ConsentDecision {
  capture: boolean;
  reason: string;
}

/**
 * May we capture this session? DNT is always honored (no capture). When the site
 * requires consent, capture only with explicit opt-in. Privacy-preserving default:
 * when in doubt, do not capture.
 */
export function consentGate(state: ConsentState): ConsentDecision {
  if (state.dnt) return { capture: false, reason: 'Do-Not-Track set — capture suppressed' };
  if (state.siteRequiresConsent && !state.userConsented) {
    return { capture: false, reason: 'site requires consent and the user has not opted in — capture suppressed' };
  }
  return { capture: true, reason: state.siteRequiresConsent ? 'user opted in — capture allowed' : 'no consent gate configured — capture allowed' };
}

// ── DSAR / deletion cascade ────────────────────────────────────────────────────────

export interface UserDataIndex {
  /** Sessions tied to the subject user id. */
  sessionIds: string[];
  /** Storage object keys (clips, screenshots) for those sessions. */
  storageKeys: string[];
  /** bug_runs rows referencing the subject. */
  runIds: string[];
  /** Any live forks seeded from the subject's data. */
  forkIds: string[];
}

export interface DeletionPlan {
  userId: string;
  /** DB rows to delete, by table. */
  dbDeletes: { table: string; ids: string[] }[];
  /** Storage object keys to remove. */
  storageDeletes: string[];
  /** Forks to destroy. */
  forkDestroys: string[];
  /** Nothing references the subject — an honest empty plan, not an error. */
  empty: boolean;
}

/**
 * Compute the full deletion cascade for a DSAR / right-to-erasure request: every
 * session, clip/object, run, and fork tied to the user id, across Storage + DB.
 * Pure — the caller executes the deletes (and should verify each completed).
 */
export function deletionPlan(userId: string, index: UserDataIndex): DeletionPlan {
  const dbDeletes = [
    { table: 'sessions', ids: dedupe(index.sessionIds) },
    { table: 'bug_runs', ids: dedupe(index.runIds) },
  ].filter((d) => d.ids.length > 0);
  const storageDeletes = dedupe(index.storageKeys);
  const forkDestroys = dedupe(index.forkIds);
  const empty = dbDeletes.length === 0 && storageDeletes.length === 0 && forkDestroys.length === 0;
  return { userId, dbDeletes, storageDeletes, forkDestroys, empty };
}

// ── fork minimization invariant ─────────────────────────────────────────────────────

/**
 * The privacy posture AND the sales line: "we only fork the affected rows, never
 * your prod data." Asserts the seeded fork row-set is bounded to the rows the
 * failing request touched (+ a tiny neighbour set for the differential probe),
 * never an unbounded prod copy.
 */
export function forkSeedWithinBoundary(seededRowCount: number, touchedRowCount: number, neighbourAllowance = 5): { ok: boolean; reason: string } {
  const cap = touchedRowCount + neighbourAllowance;
  if (seededRowCount <= cap) {
    return { ok: true, reason: `fork seeded ${seededRowCount} rows ≤ ${cap} (touched ${touchedRowCount} + ${neighbourAllowance} neighbour) — minimal` };
  }
  return { ok: false, reason: `fork seeded ${seededRowCount} rows > ${cap} — exceeds the affected-rows boundary, possible over-copy of prod data` };
}

// ── helpers ──────────────────────────────────────────────────────────────────────

function dedupe(xs: string[]): string[] { return [...new Set(xs)]; }
