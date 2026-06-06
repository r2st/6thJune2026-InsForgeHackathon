// functions/forgeJwt.ts
//
// Re-sign the captured prod claims with the fork's key so the replay against
// the branch project authenticates as the same user the bug bit.
//
// Ticket: agents/tasks/0007-jwt-forge.md
//
// Why this exists: the captured JWT is signed by prod's key and won't verify
// against the fork. The whole point of the fork is to test the *policy* against
// the exact claims the user carried — so we preserve the claims verbatim
// (`sub`, `tenant`, `tenant_ids`, …), rewrite only iss/aud to the fork's
// values, and re-sign with the fork's secret. The buggy and migrated claim
// shapes (`tenant` vs `tenant_ids[]`) are exactly what we must keep intact —
// that mismatch IS the bug.
//
// Not a security risk in the hackathon context: we provisioned both ends of the
// fork and hold its secret. Production needs a different model — follow-up ADR.

import { createHmac } from 'node:crypto';
import { getEntry, type PoolEntry } from './lib/pool.js';
import { decodeJwtBody, type JwtClaims } from './lib/jwt.js';

/** Standard registered claims we rewrite or stamp; everything else is verbatim. */
const REWRITTEN_CLAIMS = ['iss', 'aud', 'iat', 'exp'] as const;

/** Forged tokens live just long enough to drive one replay. */
const DEFAULT_TTL_SEC = 300;

export interface ForgeOptions {
  /** Token lifetime from `now`. Defaults to 5 minutes. */
  ttlSec?: number;
  /** Injectable clock (ms) — defaults to Date.now for hermetic tests. */
  now?: () => number;
  /** Override pool lookup (tests). Defaults to reading .hush/pool.json by id. */
  resolveEntry?: (branchId: string) => PoolEntry;
}

/**
 * Forge a Bearer-ready JWT signed by the fork's key, carrying the original
 * user's claims. Pass either the raw captured token or its decoded claims.
 */
export function forgeForkJwt(
  branchId: string,
  original: string | JwtClaims,
  opts: ForgeOptions = {},
): string {
  const now = opts.now ?? Date.now;
  const ttlSec = opts.ttlSec ?? DEFAULT_TTL_SEC;
  if (ttlSec <= 0) throw new Error('forgeJwt: refusing to forge — exp would be in the past');

  const resolve = opts.resolveEntry ?? ((id: string) => getEntry(id));
  const fork = resolve(branchId);
  if (!fork.jwtSecret) throw new Error(`forgeJwt: fork ${branchId} has no jwtSecret in pool`);

  const claims = typeof original === 'string' ? decodeJwtBody(original) : original;

  const iat = Math.floor(now() / 1000);
  const exp = iat + ttlSec;

  // Preserve every captured claim verbatim, then overwrite only the fork-bound
  // registered claims. The user's identity (sub) and tenant shape pass through
  // untouched — that's the contract this whole step exists to honour.
  const payload: Record<string, unknown> = { ...claims };
  for (const k of REWRITTEN_CLAIMS) delete payload[k];
  payload.iat = iat;
  payload.exp = exp;
  if (fork.jwtIssuer) payload.iss = fork.jwtIssuer;
  if (fork.jwtAudience) payload.aud = fork.jwtAudience;

  return sign(payload, fork.jwtSecret);
}

// ── HS256 signing ──────────────────────────────────────────────────────────────

function sign(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encHeader = b64url(JSON.stringify(header));
  const encPayload = b64url(JSON.stringify(payload));
  const signingInput = `${encHeader}.${encPayload}`;
  const sig = createHmac('sha256', secret).update(signingInput).digest('base64');
  return `${signingInput}.${toUrlSafe(sig)}`;
}

function b64url(s: string): string {
  return toUrlSafe(Buffer.from(s, 'utf8').toString('base64'));
}

function toUrlSafe(b64: string): string {
  return b64.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
