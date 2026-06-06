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
import { start as startCapture, flush, peek, size } from './capture';
import { start as startSignals, type Signal } from './signals';
import { sendCapture, sessionId } from './insforge-client';

declare global {
  interface Window {
    Hush?: {
      flush: typeof flush;
      peek: typeof peek;
      size: typeof size;
      sessionId: typeof sessionId;
      lastSignal?: Signal | null;
    };
  }
}

export function CaptureProvider(): null {
  useEffect(() => {
    startCapture();
    const stopSignals = startSignals({
      onSignal(s) {
        const events = flush();
        if (window.Hush) window.Hush.lastSignal = s;
        // Fire and forget — capture must never block the app.
        void sendCapture({
          sessionId: sessionId(),
          signal: { kind: s.kind, target: s.target, at: s.at, url: s.url },
          events,
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
    window.Hush = { flush, peek, size, sessionId, lastSignal: null };
    return stopSignals;
  }, []);
  return null;
}
