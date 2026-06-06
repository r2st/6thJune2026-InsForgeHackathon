import { describe, it, expect } from 'vitest';
import { fixTrigger, type OrchestratorDeps, type RunContext } from './fix-trigger.js';
import type { Diagnosis, ReceiptEvent, RequestLogEntry, Verdict } from './types.js';

const ACME = '11111111-1111-1111-1111-111111111111';

const FAILING: RequestLogEntry = {
  id: 4821, ts: '2026-06-06T18:00:37.500Z', sessionId: 'sess_1',
  userId: 'user_a', tenantId: ACME, route: '/orders', method: 'GET',
  rlsDecisions: [{ policy: 'orders.orders_select', table: 'orders', rowsBefore: 3, rowsAfter: 0 }],
  returnedRows: 0, status: 200,
};

const DIAGNOSIS: Diagnosis = {
  summary: 'orders policy reads tenant but JWT migrated to tenant_ids',
  expectation: '3 orders', observation: '0 orders',
  failingPolicy: 'orders.orders_select', failingJwtClaim: "auth.jwt() -> 'tenant'",
  tomlDiff: {
    path: 'tables.orders.rls',
    before: "tenant_id = (auth.jwt() ->> 'tenant')::uuid",
    after: "tenant_id = (auth.jwt() ->> 'tenant')::uuid OR tenant_id = ANY((auth.jwt() -> 'tenant_ids')::uuid[])",
  },
  widensAccess: false,
  confidenceInputs: { diffLoc: 1, tablesTouched: 1, policyBlast: 1 },
  promptVersion: 'diagnose-v1.0.0',
};

const GOOD_VERDICT: Verdict = {
  prod: { status: 200, rowsReturned: 0, latencyMs: 5, snippet: '[]' },
  fork: { status: 200, rowsReturned: 3, latencyMs: 6, snippet: '[...]' },
  bugConfirmed: true, fixVerified: true, rationale: 'reproduced + fixed',
};

function ctx(): RunContext {
  return {
    run: {
      id: 'run_1', tenantId: ACME, capturedAt: '2026-06-06T18:00:42Z',
      sessionClipUrl: null, diagnosis: null, tomlDiff: null, confidence: null,
      tier: null, status: 'captured', prUrl: null, promptVersion: null,
    },
    requestLogWindow: [FAILING],
    prodJwt: 'prod.jwt.sig',
    jwtClaims: { sub: 'user_a', tenant_ids: [ACME] },
  };
}

function harness(over: Partial<OrchestratorDeps> = {}) {
  const events: ReceiptEvent[] = [];
  const updates: Record<string, unknown>[] = [];
  const deps: Partial<OrchestratorDeps> = {
    loadContext: async () => ctx(),
    publish: async (e) => { events.push(e); },
    updateRun: async (_id, p) => { updates.push(p); },
    tableColumns: () => ['id', 'tenant_id', 'user_id', 'total'],
    diagnose: async () => DIAGNOSIS,
    acquireFork: () => ({ branchId: 'hush-fork-0', baseUrl: 'https://f0.test', jwtSecret: 's', claimedBy: 'run_1' }),
    applyDiff: async () => ({ ok: true, version: 'v42', changed: true }),
    replayFork: async () => GOOD_VERDICT,
    traceReplay: () => ({ ...GOOD_VERDICT, mode: 'trace' }),
    ship: async ({ tier }) => ({ prUrl: tier === 'pr' ? 'https://gh/pr/1' : null }),
    now: () => '2026-06-06T18:00:43Z',
    ...over,
  };
  return { events, updates, deps };
}

