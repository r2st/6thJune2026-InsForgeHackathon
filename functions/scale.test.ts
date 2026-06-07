// functions/scale.test.ts
// Acceptance tests for scale & performance guardrails (ticket 0065).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import {
  admitFork,
  backpressure,
  CostMeter,
  dedupDecision,
  type ConcurrencyState,
} from './scale.js';

describe('CostMeter — degrade to queue, never a surprise bill', () => {
  it('proceeds within budget', () => {
    const m = new CostMeter({ llmTokensPerDay: 1000, forkMinutesPerDay: 10 });
    expect(m.decide('llm_tokens', 400).action).toBe('proceed');
  });

  it('queues (not bills) once the daily budget is exhausted', () => {
    const m = new CostMeter({ llmTokensPerDay: 1000, forkMinutesPerDay: 10 });
    m.spend('llm_tokens', 900);
    const d = m.decide('llm_tokens', 200); // 1100 > 1000
    expect(d.action).toBe('queue');
    expect(d.reason).toMatch(/not billed past cap/);
  });

  it('rejects a single spend larger than the entire daily cap', () => {
    const m = new CostMeter({ llmTokensPerDay: 1000, forkMinutesPerDay: 10 });
    expect(m.decide('llm_tokens', 5000).action).toBe('reject');
  });

  it('tracks token and fork-minute budgets independently', () => {
    const m = new CostMeter({ llmTokensPerDay: 1000, forkMinutesPerDay: 10 });
    m.spend('fork_minutes', 10);
    expect(m.decide('fork_minutes', 1).action).toBe('queue');
    expect(m.decide('llm_tokens', 500).action).toBe('proceed');
    expect(m.remaining()).toEqual({ llmTokens: 1000, forkMinutes: 0 });
  });
});

describe('admitFork — per-workspace AND global caps', () => {
  const state = (over: Partial<ConcurrencyState>): ConcurrencyState => ({
    workspaceActive: 0, workspaceCap: 3, globalActive: 0, globalCap: 20, ...over,
  });

  it('admits when both caps have room', () => {
    expect(admitFork(state({})).admit).toBe(true);
  });

  it('queues when the workspace is at its cap (no starving others)', () => {
    const r = admitFork(state({ workspaceActive: 3 }));
    expect(r.admit).toBe(false);
    expect(r.reason).toMatch(/workspace at its fork cap/);
  });

  it('queues when the global pool is full even if the workspace has room', () => {
    const r = admitFork(state({ workspaceActive: 1, globalActive: 20 }));
    expect(r.admit).toBe(false);
    expect(r.reason).toMatch(/global fork pool full/);
  });
});

describe('backpressure — accept → queue → shed, visibly', () => {
  it('accepts below the soft limit', () => {
    const r = backpressure(10, 50, 100);
    expect(r.state).toBe('accept');
    expect(r.saturation).toBeCloseTo(0.1);
  });

  it('queues async between soft and hard limits', () => {
    expect(backpressure(70, 50, 100).state).toBe('queue');
  });

  it('sheds at the hard limit with full saturation', () => {
    const r = backpressure(100, 50, 100);
    expect(r.state).toBe('shed');
    expect(r.saturation).toBe(1);
  });
});

describe('dedupDecision — re-seen bug shape short-circuits the spend', () => {
  const now = 1_000_000;
  const seen = new Map([['fp-a', now - 5_000]]); // seen 5s ago

  it('short-circuits a fingerprint seen within the recall window', () => {
    const d = dedupDecision('fp-a', seen, now, 60_000);
    expect(d.decision).toBe('short_circuit');
  });

  it('processes a novel fingerprint', () => {
    expect(dedupDecision('fp-new', seen, now, 60_000).decision).toBe('process');
  });

  it('processes again once the recall window has lapsed', () => {
    expect(dedupDecision('fp-a', seen, now, 1_000).decision).toBe('process'); // 5s > 1s window
  });
});
