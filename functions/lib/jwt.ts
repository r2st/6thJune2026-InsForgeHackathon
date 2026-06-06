// Tiny JWT body decoder.
//
// We rely on the InsForge edge runtime to *verify* the signature before
// invoking us. This helper only decodes the claims so the function body
// can read tenant/user identity from the token.
//
// Ticket: agents/done/0013-capture-edge-function.md

export interface JwtClaims {
  sub?: string;
  /** Demo bug shape — singular. */
  tenant?: string;
  /** New shape after migration. */
  tenant_ids?: string[];
  // Don't enumerate further — claims are bag-of-strings in practice.
  [k: string]: unknown;
}

function base64UrlDecode(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  const safe = pad ? padded + '='.repeat(4 - pad) : padded;
  return Buffer.from(safe, 'base64').toString('utf-8');
}

export function decodeJwtBody(jwt: string): JwtClaims {
  const parts = jwt.split('.');
  if (parts.length < 2 || !parts[1]) throw new Error('malformed jwt');
  return JSON.parse(base64UrlDecode(parts[1])) as JwtClaims;
}

export function tenantFromClaims(c: JwtClaims): string | null {
  if (typeof c.tenant === 'string') return c.tenant;
  if (Array.isArray(c.tenant_ids) && typeof c.tenant_ids[0] === 'string') {
    return c.tenant_ids[0];
  }
  return null;
}
