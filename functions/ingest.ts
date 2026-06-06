// functions/ingest.ts
//
// /capture — receives the toy-app SDK payload (one frustration signal +
// its rrweb event buffer), writes the gzipped clip to Storage, inserts a
// bug_runs row in 'captured' state, and broadcasts the first Realtime
// event the receipt page is waiting on.
//
// This function returns FAST. The heavier pipeline (correlate → diagnose
// → fork-and-test → ship) lives in functions/fix-trigger.ts (ticket 0030)
// and gets triggered asynchronously off the new bug_runs row.
//
// Ticket: agents/done/0013-capture-edge-function.md

import type { IngestPayload, IngestResponse } from './types.js';
import { getClient } from './lib/insforgeClient.js';
import { gzipJson } from './lib/gzip.js';
import { scrubPii } from './lib/scrubPii.js';
import { decodeJwtBody, tenantFromClaims } from './lib/jwt.js';
import { fetchRequestLogWindow, correlate } from './correlate.js';

const REALTIME_CHANNEL = 'receipt';
const CLIPS_BUCKET = 'clips';

// ─────────────────────────────────────────────────────────────────────────────
// Internal core (testable, no Request/Response).
// ─────────────────────────────────────────────────────────────────────────────

export async function ingest(
  payload: IngestPayload,
  authedUser: { id: string; tenantId: string },
): Promise<IngestResponse> {
  const { sessionId, signal, events, ctx } = payload;
  if (!sessionId || !signal || !Array.isArray(events) || !ctx) {
    throw new BadRequest('missing required fields: sessionId, signal, events, ctx');
  }

  const client = getClient();

  // 1. Scrub + gzip the rrweb buffer.
  const scrubbed = scrubPii(events);
  const gz = await gzipJson(scrubbed);
  // Detach the buffer view to satisfy BlobPart's ArrayBuffer (not SharedArrayBuffer) constraint.
  const blob = new Blob([gz.slice().buffer as ArrayBuffer], { type: 'application/gzip' });

  // 2. Upload to clips bucket under tenants/{tid}/sessions/{sid}.json.gz.
  const objectPath = `tenants/${authedUser.tenantId}/sessions/${sessionId}.json.gz`;
  const uploadRes = await client.storage.from(CLIPS_BUCKET).upload(objectPath, blob);
  if (uploadRes.error) throw new ServerError(`storage upload: ${uploadRes.error.message}`);

  // 3. Resolve the playback URL. For a `visibility = "signed"` bucket
  //    (see infra/insforge.toml) the runtime returns a signed URL with
  //    the bucket's configured TTL. For a public bucket, a direct URL.
  const clipUrl = client.storage.from(CLIPS_BUCKET).getPublicUrl(objectPath);

  // 4. Insert the bug_runs row. status='captured' is the trigger 0030
  //    will pick up to start the diagnose → test → ship loop.
  const capturedAt = new Date().toISOString();
  const insertRes = await client.database
    .from('bug_runs')
    .insert({
      tenant_id: authedUser.tenantId,
      session_id: sessionId,
      session_clip_url: clipUrl,
      status: 'captured',
    })
    .select('id')
    .single();
  if (insertRes.error || !insertRes.data) {
    throw new ServerError(`bug_runs insert: ${insertRes.error?.message ?? 'no data'}`);
  }
  const runId = (insertRes.data as { id: string }).id;

  // 5. Broadcast 'captured' so the receipt page wakes up immediately.
  await client.realtime.publish(REALTIME_CHANNEL, 'captured', {
    runId,
    tenantId: authedUser.tenantId,
    signal: signal.kind,
    capturedAt,
  });

  // 6. Correlate: pull the backend request-log slice for this session and
  //    pick the one failing request. Persisted onto the run so diagnose
  //    (0018) and fix-trigger (0030) can read it. Best-effort — a run with
  //    no logs still proceeds (status 'captured_no_logs') and the receipt
  //    page handles the empty case.
  try {
    const window = await fetchRequestLogWindow(sessionId, capturedAt);
    const result = correlate(window);
    await client.database
      .from('bug_runs')
      .update({
        request_log_window: window,
        status: result.ok ? 'correlated' : 'captured_no_logs',
      })
      .eq('id', runId);
    await client.realtime.publish(REALTIME_CHANNEL, 'correlated', {
      runId,
      ok: result.ok,
      route: result.ok ? result.entry.route : null,
      reason: result.ok ? null : result.reason,
    });
  } catch (err) {
    // Correlation failure must not fail capture — the clip is already saved.
    // eslint-disable-next-line no-console
    console.warn('[hush] correlate failed', err);
  }

  // 7. Kick the diagnose → test → ship loop off the captured run. Fire-and-
  //    forget: a slow or failed orchestrator must never delay or fail the
  //    capture response. This is the connection from capture (this fn) to the
  //    fix-trigger edge function (0030) — without it the loop never starts.
  triggerFix(runId);

  return { runId, clipUrl };
}

/**
 * Asynchronously invoke the fix-trigger edge function for a captured run.
 * Best-effort and env-guarded: with no INSFORGE_URL/SERVICE_KEY it no-ops (a
 * platform row-insert trigger or a manual call drives the loop instead), and
 * any error is swallowed so capture is never affected.
 */
export function triggerFix(runId: string): void {
  const base = process.env.INSFORGE_URL;
  const key = process.env.INSFORGE_SERVICE_KEY;
  if (!base || !key) return;
  void fetch(`${base}/functions/fix-trigger`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId }),
    // eslint-disable-next-line no-console
  }).catch((err) => console.warn('[hush] triggerFix failed', err));
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP handler — wires the core to the InsForge edge runtime.
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  try {
    const user = authenticate(req);
    const payload = (await req.json()) as IngestPayload;
    const result = await ingest(payload, user);
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof BadRequest) return Response.json({ error: err.message }, { status: 400 });
    if (err instanceof Unauthorized) return Response.json({ error: err.message }, { status: 401 });
    if (err instanceof ServerError) return Response.json({ error: err.message }, { status: 500 });
    return Response.json({ error: 'unexpected' }, { status: 500 });
  }
}

function authenticate(req: Request): { id: string; tenantId: string } {
  const auth = req.headers.get('authorization') ?? '';
  const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
  if (!jwt) throw new Unauthorized('missing bearer token');

  // The InsForge edge runtime verifies the signature before invoking us.
  // We only decode the body to read identity.
  let claims;
  try {
    claims = decodeJwtBody(jwt);
  } catch {
    throw new Unauthorized('invalid token');
  }

  const sub = typeof claims.sub === 'string' ? claims.sub : null;
  if (!sub) throw new Unauthorized('token missing sub');

  // Accept either claim shape — the demo bug only bites the read path
  // inside the RLS policy, not capture itself.
  const tenantId = tenantFromClaims(claims);
  if (!tenantId) throw new Unauthorized('no tenant in token');

  return { id: sub, tenantId };
}

class BadRequest extends Error {}
class Unauthorized extends Error {}
class ServerError extends Error {}

// Re-export for tests.
export type { IngestPayload, IngestResponse };
