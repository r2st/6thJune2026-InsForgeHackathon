// Hush — shared types across edge functions.
// Read this file first. Cross-file types live here; don't redefine per file.

/** rrweb session capture + metadata. The webhook payload from the toy app. */
export interface CapturedSession {
  sessionId: string;
  tenantId: string;
  userId: string;
  startedAt: string;          // ISO8601
  endedAt: string;            // ISO8601
  frustrationAt: string | null; // ISO8601 of the last rage-click; null if none
  clipUrl: string;            // signed URL into storage.buckets.clips
}

/**
 * Raw payload posted from the toy-app SDK to /capture.
 * `tenantId` and `userId` are NOT in the body — the edge function resolves
 * them from the caller's JWT. Don't trust client-supplied identity.
 *
 * Ticket: 0013.
 */
export interface IngestPayload {
  sessionId: string;
  signal: {
    kind: 'rage_click' | 'dead_click' | 'abandoned_form';
    target?: string;
    at: number;     // ms since epoch
    url: string;
  };
  events: unknown[]; // rrweb events; opaque to the server
  ctx: {
    url: string;
    route?: string;
    viewport?: { w: number; h: number };
    buildSha?: string;
  };
}

/** What /capture returns to the client. */
export interface IngestResponse {
  runId: string;
  clipUrl: string;     // signed, short TTL
}

/** One backend request, as captured in the request_log table. */
export interface RequestLogEntry {
  id: number;
  ts: string;
  sessionId: string | null;
  userId: string | null;
  tenantId: string | null;
  route: string;
  method: string;
  rlsDecisions: RlsDecision[] | null;
  returnedRows: number | null;
  status: number;
}

export interface RlsDecision {
  policy: string;             // e.g. "orders.orders_select"
  table: string;
  rowsBefore: number;         // pre-RLS row count
  rowsAfter: number;          // post-RLS row count (what the user got)
}

/** What correlate() returns — the single failing request, or a refusal. */
export type CorrelationResult =
  | { ok: true; entry: RequestLogEntry; expectedRows: number }
  | { ok: false; reason: 'no_candidates' | 'multiple_candidates' | 'no_logs' };

/** Captured failing request as a replayable bundle. */
export interface ReplayPayload {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  query: Record<string, string>;
  ts: string;
  /** Verbatim Authorization JWT from prod — re-signed for the fork. */
  jwt: string;
  /** Hard-coded for the demo. In general comes from diagnose(). */
  expectedRows: number;
}

/** Diagnose output — see schemas/diagnosis.schema.json for the wire contract. */
export interface Diagnosis {
  summary: string;            // ≤200 chars, plain English, user-facing
  expectation: string;
  observation: string;
  failingPolicy: string;      // "<table>.<policy>"
  failingJwtClaim: string;    // e.g. "auth.jwt() -> 'tenant'"
  tomlDiff: TomlPatch;
  widensAccess: boolean;      // model's self-report; safety.ts may override
  confidenceInputs: {
    diffLoc: number;
    tablesTouched: number;
    policyBlast: number;      // count of routes/tables gated by the policy
  };
  promptVersion: string;      // e.g. "diagnose-v1.0.0"
}

/** Structured TOML patch — list of JSON-Pointer-style edits. */
export interface TomlPatch {
  path: string;               // e.g. "tables.orders.rls"
  before: string;
  after: string;
}

/** Output of replay() — see ticket 0008. */
export interface Verdict {
  prod: ReplaySide;
  fork: ReplaySide;
  bugConfirmed: boolean;      // prod < expectedRows
  fixVerified: boolean;       // fork >= expectedRows
  rationale: string;          // one-line for the PR description
  /**
   * How the verdict was produced (ticket 0012). Absent/'fork' = the real
   * parallel replay against a branch project. 'trace' = the no-fork fallback:
   * the patched predicate evaluated against the live/replica data. A trace
   * verdict must NEVER reach the PR tier — the orchestrator caps it at
   * draft_pr — and the receipt page renders a distinct cool badge so it can't
   * masquerade as a real fork verdict.
   */
  mode?: 'fork' | 'trace';
}

export interface ReplaySide {
  status: number;
  rowsReturned: number;
  latencyMs: number;
  snippet: string;            // ≤200 chars
}

/** Confidence score + tier — see tickets 0020 (composite) and 0035 (floor/veto). */
export interface ConfidenceResult {
  score: number;              // 0..100 — the badge number (composite, post hard-cap)
  tier: ConfidenceTier;       // final dispatch tier = min(composite tier, ceiling)
  signals: {
    replayVerdictScore: number;
    diffSizeScore: number;
    policyBlastScore: number;
    pgvectorSimilarityScore: number;
  };
  /**
   * Ticket 0035 — the strictest tier the weakest single signal permits.
   * The badge is an average; `ceiling` is that average clamped by the worst
   * signal. `tier` never exceeds `ceiling`.
   */
  ceiling: ConfidenceTier;
  /**
   * Set when `ceiling` is stricter than the composite alone would allow —
   * i.e. a single weak signal pulled the dispatch down. Names the signal and
   * its value so the receipt page can render "tier limited by <signal>: <n>".
   */
  veto?: { signal: string; value: number };
  promptVersion: string;
}

export type ConfidenceTier = 'pr' | 'draft_pr' | 'issue';

/** Safety rail output — see ticket 0021. */
export interface SafetyResult {
  widens: boolean;
  reasons: string[];
}

/** A single Hush run, as persisted in tables.bug_runs. */
export interface BugRun {
  id: string;
  tenantId: string;
  capturedAt: string;
  sessionClipUrl: string | null;
  diagnosis: Diagnosis | null;
  tomlDiff: TomlPatch | null;
  confidence: number | null;
  tier: ConfidenceTier | null;
  status: 'captured' | 'correlated' | 'diagnosed' | 'testing' | 'shipped' | 'failed';
  prUrl: string | null;
  promptVersion: string | null;
}

/** Realtime event payload — channels.receipt. */
export interface ReceiptEvent {
  runId: string;
  step: 'captured' | 'correlated' | 'diagnosed' | 'testing' | 'shipped' | 'failed';
  at: string;                 // ISO8601
  detail?: Record<string, unknown>;
}
