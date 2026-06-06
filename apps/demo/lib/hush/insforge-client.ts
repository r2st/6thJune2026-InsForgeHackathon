// Wrapped InsForge client for the toy app.
//
// Two jobs:
//   1. Tag every request with `x-hush-session-id` so the backend
//      request_log can be correlated to an rrweb session later (0014).
//   2. Provide `sendCapture()` — the transport the frustration detector
//      calls when a signal fires (closes the loop opened in 0024).
//
// Ticket: agents/tasks/0014-backend-log-correlation.md

import { createClient, type InsForgeClient } from '@insforge/sdk';
import type { IngestPayload, IngestResponse } from './ingest-contract';

// One stable session id per browser tab. Lives as long as the page does,
// which is exactly the window rrweb buffers over.
let SESSION_ID: string | null = null;

export function sessionId(): string {
  if (SESSION_ID) return SESSION_ID;
  SESSION_ID =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `s_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  return SESSION_ID;
}

let cached: InsForgeClient | null = null;

/**
 * The app's InsForge client. Every outbound request carries
 * `x-hush-session-id` via a global fetch shim installed on first use.
 */
export function insforge(): InsForgeClient {
  if (cached) return cached;
  const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const anonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
  if (!baseUrl || !anonKey) {
    throw new Error('NEXT_PUBLIC_INSFORGE_URL and NEXT_PUBLIC_INSFORGE_ANON_KEY must be set');
  }
  installSessionHeaderShim(baseUrl);
  cached = createClient({ baseUrl, anonKey });
  return cached;
}

let shimInstalled = false;

/**
 * Patch global fetch so any request to the InsForge host gets the
 * session header. Scoped to the InsForge origin so we don't leak the
 * id to third parties.
 */
function installSessionHeaderShim(baseUrl: string): void {
  if (shimInstalled || typeof window === 'undefined') return;
  shimInstalled = true;

  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    return;
  }

  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    let target = '';
    if (typeof input === 'string') target = input;
    else if (input instanceof URL) target = input.href;
    else target = input.url;

    let sameHost = false;
    try {
      sameHost = new URL(target, window.location.href).host === host;
    } catch {
      sameHost = false;
    }

    if (!sameHost) return orig(input, init);

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('x-hush-session-id', sessionId());
    return orig(input, { ...init, headers });
  };
}

/**
 * Ship a capture bundle to the ingest edge function. Called by the
 * frustration detector's onSignal. Best-effort — never throws into the
 * app's render path.
 *
 * Uses the SDK's `functions.invoke`, which attaches the logged-in user's
 * auth header automatically. We add `x-hush-session-id` so the ingest fn
 * can tie the run to the same session the backend request_log saw.
 */
export async function sendCapture(payload: IngestPayload): Promise<IngestResponse | null> {
  try {
    const { data, error } = await insforge().functions.invoke<IngestResponse>('ingest', {
      method: 'POST',
      body: payload,
      headers: { 'x-hush-session-id': sessionId() },
    });
    if (error || !data) {
      // eslint-disable-next-line no-console
      console.warn('[hush] capture invoke failed', error?.message);
      return null;
    }
    return data;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[hush] capture invoke threw', err);
    return null;
  }
}
