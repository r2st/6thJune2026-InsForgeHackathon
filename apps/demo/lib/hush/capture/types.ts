// CaptureSource — the seam between Hush's pipeline and whatever records the
// user's session. The rest of Hush depends on THIS interface, never on a
// specific vendor, so swapping Replicas ↔ rrweb changes one factory call.
//
// Ticket: agents/tasks/0041-replicas-session-capture-source.md

export type CaptureProvenance = 'replicas' | 'rrweb';

export interface FrustrationSignal {
  kind: 'rage_click' | 'dead_click' | 'abandoned_form';
  target?: string;
  at: number;
  url: string;
}

/** What a capture source hands the pipeline when a signal fires. */
export interface CaptureBundle {
  /** rrweb-shaped events for receipt-page replay + PR embed. May be [] if the
   *  source hosts its own clip (then `clipUrl` carries the replay instead). */
  events: unknown[];
  /** Provider-hosted clip URL, if the source produces one (Replicas). */
  clipUrl?: string;
  /** Which provider actually produced this bundle — provenance, shown honestly. */
  source: CaptureProvenance;
}

export interface CaptureSource {
  readonly source: CaptureProvenance;
  /** Begin recording. Idempotent. */
  start(): void;
  /** Stop recording and release listeners. */
  stop(): void;
  /** Drain the current window into a bundle and clear it. */
  flush(): CaptureBundle;
  /** True if this source is actually operational (SDK inited, key present). */
  isReady(): boolean;
}
