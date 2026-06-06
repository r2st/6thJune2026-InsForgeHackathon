// Capture-source factory. The pipeline calls resolveCaptureSource() once and
// depends on the returned CaptureSource — never on a concrete vendor.
//
// NOTE (ticket 0044): Replicas was originally slated as a second capture source
// (ticket 0041), but Replicas is a background CODING-AGENT platform, not a
// session-capture tool — it belongs at the Fix step (see
// functions/lib/replicasAgent.ts), not here. So capture is rrweb-only. The
// interface stays so a real future capture vendor can drop in.
//
// Ticket: agents/tasks/0044-replicas-is-a-fix-agent-not-capture.md

import type { CaptureSource } from './types';
import { RrwebCapture } from './RrwebCapture';

export type { CaptureSource, CaptureBundle, CaptureProvenance, FrustrationSignal } from './types';
export { RrwebCapture } from './RrwebCapture';

// reserved for a future real capture vendor; rrweb is the only source today.
export type ResolveOptions = Record<string, never>;

/** Return the capture source. rrweb today (always ready, no network). */
export function resolveCaptureSource(_opts: ResolveOptions = {}): CaptureSource {
  return new RrwebCapture();
}
