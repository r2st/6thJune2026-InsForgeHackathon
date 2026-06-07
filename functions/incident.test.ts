// functions/incident.test.ts
// Acceptance tests for incident aggregation (ticket 0080).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import {
  incidentKey,
  matchIncident,
  classifyArrival,
  severityScore,
  tierFloorFor,
  type Incident,
  type IncidentSignature,
} from './incident.js';

const SIG: IncidentSignature = {
  failingPolicy: 'orders.orders_select',
  route: '/orders',
  diffShape: "tenant_id = X OR tenant_id = ANY(tenant_ids)",
};

const openIncident = (over: Partial<Incident> = {}): Incident => ({
  id: 'inc1', signature: SIG, sessionCount: 1,
  firstSeen: '2026-06-07T00:00:00Z', lastSeen: '2026-06-07T00:00:00Z', status: 'open', ...over,
});

describe('incidentKey — same bug ⇒ same key (despite cosmetic differences)', () => {
  it('normalizes route trailing slash / query, policy case, diff whitespace', () => {
    const a = incidentKey(SIG);
    const b = incidentKey({
      failingPolicy: 'Orders.Orders_Select',
      route: '/orders/?page=2',
      diffShape: "  tenant_id = X   OR tenant_id = ANY(tenant_ids)  # fix",
    });
    expect(a).toBe(b);
  });

  it('a different policy ⇒ a different key', () => {
    expect(incidentKey(SIG)).not.toBe(incidentKey({ ...SIG, failingPolicy: 'invoices.inv_select' }));
  });
});

describe('classifyArrival — attach vs open', () => {
  it('first session of a bug opens a new incident', () => {
    const a = classifyArrival(SIG, [], '2026-06-07T00:00:00Z', () => 'new1');
    expect(a.action).toBe('open');
    expect(a.incident.sessionCount).toBe(1);
    expect(a.incident.id).toBe('new1');
  });

  it('a matching session attaches and bumps the count — no new PR', () => {
    const a = classifyArrival(SIG, [openIncident({ sessionCount: 5 })], '2026-06-07T01:00:00Z', () => 'x');
    expect(a.action).toBe('attach');
    expect(a.incident.id).toBe('inc1');
    expect(a.incident.sessionCount).toBe(6);
    expect(a.incident.lastSeen).toBe('2026-06-07T01:00:00Z');
  });

  it('does not attach to a shipped/closed incident — opens fresh', () => {
    const a = classifyArrival(SIG, [openIncident({ status: 'shipped' })], '2026-06-07T01:00:00Z', () => 'new2');
    expect(a.action).toBe('open');
    expect(a.incident.id).toBe('new2');
  });

  it('a different bug opens its own incident even with one already open', () => {
    const a = classifyArrival({ ...SIG, route: '/invoices', failingPolicy: 'invoices.x' }, [openIncident()], 'now', () => 'new3');
    expect(a.action).toBe('open');
  });
});

describe('matchIncident', () => {
  it('finds the open incident with the same signature', () => {
    expect(matchIncident(SIG, [openIncident()])?.id).toBe('inc1');
  });
  it('returns null when nothing matches', () => {
    expect(matchIncident({ ...SIG, route: '/other' }, [openIncident()])).toBeNull();
  });
});

describe('severityScore — scales with affected sessions', () => {
  it('1 session → low, 5 → medium, 30 → high, 500 → critical', () => {
    expect(severityScore(openIncident({ sessionCount: 1 })).level).toBe('low');
    expect(severityScore(openIncident({ sessionCount: 5 })).level).toBe('medium');
    expect(severityScore(openIncident({ sessionCount: 30 })).level).toBe('high');
    expect(severityScore(openIncident({ sessionCount: 500 })).level).toBe('critical');
  });

  it('score is monotonic in session count', () => {
    const s = (n: number) => severityScore(openIncident({ sessionCount: n })).score;
    expect(s(1)).toBeLessThan(s(10));
    expect(s(10)).toBeLessThan(s(100));
  });

  it('a high/critical incident raises the dispatch floor to draft_pr', () => {
    expect(tierFloorFor('critical')).toBe('draft_pr');
    expect(tierFloorFor('high')).toBe('draft_pr');
    expect(tierFloorFor('low')).toBe('issue');
  });
});
