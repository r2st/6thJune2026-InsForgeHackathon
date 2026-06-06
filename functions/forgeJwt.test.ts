import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { forgeForkJwt } from './forgeJwt.js';
import type { PoolEntry } from './lib/pool.js';
import { decodeJwtBody } from './lib/jwt.js';

const FORK: PoolEntry = {
  branchId: 'hush-fork-0',
  baseUrl: 'https://fork-0.example.test',
  jwtSecret: 'fork-secret',
  jwtIssuer: 'https://fork-0.example.test/auth',
  jwtAudience: 'fork-0',
  claimedBy: 'run_1',
};

const resolveEntry = () => FORK;
const at = (iso: string) => () => new Date(iso).getTime();

function verify(token: string, secret: string): boolean {
  const [h, p, s] = token.split('.');
  const expected = createHmac('sha256', secret)
    .update(`${h}.${p}`)
    .digest('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return s === expected;
}

describe('forgeForkJwt', () => {
  it('preserves the buggy claim shape (tenant) verbatim', () => {
    const token = forgeForkJwt('hush-fork-0', { sub: 'user_a', tenant: 't-1' }, { resolveEntry, now: at('2026-06-06T18:00:00Z') });
    const claims = decodeJwtBody(token);
    expect(claims.sub).toBe('user_a');
    expect(claims.tenant).toBe('t-1');
  });

  it('preserves the migrated claim shape (tenant_ids[]) verbatim', () => {
    const token = forgeForkJwt('hush-fork-0', { sub: 'user_a', tenant_ids: ['t-1', 't-2'] }, { resolveEntry, now: at('2026-06-06T18:00:00Z') });
    expect(decodeJwtBody(token).tenant_ids).toEqual(['t-1', 't-2']);
  });

  it('rewrites issuer and audience to the fork values', () => {
    const token = forgeForkJwt('hush-fork-0', { sub: 'u', iss: 'prod', aud: 'prod-aud' }, { resolveEntry, now: at('2026-06-06T18:00:00Z') });
    const claims = decodeJwtBody(token);
    expect(claims.iss).toBe(FORK.jwtIssuer);
    expect(claims.aud).toBe(FORK.jwtAudience);
  });

  it('stamps exp at +5min from now and iat at now', () => {
    const token = forgeForkJwt('hush-fork-0', { sub: 'u' }, { resolveEntry, now: at('2026-06-06T18:00:00Z') });
    const claims = decodeJwtBody(token);
    const iat = Math.floor(new Date('2026-06-06T18:00:00Z').getTime() / 1000);
    expect(claims.iat).toBe(iat);
    expect(claims.exp).toBe(iat + 300);
  });

  it('signature verifies against the fork secret', () => {
    const token = forgeForkJwt('hush-fork-0', { sub: 'u' }, { resolveEntry, now: at('2026-06-06T18:00:00Z') });
    expect(verify(token, FORK.jwtSecret)).toBe(true);
    expect(verify(token, 'wrong-secret')).toBe(false);
  });

  it('accepts a raw captured token and re-signs it', () => {
    const b64 = (s: string) =>
      Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const prod = `${b64('{"alg":"RS256"}')}.${b64('{"sub":"user_a","tenant":"t-1"}')}.prodsig`;
    const token = forgeForkJwt('hush-fork-0', prod, { resolveEntry, now: at('2026-06-06T18:00:00Z') });
    expect(decodeJwtBody(token).sub).toBe('user_a');
    expect(verify(token, FORK.jwtSecret)).toBe(true);
  });

  it('refuses to forge with a non-positive ttl (exp in the past)', () => {
    expect(() =>
      forgeForkJwt('hush-fork-0', { sub: 'u' }, { resolveEntry, ttlSec: 0 }),
    ).toThrow(/refusing to forge/);
  });

  it('throws when the fork has no signing secret', () => {
    expect(() =>
      forgeForkJwt('x', { sub: 'u' }, { resolveEntry: () => ({ ...FORK, jwtSecret: '' }) }),
    ).toThrow(/no jwtSecret/);
  });
});
