// Real Lim.run adapter for the LimSdk port (ticket 0042).
//
// VERIFIED 2026-06-06 against the live API with @limrun/api v0.30.0:
//   - new Limrun({ apiKey }) authenticates (LIM_API_KEY).
//   - androidInstances.create({ wait:true, spec:{ sandbox:{ playwrightAndroid:
//     { enabled:true } }, hardTimeout } }) reaches state 'ready' and returns:
//       status.signedStreamUrl              → the shareable live preview ✓
//       status.sandbox.playwrightAndroid.url → a wss:// Playwright endpoint ✓
//   - androidInstances.delete(id) tears it down ✓
//
// What this adapter does today: provisions the instance and returns the
// signedStreamUrl as the preview. The automated row-count (drive mobile Chrome
// to the fork's /orders over the Playwright wss and count rows) is behind the
// optional `countRows` hook — when it's not supplied we return rowsShown:-1,
// which reverifyOnFork maps to the honest `preview_only` state (live link, no
// claimed pass). Wire `countRows` once the toy app is deployed against a fork
// so the drive path can be verified end to end.

import Limrun from '@limrun/api';
import type { LimSdk } from '../limReverify.js';

export interface LimSdkOptions {
  apiKey: string;
  /** Minutes before Lim.run auto-terminates the instance. Default '5m'. */
  hardTimeout?: string;
  /**
   * Optional real page driver: given the Playwright wss endpoint, the fork URL,
   * and the session JWT, open the orders page and return the rendered row count.
   * Absent ⇒ adapter returns rowsShown:-1 (preview_only). Kept injectable so the
   * Playwright dependency stays out of the edge bundle until it's needed.
   */
  countRows?: (args: {
    playwrightWsUrl: string;
    url: string;
    sessionJwt: string;
  }) => Promise<number>;
}

/** Build a LimSdk backed by the real Lim.run API. */
export function createLimSdk(opts: LimSdkOptions): LimSdk {
  const client = new Limrun({ apiKey: opts.apiKey });
  const hardTimeout = opts.hardTimeout ?? '5m';

  return {
    async renderAndCount({ url, sessionJwt }) {
      const inst = await client.androidInstances.create({
        wait: true,
        spec: {
          sandbox: { playwrightAndroid: { enabled: true } },
          hardTimeout,
        },
      });
      const id = inst.metadata?.id;
      const status = inst.status ?? {};
      const previewUrl = status.signedStreamUrl ?? '';
      const pwUrl = status.sandbox?.playwrightAndroid?.url;

      try {
        let rowsShown = -1; // -1 = not counted ⇒ preview_only
        if (opts.countRows && pwUrl) {
          rowsShown = await opts.countRows({ playwrightWsUrl: pwUrl, url, sessionJwt });
        }
        return { rowsShown, previewUrl };
      } finally {
        // Best-effort teardown; hardTimeout is the backstop if this misses.
        if (id) {
          await client.androidInstances.delete(id).catch(() => {});
        }
      }
    },
  };
}
