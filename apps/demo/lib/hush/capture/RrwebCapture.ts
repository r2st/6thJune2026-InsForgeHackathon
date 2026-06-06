// RrwebCapture — the fallback / demo-offline capture source. Wraps the
// existing rrweb ring buffer (ticket 0023) behind the CaptureSource interface.
// Always ready (no network), so the demo never hard-depends on a vendor API.
//
// Ticket: agents/tasks/0041-replicas-session-capture-source.md

import { start as startBuffer, stopRecording, flush as flushBuffer } from '../capture';
import type { CaptureSource, CaptureBundle } from './types';

export class RrwebCapture implements CaptureSource {
  readonly source = 'rrweb' as const;

  start(): void {
    startBuffer();
  }

  stop(): void {
    stopRecording();
  }

  flush(): CaptureBundle {
    return { events: flushBuffer(), source: 'rrweb' };
  }

  isReady(): boolean {
    return true; // rrweb is in-process; always available
  }
}
