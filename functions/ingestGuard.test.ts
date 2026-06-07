// functions/ingestGuard.test.ts
// Acceptance tests for ingest abuse controls (ticket 0061).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GUARD_CONFIG,
  guardIngest,
  originAllowed,
  replayStatus,
  TokenBucket,
  type IngestGuardConfig,
  type IngestRequest,
} from './ingestGuard.js';

const now = 1_000_000;
const config: IngestGuardConfig = { allowedOrigins: ['https://shop.acme.com', '*.staging.acme.com'], ...DEFAULT_GUARD_CONFIG };
const req = (over: Partial<IngestRequest> = {}): IngestRequest => ({
  origin: 'https://shop.acme.com', payloadBytes: 1024, timestamp: now, nonce: 'n1', ...over,
});
const fullBucket = () => new TokenBucket(5, 1, () => now);

describe('originAllowed', () => {
  it('exact origin matches', () => {
    expect(originAllowed('https://shop.acme.com', config.allowedOrigins)).toBe(true);
  });
  it('wildcard matches one subdomain level', () => {
    expect(originAllowed('https://preview.staging.acme.com', config.allowedOrigins)).toBe(true);
  });
  it('wildcard does not match a deeper subdomain', () => {
    expect(originAllowed('https://a.b.staging.acme.com', config.allowedOrigins)).toBe(false);
  });
  it('an unrelated origin is rejected', () => {
    expect(originAllowed('https://evil.com', config.allowedOrigins)).toBe(false);
  });
  it('is case-insensitive', () => {
    expect(originAllowed('https://SHOP.acme.com', config.allowedOrigins)).toBe(true);
  });
});

describe('replayStatus', () => {
  it('a fresh, unseen request is ok', () => {
    expect(replayStatus(req(), new Set(), now, config.clockSkewMs)).toBe('ok');
  });
  it('a stale timestamp (outside skew) is rejected', () => {
    expect(replayStatus(req({ timestamp: now - 10 * 60 * 1000 }), new Set(), now, config.clockSkewMs)).toBe('stale');
  });
  it('a reused nonce is a replay', () => {
    expect(replayStatus(req({ nonce: 'used' }), new Set(['used']), now, config.clockSkewMs)).toBe('replay');
  });
});

describe('guardIngest — admission with correct status codes', () => {
  it('admits a clean request', () => {
    const r = guardIngest(req(), config, fullBucket(), new Set(), now);
    expect(r.accept).toBe(true);
    expect(r.status).toBe(200);
  });

  it('rejects a forbidden origin with 403', () => {
    const r = guardIngest(req({ origin: 'https://evil.com' }), config, fullBucket(), new Set(), now);
    expect(r.status).toBe(403);
    expect(r.code).toBe('forbidden_origin');
  });

  it('rejects an oversized payload with 413', () => {
    const r = guardIngest(req({ payloadBytes: 10_000_000 }), config, fullBucket(), new Set(), now);
    expect(r.status).toBe(413);
    expect(r.code).toBe('payload_too_large');
  });

  it('rejects a replayed nonce with 400', () => {
    const r = guardIngest(req({ nonce: 'dup' }), config, fullBucket(), new Set(['dup']), now);
    expect(r.status).toBe(400);
    expect(r.code).toBe('replay');
  });

  it('rejects a stale request with 400', () => {
    const r = guardIngest(req({ timestamp: now - 99 * 60 * 1000 }), config, fullBucket(), new Set(), now);
    expect(r.status).toBe(400);
    expect(r.code).toBe('stale');
  });

  it('rejects with 429 once the rate bucket is drained', () => {
    const bucket = new TokenBucket(1, 0, () => now); // 1 token, no refill
    expect(guardIngest(req({ nonce: 'a' }), config, bucket, new Set(), now).accept).toBe(true);
    const r = guardIngest(req({ nonce: 'b' }), config, bucket, new Set(), now);
    expect(r.status).toBe(429);
    expect(r.code).toBe('rate_limited');
  });

  it('a bad-origin flood never drains the rate bucket (static checks first)', () => {
    const bucket = new TokenBucket(1, 0, () => now);
    for (let i = 0; i < 10; i++) guardIngest(req({ origin: 'https://evil.com' }), config, bucket, new Set(), now);
    // the one good token is still there for a legitimate request
    expect(guardIngest(req(), config, bucket, new Set(), now).accept).toBe(true);
  });
});
