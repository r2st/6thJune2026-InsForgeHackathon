// functions/correlate.ts
//
// Stage 2 of the pipeline. Turns a captured session into the single
// failing backend request that downstream stages reason about.
//
// Two exports:
//   - fetchRequestLogWindow(): pull the ±windowSec slice of request_log
//     for a session id, newest first.
//   - correlate(): pure picker — from a window, choose the one failing
//     request (empty result-set or 4xx) or refuse if ambiguous.
//
// The picker is pure and unit-tested. The fetch wraps InsForge.
//
// Ticket: agents/tasks/0014-backend-log-correlation.md

import type { RequestLogEntry, CorrelationResult } from './types.js';
import { getClient } from './lib/insforgeClient.js';

const DEFAULT_WINDOW_SEC = 10;

/**
 * Fetch the request-log slice for a session around its capture time.
 * Newest first. Returns [] if the session never hit the backend.
 */
export async function fetchRequestLogWindow(
  sessionId: string,
  capturedAt: string,
  windowSec = DEFAULT_WINDOW_SEC,
): Promise<RequestLogEntry[]> {
  const client = getClient();
  const lo = new Date(new Date(capturedAt).getTime() - windowSec * 1000).toISOString();
  const { data, error } = await client.database
    .from('request_log')
    .select('*')
    .eq('session_id', sessionId)
    .gte('ts', lo)
    .lte('ts', capturedAt)
    .order('ts', { ascending: false });
  if (error) throw new Error(`request_log query: ${error.message}`);
  return (data ?? []).map(rowToEntry);
}

/**
 * From a request-log window, pick the single failing request:
 *   the latest request whose response was an empty result-set
 *   (returnedRows === 0) or a 4xx for this tenant.
 *
 * Pure. No I/O. Refuses on ambiguity or absence so the caller can drop
 * the run to an issue rather than guess.
 */
export function correlate(window: RequestLogEntry[]): CorrelationResult {
  if (window.length === 0) return { ok: false, reason: 'no_logs' };

  // window is newest-first; failing = empty rows or client error.
  const failing = window.filter(
    (e) => e.returnedRows === 0 || (e.status >= 400 && e.status < 500),
  );

  if (failing.length === 0) return { ok: false, reason: 'no_candidates' };

  // If several distinct routes fail, we can't be sure which the user hit.
  const distinctRoutes = new Set(failing.map((e) => e.route));
  if (distinctRoutes.size > 1) return { ok: false, reason: 'multiple_candidates' };

  const entry = failing[0]!; // newest failing request on the single route
  // Expected rows: best-effort from the RLS decision's pre-filter count.
  // The orders demo bug shows rowsBefore >= 1 but rowsAfter === 0.
  const expectedRows = expectedFromRls(entry);
  return { ok: true, entry, expectedRows };
}

function expectedFromRls(entry: RequestLogEntry): number {
  if (!entry.rlsDecisions || entry.rlsDecisions.length === 0) return 1;
  // The policy that filtered the most rows is the suspect.
  const worst = entry.rlsDecisions.reduce((a, b) =>
    b.rowsBefore - b.rowsAfter > a.rowsBefore - a.rowsAfter ? b : a,
  );
  return Math.max(worst.rowsBefore, 1);
}

interface RawRow {
  id: number;
  ts: string;
  session_id: string | null;
  user_id: string | null;
  tenant_id: string | null;
  route: string;
  method: string;
  rls_decisions: unknown;
  returned_rows: number | null;
  status: number;
}

function rowToEntry(row: RawRow): RequestLogEntry {
  return {
    id: row.id,
    ts: row.ts,
    sessionId: row.session_id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    route: row.route,
    method: row.method,
    rlsDecisions: normalizeRls(row.rls_decisions),
    returnedRows: row.returned_rows,
    status: row.status,
  };
}

function normalizeRls(raw: unknown): RequestLogEntry['rlsDecisions'] {
  if (!Array.isArray(raw)) return null;
  return raw.map((d) => {
    const o = d as Record<string, unknown>;
    return {
      policy: String(o.policy ?? ''),
      table: String(o.table ?? ''),
      rowsBefore: Number(o.rows_before ?? o.rowsBefore ?? 0),
      rowsAfter: Number(o.rows_after ?? o.rowsAfter ?? 0),
    };
  });
}
