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
  const insertRes = await client.database
    .from('bug_runs')
    .insert({
      tenant_id: authedUser.tenantId,
      session_clip_url: clipUrl,
      status: 'captured',
    })
    .select('id')
    .single();
  if (insertRes.error || !insertRes.data) {
    throw new ServerError(`bug_runs insert: ${insertRes.error?.message ?? 'no data'}`);
  }
  const runId = (insertRes.data as { id: string }).id;

  // 5. Broadcast on the receipt channel so the receipt page wakes up.
  //    Payload kept tiny — receipt page can read the row by id.
  await client.realtime.publish(REALTIME_CHANNEL, 'captured', {
    runId,
    tenantId: authedUser.tenantId,
    signal: signal.kind,
    capturedAt: new Date().toISOString(),
  });

  return { runId, clipUrl };
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
