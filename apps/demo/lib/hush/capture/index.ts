// Capture-source factory. Picks Replicas when it's genuinely ready, else falls
// back to rrweb. The pipeline calls resolveCaptureSource() once and depends on
// the returned CaptureSource — never on which vendor won.
//
// Ticket: agents/tasks/0041-replicas-session-capture-source.md

import type { CaptureSource } from './types';
import { RrwebCapture } from './RrwebCapture';
import { ReplicasCapture, type ReplicasSdk } from './ReplicasCapture';

export type { CaptureSource, CaptureBundle, CaptureProvenance, FrustrationSignal } from './types';
export { RrwebCapture } from './RrwebCapture';
export { ReplicasCapture, type ReplicasSdk } from './ReplicasCapture';

export interface ResolveOptions {
  replicasApiKey?: string | undefined;
  /** Real Replicas SDK adapter, injected at app bootstrap once wired. */
  replicasSdk?: ReplicasSdk;
}

/**
 * Return the best available capture source. Replicas if its key + SDK are
 * present and it reports ready; rrweb otherwise. Pure decision — no side
 * effects until the caller calls .start().
 */
export function resolveCaptureSource(opts: ResolveOptions = {}): CaptureSource {
  const replicas = new ReplicasCapture({ apiKey: opts.replicasApiKey, sdk: opts.replicasSdk });
  if (replicas.isReady()) return replicas;
  return new RrwebCapture();
}
