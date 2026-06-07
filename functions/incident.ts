// functions/incident.ts
// Incident aggregation — one bug, many sessions, one PR.
//
// Ticket:  agents/tasks/0080-incident-aggregation.md
// Defends: ADR 0003 Risk 3 — a single broken policy frustrates every affected
//          user. Diagnosing/forking/PR-ing each captured session is wasteful,
//          spammy, and erodes trust instantly. Group them into one incident with
//          the session count as a severity signal.
//
// Pure, testable core: a structural signature groups runs (failing policy + route
// + normalized diff shape); a new arrival either ATTACHES to an open incident
// (raising severity) or OPENS a new one; severity scales with affected sessions
// and drives the dispatch tier (a 1,000-user incident is not a draft).

export interface IncidentSignature {
  failingPolicy: string;   // e.g. "orders.orders_select"
  route: string;           // e.g. "/orders"
  /** Normalized shape of the proposed fix — same fix ⇒ same incident. */
  diffShape: string;
}

export interface Incident {
  id: string;
  signature: IncidentSignature;
  sessionCount: number;
  firstSeen: string;       // ISO8601
  lastSeen: string;        // ISO8601
  status: 'open' | 'shipped' | 'closed';
}

export type SeverityLevel = 'low' | 'medium' | 'high' | 'critical';

/** Stable grouping key — same policy + route + fix shape ⇒ same incident. */
export function incidentKey(sig: IncidentSignature): string {
  return [normPolicy(sig.failingPolicy), normRoute(sig.route), normDiff(sig.diffShape)].join('::');
}

/** Find an open incident this arrival belongs to, or null to open a new one. */
export function matchIncident(sig: IncidentSignature, open: Incident[]): Incident | null {
  const key = incidentKey(sig);
  return open.find((i) => i.status === 'open' && incidentKey(i.signature) === key) ?? null;
}

export interface Arrival {
  action: 'attach' | 'open';
  incident: Incident;
}

/**
 * Classify a newly-captured run: attach to an existing open incident (and bump
 * its count + lastSeen) or open a new one. The first session of an incident pays
 * for the diagnose→fork→PR; the rest are evidence, not new runs.
 */
export function classifyArrival(
  sig: IncidentSignature,
  open: Incident[],
  at: string,
  newId: () => string,
): Arrival {
  const match = matchIncident(sig, open);
  if (match) {
    return {
      action: 'attach',
      incident: { ...match, sessionCount: match.sessionCount + 1, lastSeen: at },
    };
  }
  return {
    action: 'open',
    incident: { id: newId(), signature: sig, sessionCount: 1, firstSeen: at, lastSeen: at, status: 'open' },
  };
}

/** Severity from affected-session volume. Drives tier/routing + notification. */
export function severityScore(incident: Incident): { score: number; level: SeverityLevel } {
  const n = incident.sessionCount;
  const level: SeverityLevel = n >= 100 ? 'critical' : n >= 10 ? 'high' : n >= 2 ? 'medium' : 'low';
  // log-scaled 0..100 so 1 → ~0, 100 → ~100.
  const score = Math.min(100, Math.round((Math.log10(Math.max(1, n)) / 2) * 100));
  return { score, level };
}

/**
 * A high-severity incident should not be downgraded to a draft just because the
 * model's confidence was middling — many affected users raises the floor.
 */
export function tierFloorFor(level: SeverityLevel): 'issue' | 'draft_pr' | 'pr' {
  return level === 'critical' || level === 'high' ? 'draft_pr' : 'issue';
}

// ── normalization ─────────────────────────────────────────────────────────────

function normPolicy(p: string): string { return p.trim().toLowerCase(); }
function normRoute(r: string): string { return (r.split('?')[0] ?? '').replace(/\/+$/, '').toLowerCase(); }
function normDiff(d: string): string {
  return d.replace(/#.*$/gm, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
