// functions/reliability.test.ts
// Acceptance tests for reliability & idempotency (ticket 0064).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import {
  backoffMs,
  canTransition,
  classifyFailure,
  degradeFor,
  idempotencyKey,
  isTerminal,
  nextState,
  prIdempotencyKey,
  retryDecision,
  StageLedger,
  sweepStuck,
  type RunRecord,
} from './reliability.js';

const err = (status?: number): Error => {
  const e = new Error('boom') as Error & { status?: number };
  if (status !== undefined) e.status = status;
  return e;
};

describe('run state machine', () => {
  it('advances forward by one on the happy path', () => {
    expect(nextState('captured')).toBe('correlated');
    expect(nextState('testing')).toBe('shipped');
    expect(nextState('shipped')).toBeNull();
  });

  it('terminal states are forever', () => {
    expect(isTerminal('shipped')).toBe(true);
    expect(isTerminal('dead_letter')).toBe(true);
    expect(isTerminal('captured')).toBe(false);
    expect(canTransition('shipped', 'failed')).toBe(false);
  });

  it('any live run can fail out, but only forward-by-one otherwise', () => {
    expect(canTransition('captured', 'failed')).toBe(true);
    expect(canTransition('captured', 'dead_letter')).toBe(true);
    expect(canTransition('captured', 'correlated')).toBe(true);
    expect(canTransition('captured', 'diagnosed')).toBe(false); // skipping a stage
  });
});

describe('classifyFailure', () => {
  it('429/503/timeout are transient', () => {
    expect(classifyFailure(err(429))).toBe('transient');
    expect(classifyFailure(err(503))).toBe('transient');
    expect(classifyFailure(err(undefined))).toBe('transient');
  });
  it('400/422/401/403 are terminal', () => {
    expect(classifyFailure(err(400))).toBe('terminal');
    expect(classifyFailure(err(422))).toBe('terminal');
    expect(classifyFailure(err(401))).toBe('terminal');
    expect(classifyFailure(err(403))).toBe('terminal');
  });
});

describe('backoffMs — deterministic exponential', () => {
  it('grows by the factor and caps', () => {
    expect(backoffMs(0, { baseMs: 1000, factor: 2, capMs: 60_000 })).toBe(1000);
    expect(backoffMs(1, { baseMs: 1000, factor: 2, capMs: 60_000 })).toBe(2000);
    expect(backoffMs(3, { baseMs: 1000, factor: 2, capMs: 60_000 })).toBe(8000);
    expect(backoffMs(20, { baseMs: 1000, factor: 2, capMs: 60_000 })).toBe(60_000); // capped
  });
});

describe('retryDecision — retry → dead-letter, terminal → fail', () => {
  it('a terminal failure fails the run immediately', () => {
    const d = retryDecision(err(400), 0, 3);
    expect(d.action).toBe('fail');
  });
  it('a transient failure with attempts left retries with backoff', () => {
    const d = retryDecision(err(503), 0, 3, { baseMs: 1000, factor: 2 });
    expect(d.action).toBe('retry');
    expect(d.delayMs).toBe(1000);
  });
  it('a transient failure with attempts exhausted is dead-lettered, never lost', () => {
    const d = retryDecision(err(503), 2, 3);
    expect(d.action).toBe('dead_letter');
    expect(d.reason).toMatch(/dead-lettered/);
  });
});

describe('StageLedger — idempotent stages', () => {
  it('guard runs the first time and skips on replay', () => {
    const ledger = new StageLedger();
    expect(ledger.guard('run1', 'testing')).toBe('run');
    ledger.markDone('run1', 'testing');
    expect(ledger.guard('run1', 'testing')).toBe('skip'); // never double-open the PR
  });

  it('different runs and stages are independent', () => {
    const ledger = new StageLedger(['run1::testing']);
    expect(ledger.guard('run1', 'testing')).toBe('skip');
    expect(ledger.guard('run1', 'diagnosed')).toBe('run');
    expect(ledger.guard('run2', 'testing')).toBe('run');
  });

  it('keys are stable and distinct', () => {
    expect(idempotencyKey('r', 'testing')).toBe('r::testing');
    expect(prIdempotencyKey('r')).toBe('pr::r');
  });
});

describe('sweepStuck — advance or fail stalled runs', () => {
  const now = 1_000_000_000;
  const rec = (over: Partial<RunRecord>): RunRecord => ({ runId: 'r', state: 'captured', enteredStateAt: now, attempts: 0, ...over });

  it('a run within its deadline is left alone', () => {
    const out = sweepStuck([rec({ enteredStateAt: now - 60_000 })], now); // 1 min < 5 min
    expect(out).toEqual([]);
  });

  it('a run stuck past its deadline with retries left is re-kicked', () => {
    const out = sweepStuck([rec({ enteredStateAt: now - 10 * 60_000 })], now); // 10 min > 5 min
    expect(out).toHaveLength(1);
    expect(out[0]!.action).toBe('retry');
  });

  it('a stuck run with attempts exhausted is dead-lettered', () => {
    const out = sweepStuck([rec({ enteredStateAt: now - 10 * 60_000, attempts: 2 })], now, 3);
    expect(out[0]!.action).toBe('dead_letter');
  });

  it('terminal runs are never swept', () => {
    expect(sweepStuck([rec({ state: 'shipped', enteredStateAt: now - 999 * 60_000 })], now)).toEqual([]);
    expect(sweepStuck([rec({ state: 'dead_letter', enteredStateAt: 0 })], now)).toEqual([]);
  });
});

describe('degradeFor — every dependency has a defined, visible fallback', () => {
  it('LLM exhaustion is fatal → dead-letter, never hang', () => {
    const d = degradeFor('llm');
    expect(d.fatal).toBe(true);
    expect(d.degradedState).toBe('dead_letter');
  });

  it('no fork → non-fatal trace-only replay (capped at draft)', () => {
    const d = degradeFor('fork');
    expect(d.fatal).toBe(false);
    expect(d.fallback).toMatch(/trace-only/);
  });

  it('realtime and memoir failures are non-fatal — the run proceeds', () => {
    expect(degradeFor('realtime').fatal).toBe(false);
    expect(degradeFor('memoir').fatal).toBe(false);
  });

  it('github down queues the PR rather than losing the fix', () => {
    expect(degradeFor('github').fallback).toMatch(/queue/);
  });
});
