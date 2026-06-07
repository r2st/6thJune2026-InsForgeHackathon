// functions/llmChain.ts
// LLM reliability — provider/model failover chain + rate-limit token bucket.
//
// Ticket:  agents/tasks/0055-llm-reliability-byok.md
// Built on: llm.ts (the provider abstraction). The hackathon hit this exact
//           wall — Gemini free-tier 429 RESOURCE_EXHAUSTED and transient 503s.
//
// Pure, testable core: try an ordered chain of (provider, model) specs; on a
// transient/availability failure advance to the next; on a genuine bad-request
// fail fast (advancing wastes quota and won't help). A per-provider token bucket
// keeps one noisy workspace from exhausting the shared pool. The diagnose call
// is injected, so this is hermetic; wiring it around llm.ts's client is the seam.

export interface ProviderSpec {
  provider: 'gemini' | 'anthropic';
  model: string;
}

export interface ProviderAttempt {
  provider: string;
  model: string;
  ok: boolean;
  status?: number;
  error?: string;
}

export interface FailoverResult<T> {
  result: T;
  used: ProviderSpec;
  attempts: ProviderAttempt[];
}

export class AllProvidersFailedError extends Error {
  constructor(public readonly attempts: ProviderAttempt[]) {
    super(`llm: all ${attempts.length} provider(s) in the chain failed`);
    this.name = 'AllProvidersFailedError';
  }
}

/**
 * Should we fail over to the next provider for this error? Yes for reliability
 * failures (429 rate-limit, 5xx, timeout/network, 402/403 billing-or-access);
 * no for a genuine malformed request (400/422) — the next provider would reject
 * it too, and trying wastes quota. Status comes off `err.status` (same shape
 * llm.ts and diagnose's isTransient use).
 */
export function defaultShouldFailover(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === undefined) return true;            // network / timeout
  if (status === 400 || status === 422) return false; // malformed request — fail fast
  if (status === 401) return true;                  // bad key for THIS provider — try the next
  return status === 402 || status === 403 || status === 429 || status >= 500;
}

/**
 * Run `callOne` over the chain until one succeeds. Records every attempt so the
 * receipt/observability can show which provider answered.
 */
export async function runWithFailover<T>(
  chain: ProviderSpec[],
  callOne: (spec: ProviderSpec) => Promise<T>,
  opts?: { shouldFailover?: (err: unknown) => boolean },
): Promise<FailoverResult<T>> {
  if (chain.length === 0) throw new AllProvidersFailedError([]);
  const shouldFailover = opts?.shouldFailover ?? defaultShouldFailover;
  const attempts: ProviderAttempt[] = [];

  for (let i = 0; i < chain.length; i++) {
    const spec = chain[i]!;
    try {
      const result = await callOne(spec);
      attempts.push({ provider: spec.provider, model: spec.model, ok: true });
      return { result, used: spec, attempts };
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const message = err instanceof Error ? err.message : String(err);
      attempts.push({ provider: spec.provider, model: spec.model, ok: false, status, error: message });
      const isLast = i === chain.length - 1;
      if (isLast || !shouldFailover(err)) throw isLast ? new AllProvidersFailedError(attempts) : err;
      // else: advance to the next provider
    }
  }
  throw new AllProvidersFailedError(attempts);
}

/**
 * Build the failover chain from env. BYO-key workspaces lead with their own
 * provider; otherwise the platform default chain. Gemini-first (cheap, fast),
 * Anthropic as the cross-family fallback, a lite Gemini model last.
 */
export function resolveChain(env: NodeJS.ProcessEnv = process.env): ProviderSpec[] {
  const geminiModel = env.GEMINI_MODEL ?? 'gemini-2.5-flash';
  const anthropicModel = env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';
  const chain: ProviderSpec[] = [];

  const primary = (env.HUSH_LLM_PROVIDER ?? 'gemini').toLowerCase();
  if (primary === 'anthropic') {
    if (env.ANTHROPIC_API_KEY) chain.push({ provider: 'anthropic', model: anthropicModel });
    if (env.GEMINI_API_KEY) chain.push({ provider: 'gemini', model: geminiModel });
  } else {
    if (env.GEMINI_API_KEY) chain.push({ provider: 'gemini', model: geminiModel });
    if (env.ANTHROPIC_API_KEY) chain.push({ provider: 'anthropic', model: anthropicModel });
    if (env.GEMINI_API_KEY) chain.push({ provider: 'gemini', model: 'gemini-2.5-flash-lite' });
  }
  return chain;
}

/**
 * Token bucket — per-provider (or per-workspace) rate limiting so one noisy
 * caller can't exhaust the shared pool. Deterministic: clock is injected.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly now: () => number = Date.now,
    startFull = true,
  ) {
    this.tokens = startFull ? capacity : 0;
    this.last = this.now();
  }

  /** Try to take one token; true if allowed, false if rate-limited right now. */
  tryTake(n = 1): boolean {
    this.refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }

  available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  private refill(): void {
    const t = this.now();
    const elapsed = Math.max(0, (t - this.last) / 1000);
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.last = t;
  }
}
