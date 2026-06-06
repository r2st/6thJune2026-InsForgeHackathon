// Wire contract for POST /ingest. Mirrors functions/types.ts
// (IngestPayload / IngestResponse). Kept local to avoid a cross-package
// import from the toy app into the edge-functions package.
//
// If you change this, change functions/types.ts too. The shapes must match.
//
// Ticket: agents/tasks/0014-backend-log-correlation.md

export interface IngestPayload {
  sessionId: string;
  signal: {
    kind: 'rage_click' | 'dead_click' | 'abandoned_form';
    target?: string;
    at: number;
    url: string;
  };
  events: unknown[];
  /** Which provider produced this capture — shown on the receipt for honesty. */
  captureSource?: 'replicas' | 'rrweb';
  /** Provider-hosted clip URL, when the source hosts its own replay (Replicas). */
  clipUrl?: string;
  ctx: {
    url: string;
    route?: string;
    viewport?: { w: number; h: number };
    buildSha?: string;
  };
}

export interface IngestResponse {
  runId: string;
  clipUrl: string;
}
