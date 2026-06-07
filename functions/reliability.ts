// functions/reliability.ts
// Reliability & idempotency — durable, retryable, degrade-don't-hang orchestration.
//
// Ticket:  agents/tasks/0064-reliability-idempotency.md
// Defends: in the hackathon a realtime crash aborted the whole loop, a stuck run
//          sat in `captured`, and re-invoking risked duplicate side effects. A
//          product runs thousands of these unattended — it needs idempotent stages,
//          retry-with-backoff + dead-letter, a stuck-run sweeper, and a defined
//          fallback for every external dependency so the pipeline never hangs.
//
// Pure, testable core: a run STATE MACHINE with terminal states; a STAGE LEDGER so
// re-running never double-opens a PR / double-claims a fork; a failure classifier +
// retry/backoff/dead-letter decision; a stuck-run SWEEPER that advances or fails
// runs stalled past a deadline; and a DEGRADE map giving every dependency a defined
// fallback. The hackathon proved the patterns (trace fallback, non-fatal realtime,
// neutral Memoir) — this makes them uniform and tested. Wiring into fix-trigger.ts
// and the toml state machine/DLQ/sweeper schedule is the integration seam.

export type RunState =
  | 'captured' | 'correlated' | 'diagnosed' | 'testing' | 'shipped'
  | 'failed' | 'dead_letter';

/** A run that ended — no sweeper or retry ever touches it again. */
export const TERMINAL_STATES: ReadonlySet<RunState> = new Set(['shipped', 'failed', 'dead_letter']);

/** The happy-path order. Each stage advances to the next on success. */
const FORWARD: Record<RunState, RunState | null> = {
  captured: 'correlated',
  correlated: 'diagnosed',
  diagnosed: 'testing',
  testing: 'shipped',
  shipped: null,
  failed: null,
  dead_letter: null,
};

export function isTerminal(state: RunState): boolean { return TERMINAL_STATES.has(state); }

/** The next forward state, or null if `state` is terminal. */
export function nextState(state: RunState): RunState | null { return FORWARD[state]; }

/** Legal transition? Forward-by-one, or any non-terminal → failed/dead_letter. */
export function canTransition(from: RunState, to: RunState): boolean {
  if (isTerminal(from)) return false;             // terminal is forever
  if (to === 'failed' || to === 'dead_letter') return true; // any live run can fail out
  return FORWARD[from] === to;                     // otherwise only forward-by-one
}

// ── failure classification + retry policy ───────────────────────────────────────────

export type FailureClass = 'transient' | 'terminal';

/**
 * Transient = worth retrying (provider 429/503, deploy/infra blip, realtime
 * hiccup, network/timeout). Terminal = a genuine bad request the same input will
 * never recover from (400/422). Mirrors llmChain.defaultShouldFailover's contract.
 */
export function classifyFailure(err: unknown): FailureClass {
  const status = (err as { status?: number })?.status;
  if (status === undefined) return 'transient';      // network / timeout
  if (status === 400 || status === 422) return 'terminal';
  if (status === 401 || status === 403) return 'terminal'; // auth/permission won't self-heal on retry
  return 'transient';                                // 408/409/429/5xx
}

export type RetryAction = 'retry' | 'dead_letter' | 'fail';

export interface RetryDecision {
  action: RetryAction;
  /** Backoff before the retry; 0 for non-retry actions. */
  delayMs: number;
  attempt: number;
  reason: string;
}

export interface BackoffOptions {
  baseMs?: number;
  capMs?: number;
  factor?: number;
}

const DEFAULT_BACKOFF: Required<BackoffOptions> = { baseMs: 1000, capMs: 60_000, factor: 2 };

/**
 * Deterministic exponential backoff (no jitter — randomness is intentionally
 * avoided here so retries are reproducible/testable; the caller may add jitter):
 * delay = min(cap, base * factor^attempt), attempt 0-indexed.
 */
export function backoffMs(attempt: number, opts: BackoffOptions = {}): number {
  const { baseMs, capMs, factor } = { ...DEFAULT_BACKOFF, ...opts };
  return Math.min(capMs, Math.round(baseMs * factor ** Math.max(0, attempt)));
}

/**
 * Decide what to do after a stage fails on `attempt` (0-indexed). A terminal
 * failure fails the run immediately; a transient failure retries with backoff
 * until `maxAttempts`, after which it lands in the dead-letter queue — a human or
 * replay job can recover it, and the bug is never silently lost.
 */
export function retryDecision(err: unknown, attempt: number, maxAttempts: number, backoff: BackoffOptions = {}): RetryDecision {
  const cls = classifyFailure(err);
  if (cls === 'terminal') {
    return { action: 'fail', delayMs: 0, attempt, reason: 'terminal failure — input will not recover on retry' };
  }
  if (attempt + 1 < maxAttempts) {
    return { action: 'retry', delayMs: backoffMs(attempt, backoff), attempt, reason: `transient — retry ${attempt + 1}/${maxAttempts - 1} after backoff` };
  }
  return { action: 'dead_letter', delayMs: 0, attempt, reason: `transient but exhausted ${maxAttempts} attempts — dead-lettered for replay` };
}

// ── idempotent stages ────────────────────────────────────────────────────────────

