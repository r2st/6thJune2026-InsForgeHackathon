// functions/replay.test.ts
// Acceptance tests for the parallel replay + verdict (ticket 0008).
//
// Run: pnpm -F @hush/functions test
//
// The real HTTP is injected (deps.fetch) so the load-bearing logic — row
// counting, the two-signal verdict, parallelism, JWT routing, cache-bypass,
// and error handling — is verified hermetically, no live branch required.

import { describe, expect, it, vi } from 'vitest';
import type { ReplayPayload } from './types.js';
import { replayBoth, countRows, type ReplayDeps } from './replay.js';

function payload(over: Partial<ReplayPayload> = {}): ReplayPayload {
  return {
    method: 'GET',
    path: '/rest/orders',
    headers: { accept: 'application/json' },
    body: null,
    query: { select: '*' },
    ts: '2026-06-06T19:00:00.000Z',
    jwt: 'PROD.JWT',
    expectedRows: 3,
    ...over,
  };
}

/** A fetch that returns a fixed body per base-url substring. */
function fakeFetch(byHost: { prod: BodyInit; fork: BodyInit; status?: number }) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    const isFork = u.includes('fork.example');
    const body = isFork ? byHost.fork : byHost.prod;
    return new Response(body as BodyInit, { status: byHost.status ?? 200 });
  });
}

function deps(over: Partial<ReplayDeps>): Partial<ReplayDeps> {
  return {
    prodBaseUrl: 'https://prod.example',
    forkBaseUrl: 'https://fork.example',
    now: (() => {
      let t = 1000;
      return () => (t += 5);
    })(),
    ...over,
  };
}

// ── the money shot: prod red, fork green ─────────────────────────────────────

describe('replayBoth — the demo verdict (slide 06)', () => {
  it('prod 0 rows, fork 3 rows → bugConfirmed + fixVerified', async () => {
    const fetchFn = fakeFetch({ prod: '[]', fork: '[{"id":1},{"id":2},{"id":3}]' });
    const v = await replayBoth({ payload: payload(), branchId: 'b1', forkJwt: 'FORK.JWT' }, deps({ fetch: fetchFn as unknown as typeof fetch }));

    expect(v.prod.rowsReturned).toBe(0);
    expect(v.fork.rowsReturned).toBe(3);
    expect(v.bugConfirmed).toBe(true);
    expect(v.fixVerified).toBe(true);
    expect(v.rationale).toMatch(/reproduced, fix verified/);
  });

  it('sends the original JWT to prod and the forged JWT to the fork', async () => {
    const fetchFn = fakeFetch({ prod: '[]', fork: '[{"id":1},{"id":2},{"id":3}]' });
    await replayBoth({ payload: payload(), branchId: 'b1', forkJwt: 'FORK.JWT' }, deps({ fetch: fetchFn as unknown as typeof fetch }));

    const calls = (fetchFn as any).mock.calls as Array<[string, RequestInit]>;
    const prodCall = calls.find(([u]) => u.includes('prod.example'))!;
    const forkCall = calls.find(([u]) => u.includes('fork.example'))!;
    expect((prodCall[1].headers as Record<string, string>).authorization).toBe('Bearer PROD.JWT');
    expect((forkCall[1].headers as Record<string, string>).authorization).toBe('Bearer FORK.JWT');
  });

  it('sets cache-bypass headers on both requests', async () => {
    const fetchFn = fakeFetch({ prod: '[]', fork: '[]' });
    await replayBoth({ payload: payload(), branchId: 'b1', forkJwt: 'FORK.JWT' }, deps({ fetch: fetchFn as unknown as typeof fetch }));
    for (const [, init] of (fetchFn as any).mock.calls as Array<[string, RequestInit]>) {
      const h = init.headers as Record<string, string>;
      expect(h['cache-control']).toContain('no-store');
      expect(h.pragma).toBe('no-cache');
      expect(h['x-hush-cache-bust']).toBe('2026-06-06T19:00:00.000Z');
    }
  });
});

// ── two-signal discipline ────────────────────────────────────────────────────

