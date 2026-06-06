'use client';
// Mounts rrweb capture + frustration-signal detector once on the client,
// and exposes a small console API at `window.Hush` so the acceptance
// checks ("flush from the console", "fire a rage-click") work without
// instrumenting the page.
//
// Ticket 0013 will replace the console.log stub with a real POST to
// the /capture edge function.

import { useEffect } from 'react';
import { start as startCapture, flush, peek, size } from './capture';
import { start as startSignals, type Signal } from './signals';

declare global {
  interface Window {
    Hush?: {
      flush: typeof flush;
      peek: typeof peek;
      size: typeof size;
      lastSignal?: Signal | null;
    };
  }
}

export function CaptureProvider(): null {
  useEffect(() => {
    startCapture();
    const stopSignals = startSignals({
      onSignal(s) {
        // TODO(0013): POST { signal: s, events: flush(), ctx } to /capture.
        // For now: log + stash on window so the demo and tests can see it.
        const events = flush();
        // eslint-disable-next-line no-console
        console.info('[hush] signal', s.kind, { target: s.target, events: events.length });
        if (window.Hush) window.Hush.lastSignal = s;
      },
    });
    window.Hush = { flush, peek, size, lastSignal: null };
    return stopSignals;
  }, []);
  return null;
}
