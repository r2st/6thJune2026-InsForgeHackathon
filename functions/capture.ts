// functions/capture.ts
//
// Stage 2.5 of the pipeline: turn the one correlated failing request into a
// self-contained, replayable bundle (ReplayPayload) that replay() can fire at
// both prod and the fork. We replay the *policy*, not the page — so the unit of
// work is a single HTTP request plus the exact claims the user carried.
//
// Ticket: agents/tasks/0005-capture-failing-request.md
//
// Sourcing: the failing request is chosen by correlate() (ticket 0014), which
// already filters the session's request_log window to the single empty-result
// (rows=0, 200 OK) or 4xx request and refuses on ambiguity. We add the replay
// envelope: method/path/query reconstructed from the route, and the verbatim
// Authorization JWT — recorded by the toy-app wrapper in dev (0014) or supplied
// by the orchestrator. No request, no money shot → we return null cleanly so
// the receipt page can show "no anomaly" instead of crashing.

import type { ReplayPayload, RequestLogEntry } from './types.js';
import { fetchRequestLogWindow, correlate } from './correlate.js';

export interface CaptureOptions {
  /** ±window around the capture time. Default matches correlate's window. */
  windowSec?: number;
  /**
   * Verbatim Bearer JWT the failing request carried. Required to replay against
   * prod as the same user. The toy-app wrapper records it in dev; the
   * orchestrator passes it through here.
   */
  jwt?: string;
  /** Injectable fetch of the request-log window — defaults to correlate's. */
  fetchWindow?: (sessionId: string, capturedAt: string, windowSec?: number) => Promise<RequestLogEntry[]>;
}

/**
 * Capture the single failing request for a session as a ReplayPayload, or null
 * if there's no unambiguous anomaly to replay.
 */
export async function captureFailingRequest(
  sessionId: string,
  capturedAt: string,
  opts: CaptureOptions = {},
): Promise<ReplayPayload | null> {
  const fetchWindow = opts.fetchWindow ?? fetchRequestLogWindow;
  const window = await fetchWindow(sessionId, capturedAt, opts.windowSec);
  const result = correlate(window);
  if (!result.ok) return null;
  if (!opts.jwt) return null; // can't replay against prod without the user's token
  return toReplayPayload(result.entry, result.expectedRows, opts.jwt);
}

/**
 * Pure serializer: a correlated request-log entry + its expected row count +
 * the user's JWT → a ReplayPayload. Path and query are derived from the logged
 * route; the body is null for the GET-shaped reads the demo bug lives on.
 */
export function toReplayPayload(
  entry: RequestLogEntry,
  expectedRows: number,
  jwt: string,
): ReplayPayload {
  const { path, query } = splitRoute(entry.route);
  return {
    method: entry.method,
    path,
    query,
    headers: { 'content-type': 'application/json' },
    body: null,
    ts: entry.ts,
    jwt,
    expectedRows,
  };
}

/** Split a logged route ("/orders?status=open") into path + query map. */
function splitRoute(route: string): { path: string; query: Record<string, string> } {
  const qIdx = route.indexOf('?');
  if (qIdx === -1) return { path: route, query: {} };
  const path = route.slice(0, qIdx);
  const query: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(route.slice(qIdx + 1))) query[k] = v;
  return { path, query };
}
