// functions/scale.ts
// Scale & performance guardrails — cost caps, fork concurrency, ingest backpressure.
//
// Ticket:  agents/tasks/0065-scale-performance.md
// Defends: the demo runs one bug at a time. A product faces bursty capture traffic
//          and parallel runs, each spending on an LLM call and a branch project.
//          Without limits, cost and latency blow up silently — a surprise bill and
//          a backed-up queue. These guardrails degrade gracefully instead.
//
// Pure, testable core: a per-workspace COST meter (LLM tokens + fork-minutes/day)
// that degrades to queue/notify instead of a surprise bill; a CONCURRENCY gate that
// caps forks per-workspace and globally; a BACKPRESSURE decision so a traffic spike
// queues or sheds visibly instead of dropping sessions; and a DEDUP short-circuit so
// a re-seen bug shape doesn't pay for a fresh diagnose+fork. The load-test harness,
// the real queue, and metering tables are the integration seam.

// ── per-workspace cost guardrails ──────────────────────────────────────────────────

export interface CostLimits {
  llmTokensPerDay: number;
  forkMinutesPerDay: number;
}

export interface CostUsage {
  llmTokens: number;
  forkMinutes: number;
}

export const DEFAULT_COST_LIMITS: CostLimits = {
  llmTokensPerDay: 2_000_000,
  forkMinutesPerDay: 600, // 10 fork-hours/day
};

export type SpendKind = 'llm_tokens' | 'fork_minutes';
export type SpendAction = 'proceed' | 'queue' | 'reject';

export interface SpendDecision {
  action: SpendAction;
  reason: string;
}

/**
 * Per-workspace cost meter. Over budget DEGRADES (queue the work + notify) rather
 * than dropping it or billing past the cap — never a surprise bill. A single spend
 * larger than the entire daily budget is rejected outright (it can never fit).
 */
export class CostMeter {
  constructor(
    private readonly limits: CostLimits = DEFAULT_COST_LIMITS,
    private usage: CostUsage = { llmTokens: 0, forkMinutes: 0 },
  ) {}

  private capFor(kind: SpendKind): number {
    return kind === 'llm_tokens' ? this.limits.llmTokensPerDay : this.limits.forkMinutesPerDay;
  }
  private usedFor(kind: SpendKind): number {
    return kind === 'llm_tokens' ? this.usage.llmTokens : this.usage.forkMinutes;
  }

  /** Decide whether a spend of `amount` may proceed now. Does not mutate. */
  decide(kind: SpendKind, amount: number): SpendDecision {
    const cap = this.capFor(kind);
    if (amount > cap) return { action: 'reject', reason: `single ${kind} spend ${amount} exceeds the entire daily cap ${cap}` };
    if (this.usedFor(kind) + amount <= cap) return { action: 'proceed', reason: `within ${kind} budget` };
    return { action: 'queue', reason: `${kind} budget exhausted today — queued + workspace notified, not billed past cap` };
  }

  /** Record a spend that proceeded. */
  spend(kind: SpendKind, amount: number): void {
    if (kind === 'llm_tokens') this.usage.llmTokens += amount;
    else this.usage.forkMinutes += amount;
  }

  remaining(): CostUsage {
    return {
      llmTokens: Math.max(0, this.limits.llmTokensPerDay - this.usage.llmTokens),
      forkMinutes: Math.max(0, this.limits.forkMinutesPerDay - this.usage.forkMinutes),
    };
  }
}

// ── fork concurrency ────────────────────────────────────────────────────────────────

export interface ConcurrencyState {
  workspaceActive: number;
  workspaceCap: number;
  globalActive: number;
  globalCap: number;
}

export interface AdmitResult {
  admit: boolean;
  /** When not admitted, the caller should queue (not drop) and retry as slots free. */
  reason: string;
}

/**
 * Admit a new fork only if BOTH the per-workspace and the global concurrency caps
 * have a free slot — so one busy workspace can't starve others, and the global pool
 * (branch projects are finite) is never oversubscribed. Not-admitted ⇒ queue.
 */
export function admitFork(state: ConcurrencyState): AdmitResult {
  if (state.workspaceActive >= state.workspaceCap) {
    return { admit: false, reason: `workspace at its fork cap (${state.workspaceActive}/${state.workspaceCap}) — queue` };
  }
  if (state.globalActive >= state.globalCap) {
    return { admit: false, reason: `global fork pool full (${state.globalActive}/${state.globalCap}) — queue` };
  }
  return { admit: true, reason: 'fork slot available (workspace + global)' };
}

// ── ingest backpressure ─────────────────────────────────────────────────────────────

export type Backpressure = 'accept' | 'queue' | 'shed';

export interface BackpressureResult {
  state: Backpressure;
  /** 0..1 — how full the queue is, for a visible gauge. */
  saturation: number;
  reason: string;
}

/**
 * Decide how to handle an incoming capture given the queue depth. Below the soft
 * limit we accept inline; between soft and hard we still queue (async, never block
 * the response); at/over the hard limit we SHED with a clear signal — backpressure
 * is visible, and capture is async so a spike never blocks the host page's response.
 * Shedding the lowest-value work beats silently dropping or timing out.
 */
export function backpressure(queueDepth: number, softLimit: number, hardLimit: number): BackpressureResult {
  const saturation = hardLimit > 0 ? Math.min(1, queueDepth / hardLimit) : 1;
  if (queueDepth < softLimit) return { state: 'accept', saturation, reason: 'queue below soft limit — accept' };
  if (queueDepth < hardLimit) return { state: 'queue', saturation, reason: 'queue between soft and hard limit — accept async, backpressure rising' };
  return { state: 'shed', saturation, reason: 'queue at hard limit — shedding new low-value captures; backpressure visible' };
}

// ── dedup short-circuit (cost control) ──────────────────────────────────────────────

export type DedupDecision = 'process' | 'short_circuit';

/**
 * A re-seen bug shape shouldn't pay for a fresh diagnose+fork. If this fingerprint
 * was seen within the recall window, short-circuit to the cached run/outcome (the
 * pgvector dedup + Memoir recall path) instead of spending. `seen` maps fingerprint
 * → last-seen ms epoch.
 */
export function dedupDecision(
  fingerprint: string,
  seen: ReadonlyMap<string, number>,
  nowMs: number,
  windowMs: number,
): { decision: DedupDecision; reason: string } {
  const last = seen.get(fingerprint);
  if (last !== undefined && nowMs - last <= windowMs) {
    return { decision: 'short_circuit', reason: `bug shape seen ${Math.round((nowMs - last) / 1000)}s ago — short-circuit to the cached run, no fresh diagnose+fork` };
  }
  return { decision: 'process', reason: 'novel (or stale) bug shape — process a fresh run' };
}
