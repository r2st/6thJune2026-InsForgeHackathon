// functions/ingestGuard.ts
// Ingest abuse controls — origin allowlist, payload caps, rate limit, replay block.
//
// Ticket:  agents/tasks/0061-security-hardening.md
// Defends: Hush accepts untrusted session data from the public internet. The
//          `ingest` endpoint is a real attack vector — a hostile site can flood it,
//          replay captures to poison runs, or post oversized payloads. These are
//          the request-admission controls that sit in front of the existing
//          sanitise/prompt-injection wall.
//
// Pure, testable core: a single `guardIngest` that admits a capture only if its
// origin is allowlisted for the site, its payload is within cap, the workspace is
// under its rate limit, and the request isn't a stale/replayed one (timestamp +
// nonce). Each failure maps to the right HTTP status. The TokenBucket is reused
// from llmChain (no second rate-limiter). The origin allowlist source, the nonce
// store, secret rotation, and the re-enabled SAST/dep scan are the seam.

import { TokenBucket } from './llmChain.js';

export { TokenBucket };

export interface IngestGuardConfig {
  /** Origins allowed to post for this site (exact, or `*.example.com` wildcard). */
  allowedOrigins: string[];
  /** Hard cap on the capture payload size. */
  maxPayloadBytes: number;
  /** How far a request timestamp may differ from now before it's stale (ms). */
  clockSkewMs: number;
}

export const DEFAULT_GUARD_CONFIG: Omit<IngestGuardConfig, 'allowedOrigins'> = {
  maxPayloadBytes: 512 * 1024, // 512 KiB — an rrweb slice, not a dump
  clockSkewMs: 5 * 60 * 1000,  // 5 minutes
};

export interface IngestRequest {
  origin: string;
  payloadBytes: number;
  /** Request timestamp (ms epoch) the client signed into the capture. */
  timestamp: number;
  /** Single-use nonce the client minted for this capture. */
  nonce: string;
}

export type RejectCode = 'forbidden_origin' | 'payload_too_large' | 'rate_limited' | 'replay' | 'stale';

export interface GuardResult {
  accept: boolean;
  /** HTTP status the edge function should return. */
  status: 200 | 400 | 403 | 413 | 429;
  code?: RejectCode;
  reason: string;
}

/** Exact match, or a `*.domain` wildcard covering one subdomain level. */
export function originAllowed(origin: string, allowlist: string[]): boolean {
  const o = origin.trim().toLowerCase();
  for (const raw of allowlist) {
    const entry = raw.trim().toLowerCase();
    if (entry === o) return true;
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1); // ".domain.com"
      // match `https://sub.domain.com` — one label before the suffix, no deeper.
      const host = o.replace(/^https?:\/\//, '');
      if (host.endsWith(suffix)) {
        const label = host.slice(0, host.length - suffix.length);
        if (label.length > 0 && !label.includes('.')) return true;
      }
    }
  }
  return false;
}

/**
 * The replay/stale check: reject a request whose timestamp is outside the skew
 * window (too old or implausibly future) or whose nonce was already used. `seen`
 * is the set of nonces observed within the window (the caller prunes it by time).
 */
export function replayStatus(
  req: IngestRequest,
  seen: ReadonlySet<string>,
  now: number,
  skewMs: number,
): 'ok' | 'stale' | 'replay' {
  if (Math.abs(now - req.timestamp) > skewMs) return 'stale';
  if (seen.has(req.nonce)) return 'replay';
  return 'ok';
}

/**
 * Admit (or reject) an ingest request. Checks run cheapest-first and map to the
 * correct status: forbidden origin (403) → oversized payload (413) → rate limit
 * (429) → stale/replay (400). The rate bucket is consumed only AFTER the static
 * checks pass, so a flood of bad-origin junk can't drain a workspace's token bucket.
 */
export function guardIngest(
  req: IngestRequest,
  config: IngestGuardConfig,
  rateBucket: TokenBucket,
  seenNonces: ReadonlySet<string>,
  now: number,
): GuardResult {
  if (!originAllowed(req.origin, config.allowedOrigins)) {
    return { accept: false, status: 403, code: 'forbidden_origin', reason: `origin ${req.origin} not allowlisted for this site` };
  }
  if (req.payloadBytes > config.maxPayloadBytes) {
    return { accept: false, status: 413, code: 'payload_too_large', reason: `payload ${req.payloadBytes}B exceeds the ${config.maxPayloadBytes}B cap` };
  }
  const replay = replayStatus(req, seenNonces, now, config.clockSkewMs);
  if (replay === 'stale') {
    return { accept: false, status: 400, code: 'stale', reason: 'request timestamp outside the allowed skew window — stale or clock-skewed' };
  }
  if (replay === 'replay') {
    return { accept: false, status: 400, code: 'replay', reason: 'nonce already used — replayed capture rejected' };
  }
  // Static checks passed — now spend a rate-limit token.
  if (!rateBucket.tryTake()) {
    return { accept: false, status: 429, code: 'rate_limited', reason: 'workspace ingest rate limit exceeded — back off and retry' };
  }
  return { accept: true, status: 200, reason: 'admitted — origin, size, freshness, and rate all OK' };
}