describe('fixTrigger orchestrator', () => {
  it('drives correlate→diagnose→fork-replay→ship on the happy path', async () => {
    const { events, updates, deps } = harness();
    const r = await fixTrigger('run_1', deps);
    expect(r.status).toBe('shipped');
    expect(r.tier).toBe('pr');
    expect(r.prUrl).toBe('https://gh/pr/1');
    expect(events.map((e) => e.step)).toEqual(['correlated', 'diagnosed', 'testing', 'shipped']);
    expect(updates.at(-1)).toMatchObject({ status: 'shipped', tier: 'pr' });
  });

  it('hard-stops to an issue when the safety rail flags an unintended widen', async () => {
    const widening: Diagnosis = {
      ...DIAGNOSIS,
      widensAccess: false,
      tomlDiff: { ...DIAGNOSIS.tomlDiff, after: 'true' }, // drops the tenant scoping entirely
    };
    const { events, deps } = harness({ diagnose: async () => widening });
    const r = await fixTrigger('run_1', deps);
    expect(r.tier).toBe('issue');
    // never reached the fork
    expect(events.map((e) => e.step)).not.toContain('testing');
  });

  it('falls back to trace-only and caps the tier at draft_pr when no fork is free', async () => {
    const { events, deps } = harness({ acquireFork: () => null });
    const r = await fixTrigger('run_1', deps);
    expect(r.status).toBe('shipped');
    expect(r.tier).toBe('draft_pr'); // trace can never reach pr
    const shipped = events.find((e) => e.step === 'shipped');
    expect(shipped?.detail).toMatchObject({ mode: 'trace' });
  });

  it('routes a model self-escalation (widensAccess) to issue without acquiring a fork', async () => {
    let forkAsked = false;
    const escalated: Diagnosis = { ...DIAGNOSIS, widensAccess: true, tomlDiff: { ...DIAGNOSIS.tomlDiff, after: '' } };
    const { events, deps } = harness({
      diagnose: async () => escalated,
      acquireFork: () => { forkAsked = true; return null; },
    });
    const r = await fixTrigger('run_1', deps);
    expect(r.tier).toBe('issue');
    expect(forkAsked).toBe(false); // never spent a fork
    expect(events.map((e) => e.step)).not.toContain('testing');
    expect(events.find((e) => e.step === 'shipped')?.detail).toMatchObject({ reason: 'issue-from-escalation' });
  });

  it('routes a no-op diff (after === before) to issue as escalation', async () => {
    const noop: Diagnosis = { ...DIAGNOSIS, tomlDiff: { ...DIAGNOSIS.tomlDiff, after: DIAGNOSIS.tomlDiff.before } };
    const { events, deps } = harness({ diagnose: async () => noop });
    const r = await fixTrigger('run_1', deps);
    expect(r.tier).toBe('issue');
    expect(events.find((e) => e.step === 'shipped')?.detail).toMatchObject({ reason: 'issue-from-escalation' });
  });

  it('drops to an issue when the patch fails to apply on the branch', async () => {
    const { deps } = harness({ applyDiff: async () => ({ ok: false, lintError: 'insforge.toml:2 bad' }) });
    const r = await fixTrigger('run_1', deps);
    expect(r.tier).toBe('issue');
  });

  it('drops to issue when the post-apply fingerprint mismatches (silent no-op, 0034)', async () => {
    const { events, deps } = harness({
      applyDiff: async () => ({ ok: true, version: 'v42', changed: true, schemaFingerprint: 'wrong-fingerprint' }),
    });
    const r = await fixTrigger('run_1', deps);
    expect(r.tier).toBe('issue');
    expect(events.find((e) => e.step === 'shipped')?.detail).toMatchObject({ reason: 'issue-from-apply-noop' });
  });

  it('fails cleanly when correlate finds no anomaly', async () => {
    const { events, deps } = harness({
      loadContext: async () => ({ ...ctx(), requestLogWindow: [{ ...FAILING, returnedRows: 3 }] }),
    });
    const r = await fixTrigger('run_1', deps);
    expect(r.status).toBe('failed');
    expect(events.at(-1)?.step).toBe('failed');
  });

  it('degrades visibly on a DiagnoseError (timeout/overload) with the reason', async () => {
    const { DiagnoseError } = await import('./diagnose.js');
    const { events, deps } = harness({
      diagnose: async () => { throw new DiagnoseError('timeout', 'diagnose: timed out after 12000ms'); },
    });
    const r = await fixTrigger('run_1', deps);
    expect(r.status).toBe('failed');
    expect(events.at(-1)).toMatchObject({ step: 'failed', detail: { stage: 'diagnose' } });
    expect(String(events.at(-1)?.detail?.reason)).toMatch(/timeout/);
  });

  it('publishes failed and stops when a stage throws', async () => {
    const { events, deps } = harness({ diagnose: async () => { throw new Error('AI timeout'); } });
    const r = await fixTrigger('run_1', deps);
    expect(r.status).toBe('failed');
    expect(events.at(-1)).toMatchObject({ step: 'failed', detail: { error: 'AI timeout' } });
  });
});
