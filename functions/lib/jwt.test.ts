import { describe, it, expect } from 'vitest';
import { decodeJwtBody, tenantFromClaims } from './jwt.js';

function makeJwt(body: object): string {
  const b64 = (s: string) =>
    Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64('{}')}.${b64(JSON.stringify(body))}.sig`;
}

describe('jwt', () => {
  it('decodes the body of a valid JWT', () => {
    const jwt = makeJwt({ sub: 'u1', tenant: 't-buggy' });
    expect(decodeJwtBody(jwt)).toEqual({ sub: 'u1', tenant: 't-buggy' });
  });

  it('throws on a malformed JWT', () => {
    expect(() => decodeJwtBody('not-a-jwt')).toThrow(/malformed/);
  });

  it('prefers tenant (singular) over tenant_ids when both are present', () => {
    expect(tenantFromClaims({ tenant: 'a', tenant_ids: ['b'] })).toBe('a');
  });

  it('falls back to first tenant_ids entry when tenant is missing', () => {
    expect(tenantFromClaims({ tenant_ids: ['b', 'c'] })).toBe('b');
  });

  it('returns null when neither shape is present', () => {
    expect(tenantFromClaims({ sub: 'u1' })).toBeNull();
  });
});
