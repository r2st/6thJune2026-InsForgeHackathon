// functions/privacy.test.ts
// Acceptance tests for the privacy policy core (ticket 0056).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import {
  consentGate,
  DEFAULT_RETENTION,
  deletionPlan,
  forkSeedWithinBoundary,
  forkShouldDestroy,
  purgePlan,
  type Retainable,
  type UserDataIndex,
} from './privacy.js';

const now = 1_000 * 24 * 60 * 60 * 1000; // day 1000 in ms
const daysAgo = (d: number) => now - d * 24 * 60 * 60 * 1000;
const hoursAgo = (h: number) => now - h * 60 * 60 * 1000;

describe('purgePlan — retention TTLs', () => {
  const entities: Retainable[] = [
    { id: 's-old', kind: 'session', createdAt: daysAgo(40) },   // > 30d
    { id: 's-new', kind: 'session', createdAt: daysAgo(10) },   // < 30d
    { id: 'r-old', kind: 'run', createdAt: daysAgo(100) },      // > 90d
    { id: 'r-new', kind: 'run', createdAt: daysAgo(80) },       // < 90d
    { id: 'f-old', kind: 'fork', createdAt: hoursAgo(48) },     // > 24h
    { id: 'f-new', kind: 'fork', createdAt: hoursAgo(2) },      // < 24h
  ];

  it('purges only entities past their kind-specific TTL', () => {
    const ids = purgePlan(entities, now).map((p) => p.id).sort();
    expect(ids).toEqual(['f-old', 'r-old', 's-old']);
  });

  it('forks have an hours-scale TTL, far shorter than runs', () => {
    expect(DEFAULT_RETENTION.forkTtlHours).toBeLessThanOrEqual(24);
    const onlyFork = purgePlan([{ id: 'f', kind: 'fork', createdAt: hoursAgo(25) }], now);
    expect(onlyFork).toHaveLength(1);
  });

  it('an empty set yields an empty plan', () => {
    expect(purgePlan([], now)).toEqual([]);
  });
});

describe('forkShouldDestroy — forks die on any terminal signal', () => {
  it('TTL, merge, close, and run-failure all destroy the fork', () => {
    expect(forkShouldDestroy('ttl_expired')).toBe(true);
    expect(forkShouldDestroy('merged')).toBe(true);
    expect(forkShouldDestroy('closed')).toBe(true);
    expect(forkShouldDestroy('run_failed')).toBe(true);
  });
});

describe('consentGate — DNT and per-site consent honored', () => {
  it('DNT always suppresses capture', () => {
    expect(consentGate({ dnt: true, siteRequiresConsent: false, userConsented: true }).capture).toBe(false);
  });

  it('a consent-required site needs explicit opt-in', () => {
    expect(consentGate({ dnt: false, siteRequiresConsent: true, userConsented: false }).capture).toBe(false);
    expect(consentGate({ dnt: false, siteRequiresConsent: true, userConsented: true }).capture).toBe(true);
  });

  it('no consent gate configured → capture allowed (DNT still wins)', () => {
    expect(consentGate({ dnt: false, siteRequiresConsent: false, userConsented: false }).capture).toBe(true);
  });
});

describe('deletionPlan — DSAR cascade across Storage + DB', () => {
  const index: UserDataIndex = {
    sessionIds: ['s1', 's2', 's1'], // dup on purpose
    storageKeys: ['clips/s1.json', 'clips/s2.json'],
    runIds: ['r1'],
    forkIds: ['fork-9'],
  };

  it('cascades sessions, runs, storage objects, and forks; dedupes', () => {
    const plan = deletionPlan('u1', index);
    expect(plan.empty).toBe(false);
    expect(plan.dbDeletes.find((d) => d.table === 'sessions')?.ids).toEqual(['s1', 's2']);
    expect(plan.dbDeletes.find((d) => d.table === 'bug_runs')?.ids).toEqual(['r1']);
    expect(plan.storageDeletes).toEqual(['clips/s1.json', 'clips/s2.json']);
    expect(plan.forkDestroys).toEqual(['fork-9']);
  });

  it('a user with no data yields an honest empty plan, not an error', () => {
    const plan = deletionPlan('u2', { sessionIds: [], storageKeys: [], runIds: [], forkIds: [] });
    expect(plan.empty).toBe(true);
    expect(plan.dbDeletes).toEqual([]);
  });
});

describe('forkSeedWithinBoundary — "only the affected rows, never your prod data"', () => {
  it('a fork seeded with the touched rows + small neighbour set is minimal', () => {
    expect(forkSeedWithinBoundary(8, 3).ok).toBe(true); // 8 <= 3 + 5
  });

  it('a fork seeded with far more than the affected rows is a boundary violation', () => {
    const r = forkSeedWithinBoundary(500, 3);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/over-copy/);
  });
});
