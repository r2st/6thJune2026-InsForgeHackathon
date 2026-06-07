// functions/workspaceMode.test.ts
// Acceptance tests for observe/draft/auto mode gate + graduation (ticket 0070).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import {
  classifyChange,
  decideGraduation,
  DEFAULT_MODE,
  gateDispatch,
  modeRank,
} from './workspaceMode.js';

describe('default mode — observe is the production default', () => {
  it('a brand-new workspace watches only', () => {
    expect(DEFAULT_MODE).toBe('observe');
  });
});

describe('gateDispatch — mode only ever makes dispatch more conservative', () => {
  it('observe: every earned tier becomes record_only with ship a no-op', () => {
    for (const tier of ['pr', 'draft_pr', 'issue'] as const) {
      const g = gateDispatch('observe', tier);
      expect(g.action).toBe('record_only');
      expect(g.shipIsNoOp).toBe(true);
      expect(g.earnedTier).toBe(tier); // earned tier preserved for the dashboard
    }
  });

  it('draft: a PR-worthy fix is capped to a draft PR', () => {
    expect(gateDispatch('draft', 'pr').action).toBe('open_draft_pr');
    expect(gateDispatch('draft', 'draft_pr').action).toBe('open_draft_pr');
  });

  it('draft: an issue-tier bug still routes to an issue', () => {
    expect(gateDispatch('draft', 'issue').action).toBe('open_issue');
  });

  it('auto: the earned confidence tier is honored', () => {
    expect(gateDispatch('auto', 'pr').action).toBe('open_pr');
    expect(gateDispatch('auto', 'draft_pr').action).toBe('open_draft_pr');
    expect(gateDispatch('auto', 'issue').action).toBe('open_issue');
  });

  it('no mode ever upgrades a tier — observe/draft are never less safe than auto', () => {
    // A 'pr' earned tier: auto opens a PR, draft caps to draft, observe records only.
    expect(gateDispatch('auto', 'pr').action).toBe('open_pr');
    expect(gateDispatch('draft', 'pr').action).toBe('open_draft_pr');
    expect(gateDispatch('observe', 'pr').action).toBe('record_only');
  });
});

describe('graduation — reversible, one click', () => {
  it('ranks observe < draft < auto', () => {
    expect(modeRank('observe')).toBeLessThan(modeRank('draft'));
    expect(modeRank('draft')).toBeLessThan(modeRank('auto'));
  });

  it('classifies up/down/no-op changes', () => {
    expect(classifyChange('observe', 'draft')).toBe('upgrade');
    expect(classifyChange('auto', 'draft')).toBe('downgrade');
    expect(classifyChange('draft', 'draft')).toBe('noop');
  });

  it('a one-step upgrade is the intended path', () => {
    const d = decideGraduation('observe', 'draft');
    expect(d.allowed).toBe(true);
    expect(d.change).toBe('upgrade');
    expect(d.reason).toMatch(/one step up/);
  });

  it('skipping a step (observe→auto) is allowed but flagged', () => {
    const d = decideGraduation('observe', 'auto');
    expect(d.allowed).toBe(true);
    expect(d.reason).toMatch(/skips a step/);
  });

  it('a downgrade is always allowed — pull back to safety anytime', () => {
    expect(decideGraduation('auto', 'observe')).toMatchObject({ allowed: true, change: 'downgrade' });
  });
});
