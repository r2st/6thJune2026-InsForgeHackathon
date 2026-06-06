import { describe, it, expect } from 'vitest';
import { resolveCaptureSource } from './index';
import { RrwebCapture } from './RrwebCapture';

// Ticket 0044: capture is rrweb-only. Replicas is a fix-agent (see
// functions/lib/replicasAgent.ts), not a capture source — so the factory always
// returns rrweb. The CaptureSource interface remains for a future real vendor.

describe('resolveCaptureSource (0044)', () => {
  it('returns the rrweb capture source', () => {
    const src = resolveCaptureSource();
    expect(src.source).toBe('rrweb');
    expect(src instanceof RrwebCapture).toBe(true);
    expect(src.isReady()).toBe(true);
  });

  it('rrweb flush yields an rrweb-tagged bundle', () => {
    const src = resolveCaptureSource();
    const bundle = src.flush();
    expect(bundle.source).toBe('rrweb');
    expect(Array.isArray(bundle.events)).toBe(true);
  });
});
