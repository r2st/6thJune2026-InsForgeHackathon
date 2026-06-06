'use client';
// Mounts rrweb capture + frustration-signal detector once on the client,
// and exposes a small console API at `window.Hush` so the acceptance
// checks ("flush from the console", "fire a rage-click") work without
// instrumenting the page.
//
// On a signal it flushes the rrweb buffer and POSTs it to the ingest
// edge function via sendCapture() (ticket 0014). The session id that
// tags those events is the same one the wrapped client stamps on every
// InsForge request, so the backend can correlate symptom → cause.

import { useEffect } from 'react';
import { peek, size } from './capture';
import { start as startSignals, type Signal } from './signals';
import { sendCapture, sessionId } from './insforge-client';
import { resolveCaptureSource } from './capture/index';

declare global {
  interface Window {
    Hush?: {
      flush: () => unknown[];
      peek: typeof peek;
      size: typeof size;
      sessionId: typeof sessionId;
      source?: 'replicas' | 'rrweb';
      lastSignal?: Signal | null;
    };
  }
}

export function CaptureProvider(): null {
  useEffect(() => {
    // Replicas when its key + SDK are present and ready; rrweb otherwise (0041).
    const capture = resolveCaptureSource({
      replicasApiKey: process.env.NEXT_PUBLIC_REPLICAS_API_KEY,
      // replicasSdk: <inject the real Replicas SDK adapter here once wired>
    });
    capture.start();

    const stopSignals = startSignals({
      onSignal(s) {
        const bundle = capture.flush();
        if (window.Hush) window.Hush.lastSignal = s;
        // Fire and forget — capture must never block the app.
        void sendCapture({
          sessionId: sessionId(),
          signal: { kind: s.kind, target: s.target, at: s.at, url: s.url },
          events: bundle.events,
          captureSource: bundle.source,
          clipUrl: bundle.clipUrl,
          ctx: {
            url: s.url,
            route: typeof location !== 'undefined' ? location.pathname : undefined,
            viewport:
              typeof window !== 'undefined'
                ? { w: window.innerWidth, h: window.innerHeight }
                : undefined,
            buildSha: process.env.NEXT_PUBLIC_BUILD_SHA,
          },
        });
      },
    });
    window.Hush = {
      flush: () => capture.flush().events,
      peek,
      size,
      sessionId,
      source: capture.source,
      lastSignal: null,
    };
    return () => {
      stopSignals();
      capture.stop();
    };
  }, []);
  return null;
}
