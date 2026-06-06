// ReplicasCapture — the production capture source (Replicas sponsor).
//
// ⚠️ API NOT YET VERIFIED. Replicas' public SDK surface did not surface in
// research (see ticket 0041 Notes). Rather than guess method names, this
// adapter isolates every Replicas call behind a single `ReplicasSdk` port.
// Wire the real SDK at the THREE marked seams once you have their docs; the
// rest of Hush is unaffected because it only sees the CaptureSource interface.
//
// Until the SDK is wired (or if REPLICAS_API_KEY is unset / init fails),
// `isReady()` returns false and the factory falls back to rrweb. The demo
// therefore has ZERO hard dependency on Replicas being up.
//
// Ticket: agents/tasks/0041-replicas-session-capture-source.md

import type { CaptureSource, CaptureBundle } from './types';

/** The minimal port Hush needs from Replicas. Map to their real SDK at wiring. */
export interface ReplicasSdk {
  /** Begin recording the session. */
  startRecording(): void;
  /** Stop recording. */
  stopRecording(): void;
  /** Return the current session's replay events + hosted clip URL, and reset. */
  drain(): { events: unknown[]; clipUrl?: string };
}

export interface ReplicasCaptureOptions {
  apiKey: string | undefined;
  /** Inject a real SDK adapter. Absent ⇒ not ready ⇒ caller falls back. */
  sdk?: ReplicasSdk;
}

export class ReplicasCapture implements CaptureSource {
  readonly source = 'replicas' as const;
  private sdk: ReplicasSdk | null;

  constructor(opts: ReplicasCaptureOptions) {
    // SEAM 1 — init. With a key + a real SDK adapter injected, use it.
    // Without either, stay un-ready so the factory falls back to rrweb.
    this.sdk = opts.apiKey && opts.sdk ? opts.sdk : null;
  }

  start(): void {
    // SEAM 2 — start recording.
    this.sdk?.startRecording();
  }

  stop(): void {
    this.sdk?.stopRecording();
  }

  flush(): CaptureBundle {
    // SEAM 3 — drain the session into a bundle.
    if (!this.sdk) return { events: [], source: 'replicas' };
    const { events, clipUrl } = this.sdk.drain();
    return { events, clipUrl, source: 'replicas' };
  }

  isReady(): boolean {
    return this.sdk !== null;
  }
}
