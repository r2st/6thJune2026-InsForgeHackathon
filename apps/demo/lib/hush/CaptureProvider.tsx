'use client';
// Mounts rrweb capture once on the client and exposes a small console API
// at `window.Hush` so the acceptance check ("flush from the console")
// works without instrumenting the page.

import { useEffect } from 'react';
import { start, flush, peek, size } from './capture';

declare global {
  interface Window {
    Hush?: {
      flush: typeof flush;
      peek: typeof peek;
      size: typeof size;
    };
  }
}

export function CaptureProvider(): null {
  useEffect(() => {
    start();
    window.Hush = { flush, peek, size };
  }, []);
  return null;
}
