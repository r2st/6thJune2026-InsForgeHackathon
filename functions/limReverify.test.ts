import { describe, it, expect } from 'vitest';
import { reverifyOnFork, type LimSdk, type ReverifyInput } from './limReverify.js';

const input: ReverifyInput = {
  branchId: 'fork-1',
  forkBaseUrl: 'https://fork-1.demo.local',
  forkJwt: 'jwt.fork.sig',
  expectedRows: 3,
};

function sdk(rowsShown: number, previewUrl = 'https://lim.run/p/abc'): LimSdk {
  return { async renderAndCount() { return { rowsShown, previewUrl }; } };
}

describe('reverifyOnFork (0042) — corroboration only', () => {
  it('returns unavailable (never throws) when no key/SDK is wired', async () => {
    const r = await reverifyOnFork(input, {});
    expect(r).toEqual({ rendered: false, previewUrl: null, reason: 'unavailable' });
  });

  it('renders true when the fork shows >= expectedRows, with a preview URL', async () => {
    const r = await reverifyOnFork(input, { apiKey: 'k', sdk: sdk(3) });
    expect(r.rendered).toBe(true);
    expect(r.previewUrl).toContain('lim.run');
    expect(r.reason).toBeUndefined();
  });

  it('renders false (mismatch) when the fork shows fewer rows than expected', async () => {
    const r = await reverifyOnFork(input, { apiKey: 'k', sdk: sdk(0) });
    expect(r.rendered).toBe(false);
    expect(r.reason).toBe('mismatch');
    // still returns the preview URL so the judge can see the (wrong) state
    expect(r.previewUrl).toContain('lim.run');
  });

  it('maps a thrown SDK error to a benign error result, never rejects', async () => {
    const boom: LimSdk = { async renderAndCount() { throw new Error('boom'); } };
    const r = await reverifyOnFork(input, { apiKey: 'k', sdk: boom });
    expect(r).toEqual({ rendered: false, previewUrl: null, reason: 'error' });
  });

  it('times out to a benign timeout result without hanging', async () => {
    const slow: LimSdk = {
      renderAndCount: () => new Promise(() => {}), // never resolves
    };
    const r = await reverifyOnFork(input, { apiKey: 'k', sdk: slow, timeoutMs: 20 });
    expect(r).toEqual({ rendered: false, previewUrl: null, reason: 'timeout' });
  });

  it('never renders true when expectedRows is 0 (no false positive on empty)', async () => {
    const r = await reverifyOnFork({ ...input, expectedRows: 0 }, { apiKey: 'k', sdk: sdk(0) });
    expect(r.rendered).toBe(false);
  });
});