describe('replayBoth — neither signal alone is success', () => {
  it('fork still short of expected → fixVerified false, not confirmed', async () => {
    const fetchFn = fakeFetch({ prod: '[]', fork: '[{"id":1}]' }); // 1 < 3
    const v = await replayBoth({ payload: payload(), branchId: 'b', forkJwt: 'F' }, deps({ fetch: fetchFn as unknown as typeof fetch }));
    expect(v.fixVerified).toBe(false);
    expect(v.bugConfirmed).toBe(false);
    expect(v.rationale).toMatch(/not a fix/);
  });

  it('prod already returned enough rows → no bug to reproduce', async () => {
    const fetchFn = fakeFetch({ prod: '[{"id":1},{"id":2},{"id":3}]', fork: '[{"id":1},{"id":2},{"id":3}]' });
    const v = await replayBoth({ payload: payload(), branchId: 'b', forkJwt: 'F' }, deps({ fetch: fetchFn as unknown as typeof fetch }));
    expect(v.bugConfirmed).toBe(false); // prod not < expected
    expect(v.fixVerified).toBe(true);
    expect(v.rationale).toMatch(/no bug to reproduce/);
  });
});

// ── errors ───────────────────────────────────────────────────────────────────

describe('replayBoth — transport errors withhold the verdict', () => {
  it('fork throws → bugConfirmed false, rationale names the side', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('fork.example')) throw new Error('ECONNREFUSED');
      return new Response('[]', { status: 200 });
    });
    const v = await replayBoth({ payload: payload(), branchId: 'b', forkJwt: 'F' }, deps({ fetch: fetchFn as unknown as typeof fetch }));
    expect(v.bugConfirmed).toBe(false);
    expect(v.fixVerified).toBe(false);
    expect(v.rationale).toMatch(/replay error on fork \(ECONNREFUSED\)/);
    expect(v.fork.status).toBe(0);
  });
});

// ── latency + parallelism ────────────────────────────────────────────────────

describe('replayBoth — latency reported, runs in parallel', () => {
  it('reports per-side latency from the injected clock', async () => {
    const fetchFn = fakeFetch({ prod: '[]', fork: '[{"id":1},{"id":2},{"id":3}]' });
    const v = await replayBoth({ payload: payload(), branchId: 'b', forkJwt: 'F' }, deps({ fetch: fetchFn as unknown as typeof fetch }));
    expect(v.prod.latencyMs).toBeGreaterThan(0);
    expect(v.fork.latencyMs).toBeGreaterThan(0);
  });

  it('issues both requests before either resolves (parallel, not serial)', async () => {
    let inflight = 0;
    let maxInflight = 0;
    const fetchFn = vi.fn(async () => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      return new Response('[]', { status: 200 });
    });
    await replayBoth({ payload: payload(), branchId: 'b', forkJwt: 'F' }, deps({ fetch: fetchFn as unknown as typeof fetch }));
    expect(maxInflight).toBe(2); // both in flight at once
  });
});

// ── countRows: PostgREST / InsForge body shapes ──────────────────────────────

describe('countRows — body shapes', () => {
  it('bare array', () => expect(countRows('[{"a":1},{"a":2}]')).toBe(2));
  it('{ data: [...] }', () => expect(countRows('{"data":[{"a":1}]}')).toBe(1));
  it('{ rows: [...] }', () => expect(countRows('{"rows":[1,2,3]}')).toBe(3));
  it('count envelope', () => expect(countRows('{"count":7}')).toBe(7));
  it('unparseable → 0', () => expect(countRows('not json')).toBe(0));
  it('scalar object → 0', () => expect(countRows('{"ok":true}')).toBe(0));
  it('empty array → 0', () => expect(countRows('[]')).toBe(0));
});

// ── snippet cap ──────────────────────────────────────────────────────────────

describe('replayBoth — snippet is short + embeddable', () => {
  it('caps the snippet at 200 chars', async () => {
    const big = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: i })));
    const fetchFn = fakeFetch({ prod: '[]', fork: big });
    const v = await replayBoth({ payload: payload(), branchId: 'b', forkJwt: 'F' }, deps({ fetch: fetchFn as unknown as typeof fetch }));
    expect(v.fork.snippet.length).toBeLessThanOrEqual(200);
  });
});
