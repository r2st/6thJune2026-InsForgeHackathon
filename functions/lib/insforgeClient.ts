// Single source of truth for the service-scoped InsForge client used by
// edge functions. Reads INSFORGE_URL + INSFORGE_SERVICE_KEY from env.
//
// Ticket: agents/done/0013-capture-edge-function.md

import { createAdminClient, type InsForgeClient } from '@insforge/sdk';

let cached: InsForgeClient | null = null;

export function getClient(): InsForgeClient {
  if (cached) return cached;
  const baseUrl = process.env.INSFORGE_URL;
  const apiKey = process.env.INSFORGE_SERVICE_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('INSFORGE_URL and INSFORGE_SERVICE_KEY must be set');
  }
  cached = createAdminClient({ baseUrl, apiKey });
  return cached;
}

// ── realtime narration (connect-once, timeout-bounded, never fatal) ───────────
// The realtime SDK requires connect() before publish(). The edge functions were
// calling publish() raw, so the first event threw "Not connected to realtime
// server" and aborted the handler mid-pipeline (capture stalled before
// correlate). Realtime is the receipt page's narrator, not the pipeline's
// substance — the DB row and the PR are the truth, and the receipt page polls
// bug_runs as a fallback. So: connect once per warm container; if connect fails,
// give up quietly for this container; never let a publish error escape.

type RtState = 'init' | 'on' | 'off';
let rtState: RtState = 'init';

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

/** Publish one receipt event. Connects on first use; swallows all failures. */
export async function publishReceipt(channel: string, event: string, payload: unknown): Promise<void> {
  if (rtState === 'off') return; // connect already failed this container — fast no-op
  try {
    const rt = getClient().realtime;
    if (rtState === 'init') {
      await withTimeout(rt.connect(), 3000);
      rtState = 'on';
    }
    await withTimeout(rt.publish(channel, event, payload), 2000);
  } catch (err) {
    if (rtState === 'init') rtState = 'off'; // connect failed → stop trying
    // eslint-disable-next-line no-console
    console.warn(`[hush:realtime] publish '${event}' skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}
