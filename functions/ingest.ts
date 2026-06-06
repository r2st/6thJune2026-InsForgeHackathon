// functions/ingest.ts
// Webhook entrypoint from the toy app. Triggered when rrweb fires a session.
//
// Steps (matches docs/deployment.md §5):
//   1. Validate the captured session payload.
//   2. Call correlate() to find the failing request and pull its log slice.
//   3. Embed the (session shape + log + RLS verdict) tuple via InsForge AI.
//   4. pgvector dedup vs bug_runs.embedding — skip on close match to a past rejection.
//   5. Insert a row in bug_runs (status: 'captured').
//   6. Broadcast { step: 'captured' } on realtime channel 'receipt'.
//   7. Call fix-trigger (sync) with the new run id.
//
// Owner: <unclaimed — see agents/inbox/0005-capture-failing-request.md and 0014-backend-log-correlation.md>

import type { CapturedSession, BugRun } from './types.js';

export async function ingest(_payload: CapturedSession): Promise<{ runId: string } | { skipped: 'duplicate' | 'no_anomaly' }> {
  // TODO(0005, 0014): implement
  throw new Error('not implemented');
}

// Edge function handler — wire to the InsForge runtime in deployment.
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const payload = await req.json() as CapturedSession;
  const result = await ingest(payload);
  return Response.json(result);
}

// Re-export for testing.
export type { CapturedSession, BugRun };
