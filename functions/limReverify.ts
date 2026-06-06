// functions/limReverify.ts
//
// Lim.run cloud-browser re-verification of the fix on the FORK (ticket 0042).
// After the policy replay (0008) proves the fix by row counts, boot a Lim.run
// browser pointed at the toy app on the forked backend, drive the interaction
// that failed, and confirm the orders page now renders. Lim.run's shareable
// live-preview URL becomes a clickable before/after in the receipt + PR.
//
// THE HONESTY RAIL (read this):
//   - Runs against OUR fork (data + JWT + policy we control), never prod — so
//     the render is reproducible. The fragility we designed around is prod
//     determinism; the fork removes it.
//   - CORROBORATION, NEVER THE GATE. The falsifiable verdict is the policy
//     replay (0008). If this is inconclusive or unavailable, the policy verdict
//     stands and the PR still opens. This can only ADD visual confidence.
//
// ⚠️ Lim.run's exact SDK surface is isolated behind the `LimSdk` port. Wire the
// real SDK (https://docs.limrun.com/docs) at the marked seam; everything else —
// fix-trigger, ship, receipt — depends only on reverifyOnFork()'s return shape.
//
// Ticket: agents/tasks/0042-limrun-fork-browser-reverification.md

import type { Reverification } from './types.js';

export interface ReverifyInput {
  branchId: string;
  /** Base URL of the toy app pointed at the fork (or the fork API directly). */
  forkBaseUrl: string;
  /** Fork-signed JWT to inject as the session (from forgeJwt, 0007). */
  forkJwt: string;
  /** Rows the page should show once patched (from the correlation, 0014). */
  expectedRows: number;
}

/** The minimal port Hush needs from Lim.run. Map to their real TS SDK at wiring. */
export interface LimSdk {
  /**
   * Boot a browser on the forked app, inject the session, drive the failing
   * interaction, and report what rendered.
   * Returns the count of order rows shown + the shareable preview URL.
   */
  renderAndCount(input: {
    url: string;
    sessionJwt: string;
  }): Promise<{ rowsShown: number; previewUrl: string; shotUrl?: string }>;
}

export interface ReverifyDeps {
  apiKey?: string | undefined;
  /** Injected real Lim.run adapter. Absent ⇒ unavailable ⇒ rendered:false. */
  sdk?: LimSdk;
  /** Hard cap so a browser cold start never stalls the demo. Default 12s. */
  timeoutMs?: number;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 12_000;

/**
 * Visually re-verify the fix on the fork. Always resolves (never throws) so the
 * orchestrator can fire it in parallel with ship without risk. Unavailable /
 * timeout / error all map to a benign `{ rendered:false, previewUrl:null }`.
 */
export async function reverifyOnFork(
  input: ReverifyInput,
  deps: ReverifyDeps = {},
): Promise<Reverification> {
  const { apiKey, sdk, timeoutMs = DEFAULT_TIMEOUT_MS } = deps;

  // Not wired / no key ⇒ honestly unavailable. Pipeline continues unchanged.
  if (!apiKey || !sdk) {
    return { rendered: false, previewUrl: null, reason: 'unavailable' };
  }

  try {
    // SEAM — the only Lim.run call. Bounded so a cold start can't stall ship.
    const result = await withTimeout(
      sdk.renderAndCount({ url: input.forkBaseUrl, sessionJwt: input.forkJwt }),
      timeoutMs,
    );
    const previewUrl = result.previewUrl || null;

    // rowsShown < 0 ⇒ instance is live (previewUrl works) but no automated count
    // ran. Honest middle state: surface the clickable fork, claim no pass.
    if (result.rowsShown < 0) {
      return { rendered: false, previewUrl, shotUrl: result.shotUrl, reason: 'preview_only' };
    }

    const rendered = result.rowsShown >= input.expectedRows && input.expectedRows > 0;
    return {
      rendered,
      previewUrl,
      shotUrl: result.shotUrl,
      reason: rendered ? undefined : 'mismatch',
    };
  } catch (err) {
    const reason = err instanceof TimeoutError ? 'timeout' : 'error';
    // eslint-disable-next-line no-console
    console.warn(`[hush:limrun] reverify ${reason}: ${err instanceof Error ? err.message : String(err)}`);
    return { rendered: false, previewUrl: null, reason };
  }
}

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new TimeoutError(`timeout after ${ms}ms`)), ms)),
  ]);
}
