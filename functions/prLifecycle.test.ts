// functions/prLifecycle.test.ts
// Acceptance tests for PR lifecycle management (ticket 0067).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STALE_TTL_MS,
  reactToEvent,
  staleDecision,
  type PrEvent,
  type PrRecord,
} from './prLifecycle.js';

const rec = (over: Partial<PrRecord> = {}): PrRecord => ({
  prId: 'pr1', state: 'open', lastActivityAt: 1_000_000, processedDeliveries: new Set(), ...over,
});
const ev = (over: Partial<PrEvent> & { kind: PrEvent['kind'] }): PrEvent => ({
  deliveryId: 'd1', ...over,
});

describe('reactToEvent — webhook-driven state machine', () => {
  it('merged → records the win, terminal', () => {
    const r = reactToEvent(rec(), ev({ kind: 'merged' }));
    expect(r.nextState).toBe('merged');
    expect(r.action).toBe('record_merged');
    expect(r.outcome).toBe('merged');
  });

  it('closed unmerged → records the rejection as a learning signal', () => {
    const r = reactToEvent(rec(), ev({ kind: 'closed' }));
    expect(r.nextState).toBe('closed');
    expect(r.action).toBe('record_rejected');
    expect(r.outcome).toBe('rejected');
  });

  it('approval → approved state, awaiting merge', () => {
    const r = reactToEvent(rec(), ev({ kind: 'review_submitted', decision: 'approved' }));
    expect(r.nextState).toBe('approved');
    expect(r.action).toBe('noop');
  });

  it('changes requested → reply with the diagnosis', () => {
    const r = reactToEvent(rec(), ev({ kind: 'review_submitted', decision: 'changes_requested' }));
    expect(r.nextState).toBe('changes_requested');
    expect(r.action).toBe('reply_with_diagnosis');
  });

  it('a "what is this?" question → answer with diagnosis/verdict/confidence', () => {
    const r = reactToEvent(rec(), ev({ kind: 'comment', isQuestion: true }));
    expect(r.action).toBe('reply_with_diagnosis');
  });

  it('a non-question comment → noop', () => {
    expect(reactToEvent(rec(), ev({ kind: 'comment', isQuestion: false })).action).toBe('noop');
  });

  it('base moved with conflicts → rebase and re-verify', () => {
    expect(reactToEvent(rec(), ev({ kind: 'base_moved', conflicts: true })).action).toBe('rebase_and_reverify');
  });

  it('base moved cleanly → noop', () => {
    expect(reactToEvent(rec(), ev({ kind: 'base_moved', conflicts: false })).action).toBe('noop');
  });

  it('policy changed and bug gone → close the now-unnecessary PR', () => {
    const r = reactToEvent(rec(), ev({ kind: 'policy_changed', bugStillPresent: false }));
    expect(r.nextState).toBe('closed');
    expect(r.action).toBe('close_bug_gone');
  });

  it('policy changed but bug remains → re-verify and update', () => {
    expect(reactToEvent(rec(), ev({ kind: 'policy_changed', bugStillPresent: true })).action).toBe('reverify_then_update');
  });
});

describe('reactToEvent — idempotency & terminal guards', () => {
  it('a replayed delivery id is a no-op (never double-acts)', () => {
    const r = reactToEvent(rec({ processedDeliveries: new Set(['d1']) }), ev({ kind: 'merged' }));
    expect(r.duplicate).toBe(true);
    expect(r.action).toBe('noop');
  });

  it('a terminal PR ignores further events', () => {
    const r = reactToEvent(rec({ state: 'merged' }), ev({ kind: 'closed' }));
    expect(r.action).toBe('noop');
    expect(r.nextState).toBe('merged');
  });
});

describe('staleDecision — clean up rot', () => {
  const now = 1_000_000 + DEFAULT_STALE_TTL_MS;

  it('an open PR past the TTL is auto-closed and an issue filed', () => {
    const d = staleDecision(rec({ lastActivityAt: 1 }), now);
    expect(d.stale).toBe(true);
    expect(d.action).toBe('auto_close_and_file_issue');
  });

  it('an open PR within the TTL is left alone', () => {
    const d = staleDecision(rec({ lastActivityAt: now - 1000 }), now);
    expect(d.stale).toBe(false);
  });

  it('an approved PR is never stale — it awaits a human merge, not ignored', () => {
    expect(staleDecision(rec({ state: 'approved', lastActivityAt: 1 }), now).stale).toBe(false);
  });

  it('a terminal PR is not subject to the stale policy', () => {
    expect(staleDecision(rec({ state: 'closed', lastActivityAt: 1 }), now).stale).toBe(false);
  });
});
