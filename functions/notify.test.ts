// functions/notify.test.ts
// Acceptance tests for notifications & routing (ticket 0063).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import {
  buildMessage,
  deliveryMode,
  planDelivery,
  routeChannels,
  type RoutingRule,
  type RunNotice,
} from './notify.js';

const notice = (over: Partial<RunNotice> = {}): RunNotice => ({
  runId: 'r1', tier: 'pr', summary: 'orders policy hid the tenant rows',
  confidence: 90, verdict: { prodRows: 0, forkRows: 3 },
  runUrl: 'https://app/run/r1', outputUrl: 'https://gh/pr/42', ...over,
});

describe('buildMessage — tier-aware, actionable', () => {
  it('pr → "review this fix"', () => {
    const m = buildMessage(notice({ tier: 'pr' }));
    expect(m.headline).toMatch(/review this fix/i);
    expect(m.ctaLabel).toBe('Review PR');
    expect(m.ctaUrl).toBe('https://gh/pr/42');
  });

  it('draft_pr → "needs a human"', () => {
    expect(buildMessage(notice({ tier: 'draft_pr' })).headline).toMatch(/needs a human/i);
  });

  it("issue → \"can't auto-fix\"", () => {
    expect(buildMessage(notice({ tier: 'issue' })).headline).toMatch(/can't auto-fix/i);
  });

  it('body carries confidence, veto reason, and the prod/fork verdict', () => {
    const m = buildMessage(notice({ confidence: 72, vetoReason: 'diffSize' }));
    expect(m.body).toMatch(/confidence 72/);
    expect(m.body).toMatch(/limited by diffSize/);
    expect(m.body).toMatch(/prod 0 rows → fork 3 rows/);
  });

  it('falls back to the run URL when there is no output URL', () => {
    expect(buildMessage(notice({ outputUrl: undefined })).ctaUrl).toBe('https://app/run/r1');
  });
});

describe('routeChannels — per-workspace tier→channel rules', () => {
  const rules: RoutingRule[] = [
    { tier: 'pr', channels: ['slack', 'email'] },
    { tier: 'issue', channels: ['slack'] },
  ];

  it('routes a tier to its configured channels, deduped', () => {
    expect(routeChannels('pr', rules)).toEqual(['slack', 'email']);
  });

  it('a tier with no rule routes nowhere (silence is valid config)', () => {
    expect(routeChannels('draft_pr', rules)).toEqual([]);
  });
});

describe('deliveryMode — digest vs immediate', () => {
  it('immediate when digest is off', () => {
    expect(deliveryMode('draft_pr', { digestEnabled: false, alwaysImmediate: ['pr'] })).toBe('immediate');
  });

  it('a pr is always immediate even with digest on (the value-prop promise)', () => {
    expect(deliveryMode('pr', { digestEnabled: true, alwaysImmediate: ['pr'] })).toBe('immediate');
  });

  it('routine tiers digest when digest mode is on', () => {
    expect(deliveryMode('draft_pr', { digestEnabled: true, alwaysImmediate: ['pr'] })).toBe('digest');
    expect(deliveryMode('issue', { digestEnabled: true, alwaysImmediate: ['pr'] })).toBe('digest');
  });
});

describe('planDelivery — the full plan', () => {
  const rules: RoutingRule[] = [{ tier: 'pr', channels: ['slack', 'email'] }];

  it('produces one task per channel with the built message', () => {
    const plan = planDelivery(notice({ tier: 'pr' }), rules);
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks.map((t) => t.channel)).toEqual(['slack', 'email']);
    expect(plan.silent).toBe(false);
    expect(plan.tasks[0]!.message.ctaLabel).toBe('Review PR');
  });

  it('an unrouted tier yields a silent (but honest) empty plan', () => {
    const plan = planDelivery(notice({ tier: 'draft_pr' }), rules);
    expect(plan.tasks).toEqual([]);
    expect(plan.silent).toBe(true);
  });

  it('digest mode marks routine tasks as digest', () => {
    const plan = planDelivery(notice({ tier: 'issue' }), [{ tier: 'issue', channels: ['slack'] }], { digestEnabled: true, alwaysImmediate: ['pr'] });
    expect(plan.tasks[0]!.mode).toBe('digest');
  });
});
