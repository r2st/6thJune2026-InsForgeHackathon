// functions/triage.test.ts
// Acceptance tests for signal triage — gate, fingerprint, budget (ticket 0087).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import {
  fingerprint,
  gateCandidate,
  NoiseBudget,
  triageEvent,
  type BackendEvidence,
  type CandidateEvent,
} from './triage.js';

const evidence = (over: Partial<BackendEvidence> = {}): BackendEvidence => ({
  status: 200, rowsBefore: 5, rowsAfter: 0,
  failingPolicy: 'orders.orders_select', authClaimShape: 'tenant',
  releaseSha: 'abc123', queryShape: 'select * from orders where tenant_id = $1', ...over,
});

const cand = (over: Partial<CandidateEvent> = {}): CandidateEvent => ({
  workspaceId: 'ws1', siteId: 'site1', sessionId: 's1', kind: 'rage_click',
  route: '/orders', at: '2026-06-07T12:00:00Z', evidence: evidence(), ...over,
});

describe('gateCandidate — backend evidence must agree with the signal', () => {
  it('a rage-click with no backend evidence is smoke — ignored', () => {
    const g = gateCandidate(cand({ evidence: null }));
    expect(g.pass).toBe(false);
    expect(g.reason).toMatch(/smoke/);
  });

  it('a 200 OK that silently dropped rows passes and has policy evidence', () => {
    const g = gateCandidate(cand({ evidence: evidence({ status: 200, rowsBefore: 5, rowsAfter: 0 }) }));
    expect(g.pass).toBe(true);
    expect(g.hasPolicyEvidence).toBe(true);
    expect(g.reason).toMatch(/5→0/);
  });

  it('a silent drop without a named policy passes but cannot auto-fix', () => {
    const g = gateCandidate(cand({ evidence: evidence({ failingPolicy: null }) }));
    expect(g.pass).toBe(true);
    expect(g.hasPolicyEvidence).toBe(false);
  });

  it('a 4xx is backend refusal — passes the gate, no policy evidence', () => {
    const g = gateCandidate(cand({ evidence: evidence({ status: 403, rowsBefore: 0, rowsAfter: 0, failingPolicy: null }) }));
    expect(g.pass).toBe(true);
    expect(g.hasPolicyEvidence).toBe(false);
    expect(g.reason).toMatch(/403/);
  });

  it('a 200 OK that actually returned rows is NOT a silent failure — ignored', () => {
    const g = gateCandidate(cand({ evidence: evidence({ status: 200, rowsBefore: 5, rowsAfter: 5, failingPolicy: null }) }));
    expect(g.pass).toBe(false);
  });

  it('a 200 OK with zero rows pre- and post-RLS is a possible missing-data case', () => {
    const g = gateCandidate(cand({ evidence: evidence({ rowsBefore: 0, rowsAfter: 0, failingPolicy: null }) }));
    expect(g.pass).toBe(true);
    expect(g.hasPolicyEvidence).toBe(false);
  });
});

describe('fingerprint — same bug ⇒ same key, cosmetic differences normalize out', () => {
  it('route trailing slash / query, policy case, query whitespace all normalize', () => {
    const a = fingerprint(cand());
    const b = fingerprint(cand({
      route: '/orders/?page=3',
      evidence: evidence({ failingPolicy: 'Orders.Orders_Select', queryShape: '  SELECT *  FROM orders WHERE tenant_id = $1 ' }),
    }));
    expect(a).toBe(b);
  });

  it('two near-identical row drops (5→0 and 7→0) share a fingerprint via the delta bucket', () => {
    const a = fingerprint(cand({ evidence: evidence({ rowsBefore: 5, rowsAfter: 0 }) }));
    const b = fingerprint(cand({ evidence: evidence({ rowsBefore: 7, rowsAfter: 0 }) }));
    expect(a).toBe(b);
  });

  it('a different policy ⇒ a different fingerprint', () => {
    expect(fingerprint(cand())).not.toBe(
      fingerprint(cand({ evidence: evidence({ failingPolicy: 'invoices.inv_select' }) })),
    );
  });

  it('a different release SHA ⇒ a different fingerprint (a fix/regression is its own bug)', () => {
    expect(fingerprint(cand())).not.toBe(
      fingerprint(cand({ evidence: evidence({ releaseSha: 'def456' }) })),
    );
  });
});

describe('NoiseBudget — per-workspace daily caps', () => {
  it('allows up to the limit, then blocks', () => {
    const b = new NoiseBudget({ maxDiagnosesPerDay: 2, maxForkReplaysPerDay: 5, maxOutputsPerDay: 5 });
    expect(b.canDiagnose()).toBe(true);
    b.spendDiagnose();
    b.spendDiagnose();
    expect(b.canDiagnose()).toBe(false);
    expect(b.remaining().diagnoses).toBe(0);
  });

  it('tracks fork replays and outputs independently', () => {
    const b = new NoiseBudget({ maxDiagnosesPerDay: 10, maxForkReplaysPerDay: 1, maxOutputsPerDay: 1 });
    b.spendForkReplay();
    expect(b.canForkReplay()).toBe(false);
    expect(b.canOutput()).toBe(true);
    b.spendOutput();
    expect(b.canOutput()).toBe(false);
    expect(b.snapshot()).toEqual({ diagnoses: 0, forkReplays: 1, outputs: 1 });
  });
});

describe('triageEvent — the single disposition', () => {
  it('no evidence → ignored, no spend', () => {
    const r = triageEvent(cand({ evidence: null }), new Set(), new NoiseBudget());
    expect(r.disposition).toBe('ignored');
    expect(r.spendsDiagnose).toBe(false);
  });

  it('a fresh strong candidate → diagnosed, spends a diagnose', () => {
    const r = triageEvent(cand(), new Set(), new NoiseBudget());
    expect(r.disposition).toBe('diagnosed');
    expect(r.spendsDiagnose).toBe(true);
  });

  it('a recurring bug (fingerprint already open) → clustered, no new diagnose', () => {
    const fp = fingerprint(cand());
    const r = triageEvent(cand(), new Set([fp]), new NoiseBudget());
    expect(r.disposition).toBe('clustered');
    expect(r.spendsDiagnose).toBe(false);
  });

  it('over budget → deferred to dashboard-only evidence, never dropped', () => {
    const budget = new NoiseBudget({ maxDiagnosesPerDay: 0, maxForkReplaysPerDay: 0, maxOutputsPerDay: 0 });
    const r = triageEvent(cand(), new Set(), budget);
    expect(r.disposition).toBe('budget_deferred');
    expect(r.spendsDiagnose).toBe(false);
    expect(r.reason).toMatch(/dashboard-only/);
  });

  it('clustering takes precedence over the budget (no spend either way)', () => {
    const fp = fingerprint(cand());
    const budget = new NoiseBudget({ maxDiagnosesPerDay: 0, maxForkReplaysPerDay: 0, maxOutputsPerDay: 0 });
    expect(triageEvent(cand(), new Set([fp]), budget).disposition).toBe('clustered');
  });
});