/** Stable per-(run, stage) key — the unit a stage guards on so it runs at most once. */
export function idempotencyKey(runId: string, stage: RunState): string { return `${runId}::${stage}`; }

/** Stable per-run PR key — re-running a shipped/testing run must not double-open a PR. */
export function prIdempotencyKey(runId: string): string { return `pr::${runId}`; }

/**
 * Tracks which (run, stage) side effects have completed. `guard` is the idempotency
 * contract: it returns `run` the first time and `skip` on every replay — so a stuck
 * `captured`/`testing` row re-entering the pipeline never double-opens a PR,
 * double-claims a fork, or double-records an outcome.
 */
export class StageLedger {
  private done = new Set<string>();
  constructor(seed: Iterable<string> = []) { for (const k of seed) this.done.add(k); }

  isDone(runId: string, stage: RunState): boolean { return this.done.has(idempotencyKey(runId, stage)); }
  markDone(runId: string, stage: RunState): void { this.done.add(idempotencyKey(runId, stage)); }

  /** Idempotency gate: 'run' the first time, 'skip' thereafter. Does NOT auto-mark. */
  guard(runId: string, stage: RunState): 'run' | 'skip' {
    return this.isDone(runId, stage) ? 'skip' : 'run';
  }

  snapshot(): string[] { return [...this.done]; }
}

// ── stuck-run sweeper ──────────────────────────────────────────────────────────────

export interface RunRecord {
  runId: string;
  state: RunState;
  /** When the run ENTERED its current state (ms epoch). */
  enteredStateAt: number;
  /** Transient retry attempts already spent in this state. */
  attempts: number;
}

export type SweepAction = 'retry' | 'dead_letter' | 'none';

export interface SweepResult {
  runId: string;
  action: SweepAction;
  reason: string;
}

/** Per-state deadline (ms). A run sitting in a non-terminal state past this is stuck. */
export type Deadlines = Partial<Record<RunState, number>>;

const DEFAULT_DEADLINES: Required<Pick<Deadlines, 'captured' | 'correlated' | 'diagnosed' | 'testing'>> = {
  captured: 5 * 60_000,
  correlated: 5 * 60_000,
  diagnosed: 10 * 60_000,
  testing: 15 * 60_000,
};

/**
 * Sweep runs stalled in a non-terminal state past their deadline (the
 * `captured`-forever case). A stuck run with retries left is re-kicked; one that's
 * exhausted its attempts is dead-lettered. Terminal runs are never swept.
 */
export function sweepStuck(runs: RunRecord[], nowMs: number, maxAttempts = 3, deadlines: Deadlines = {}): SweepResult[] {
  const dl = { ...DEFAULT_DEADLINES, ...deadlines } as Record<RunState, number>;
  const results: SweepResult[] = [];
  for (const r of runs) {
    if (isTerminal(r.state)) continue;
    const deadline = dl[r.state];
    if (deadline === undefined) continue;
    const stuckFor = nowMs - r.enteredStateAt;
    if (stuckFor <= deadline) continue;

    if (r.attempts + 1 < maxAttempts) {
      results.push({ runId: r.runId, action: 'retry', reason: `stuck in ${r.state} for ${Math.round(stuckFor / 1000)}s — re-kicking (attempt ${r.attempts + 1})` });
    } else {
      results.push({ runId: r.runId, action: 'dead_letter', reason: `stuck in ${r.state} past deadline with attempts exhausted — dead-lettered` });
    }
  }
  return results;
}

// ── degrade, don't hang ──────────────────────────────────────────────────────────

export type Dependency = 'llm' | 'fork' | 'github' | 'realtime' | 'memoir';

export interface Degradation {
  /** What the pipeline does when this dependency is unavailable. */
  fallback: string;
  /** Does the run continue (degraded) or stop here? */
  fatal: boolean;
  /** The run state to surface when this fallback engages. */
  degradedState: 'testing' | 'diagnosed' | 'shipped' | 'failed' | 'dead_letter';
}

/**
 * Every external dependency has a DEFINED fallback and a visible degraded state —
 * the pipeline never blocks on a single dependency. Extends the patterns already
 * proven in the hackathon: trace-only replay, non-fatal realtime, neutral Memoir.
 */
export function degradeFor(dep: Dependency): Degradation {
  switch (dep) {
    case 'llm':
      // After the whole failover chain (llmChain) is exhausted, diagnose can't run.
      return { fallback: 'all providers failed — dead-letter for retry, never hang', fatal: true, degradedState: 'dead_letter' };
    case 'fork':
      // No branch project available → trace-only replay; capped at draft, never PR.
      return { fallback: 'trace-only replay (no fork) — verdict capped at draft_pr', fatal: false, degradedState: 'testing' };
    case 'github':
      // Can't open the PR right now → keep the fix, queue the PR, mark for replay.
      return { fallback: 'queue the PR open for replay — outcome held, not lost', fatal: false, degradedState: 'diagnosed' };
    case 'realtime':
      // Receipt channel down → non-fatal; the run proceeds, UI catches up on poll.
      return { fallback: 'skip realtime publish (non-fatal) — run proceeds', fatal: false, degradedState: 'shipped' };
    case 'memoir':
      // Memory unavailable → neutral prior; confidence unaffected by missing memory.
      return { fallback: 'neutral memory prior — confidence unchanged', fatal: false, degradedState: 'diagnosed' };
  }
}
