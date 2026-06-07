// functions/llmChain.test.ts
// Acceptance tests for LLM reliability — failover chain + token bucket (ticket 0055).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import {
  AllProvidersFailedError,
  defaultShouldFailover,
  resolveChain,
  runWithFailover,
  TokenBucket,
  type ProviderSpec,
} from './llmChain.js';

const err = (status?: number, message = 'boom'): Error => {
  const e = new Error(message) as Error & { status?: number };
  if (status !== undefined) e.status = status;
  return e;
};

describe('defaultShouldFailover — classify by status', () => {
  it('fails over on transient / availability errors', () => {
    expect(defaultShouldFailover(err(429))).toBe(true);   // rate limit
    expect(defaultShouldFailover(err(500))).toBe(true);   // server error
    expect(defaultShouldFailover(err(503))).toBe(true);   // unavailable
    expect(defaultShouldFailover(err(402))).toBe(true);   // billing
    expect(defaultShouldFailover(err(403))).toBe(true);   // access
    expect(defaultShouldFailover(err(401))).toBe(true);   // bad key for THIS provider
    expect(defaultShouldFailover(err(undefined))).toBe(true); // network / timeout
  });

  it('fails fast on a genuine malformed request', () => {
    expect(defaultShouldFailover(err(400))).toBe(false);
    expect(defaultShouldFailover(err(422))).toBe(false);
  });
});

describe('runWithFailover — advance until one answers', () => {
  const chain: ProviderSpec[] = [
    { provider: 'gemini', model: 'gemini-2.5-flash' },
    { provider: 'anthropic', model: 'claude-opus-4-8' },
  ];

  it('returns the first provider when it succeeds — no failover', async () => {
    const seen: string[] = [];
    const r = await runWithFailover(chain, async (s) => {
      seen.push(s.provider);
      return `ok:${s.provider}`;
    });
    expect(r.result).toBe('ok:gemini');
    expect(r.used.provider).toBe('gemini');
    expect(seen).toEqual(['gemini']);
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0]).toMatchObject({ provider: 'gemini', ok: true });
  });

  it('advances to the next provider on a 429 and records both attempts', async () => {
    const r = await runWithFailover(chain, async (s) => {
      if (s.provider === 'gemini') throw err(429, 'RESOURCE_EXHAUSTED');
      return 'ok:anthropic';
    });
    expect(r.result).toBe('ok:anthropic');
    expect(r.used.provider).toBe('anthropic');
    expect(r.attempts).toHaveLength(2);
    expect(r.attempts[0]).toMatchObject({ provider: 'gemini', ok: false, status: 429 });
    expect(r.attempts[1]).toMatchObject({ provider: 'anthropic', ok: true });
  });

  it('fails fast on a 400 without trying the next provider', async () => {
    const seen: string[] = [];
    await expect(
      runWithFailover(chain, async (s) => {
        seen.push(s.provider);
        throw err(400, 'bad request');
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(seen).toEqual(['gemini']); // never reached anthropic
  });

  it('throws AllProvidersFailedError with every attempt when the whole chain fails', async () => {
    let thrown: unknown;
    try {
      await runWithFailover(chain, async () => {
        throw err(503, 'unavailable');
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AllProvidersFailedError);
    const attempts = (thrown as AllProvidersFailedError).attempts;
    expect(attempts).toHaveLength(2);
    expect(attempts.every((a) => !a.ok && a.status === 503)).toBe(true);
  });

  it('an empty chain fails immediately', async () => {
    await expect(runWithFailover([], async () => 'x')).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  it('honours a custom shouldFailover predicate', async () => {
    const seen: string[] = [];
    await expect(
      runWithFailover(
        chain,
        async (s) => {
          seen.push(s.provider);
          throw err(500);
        },
        { shouldFailover: () => false }, // never advance
      ),
    ).rejects.toMatchObject({ status: 500 });
    expect(seen).toEqual(['gemini']);
  });
});

describe('resolveChain — env-driven ordering', () => {
  it('gemini-first by default, anthropic fallback, then a lite gemini', () => {
    const chain = resolveChain({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' } as NodeJS.ProcessEnv);
    expect(chain.map((c) => c.provider)).toEqual(['gemini', 'anthropic', 'gemini']);
    expect(chain[0]!.model).toBe('gemini-2.5-flash');
    expect(chain[2]!.model).toBe('gemini-2.5-flash-lite');
  });

  it('HUSH_LLM_PROVIDER=anthropic leads with anthropic', () => {
    const chain = resolveChain({
      HUSH_LLM_PROVIDER: 'anthropic',
      GEMINI_API_KEY: 'g',
      ANTHROPIC_API_KEY: 'a',
    } as NodeJS.ProcessEnv);
    expect(chain[0]!.provider).toBe('anthropic');
    expect(chain.map((c) => c.provider)).toEqual(['anthropic', 'gemini']);
  });

  it('a BYO-key workspace with only one provider gets a single-link chain', () => {
    const chain = resolveChain({ GEMINI_API_KEY: 'g' } as NodeJS.ProcessEnv);
    expect(chain.map((c) => c.provider)).toEqual(['gemini', 'gemini']);
  });

  it('no keys at all → empty chain (caller decides how to surface)', () => {
    expect(resolveChain({} as NodeJS.ProcessEnv)).toEqual([]);
  });

  it('honours model overrides', () => {
    const chain = resolveChain({
      GEMINI_API_KEY: 'g',
      ANTHROPIC_API_KEY: 'a',
      GEMINI_MODEL: 'gemini-3-pro',
      ANTHROPIC_MODEL: 'claude-next',
    } as NodeJS.ProcessEnv);
    expect(chain[0]!.model).toBe('gemini-3-pro');
    expect(chain[1]!.model).toBe('claude-next');
  });
});

describe('TokenBucket — deterministic rate limit with injected clock', () => {
  it('allows up to capacity, then blocks', () => {
    let t = 0;
    const b = new TokenBucket(3, 1, () => t);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false); // exhausted
    expect(b.available()).toBe(0);
  });

  it('refills over time at refillPerSec, capped at capacity', () => {
    let t = 0;
    const b = new TokenBucket(2, 1, () => t); // 1 token/sec
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
    t = 1000; // one second later → 1 token back
    expect(b.available()).toBe(1);
    expect(b.tryTake()).toBe(true);
    t = 10_000; // long wait → capped at capacity, not 10
    expect(b.available()).toBe(2);
  });

  it('starts empty when startFull=false', () => {
    let t = 0;
    const b = new TokenBucket(5, 1, () => t, false);
    expect(b.available()).toBe(0);
    expect(b.tryTake()).toBe(false);
    t = 3000;
    expect(b.available()).toBe(3);
  });

  it('can take multiple tokens at once', () => {
    let t = 0;
    const b = new TokenBucket(5, 1, () => t);
    expect(b.tryTake(4)).toBe(true);
    expect(b.tryTake(2)).toBe(false); // only 1 left
    expect(b.tryTake(1)).toBe(true);
  });
});
