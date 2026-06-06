// apps/demo/lib/hush/pii.test.ts
//
// Ticket 0017 — the code behind the Q&A answers "what about PII?" and "what
// about cost?". Two invariants:
//   1. Masking: rrweb redacts all inputs + any data-hush="mask" element.
//   2. Sampling: nothing is captured unless a frustration signal fires —
//      a happy-path session produces zero onSignal calls (so zero /capture
//      POSTs, zero Storage writes).

import { describe, expect, it, vi, afterEach } from 'vitest';
import { MASK_CONFIG } from './capture';
import { start as startSignals } from './signals';

describe('PII masking config', () => {
  it('masks all inputs by default', () => {
    expect(MASK_CONFIG.maskAllInputs).toBe(true);
  });

  it('masks elements opted in with data-hush="mask"', () => {
    expect(MASK_CONFIG.maskTextSelector).toBe('[data-hush="mask"]');
  });

  it('blocks data-hush="block" subtrees entirely', () => {
    expect(MASK_CONFIG.blockSelector).toBe('[data-hush="block"]');
  });
});

describe('sampling — only frustration sessions are captured', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('fires no signal on a happy path (a single, satisfied click)', () => {
    const onSignal = vi.fn();
    const stop = startSignals({ onSignal });

    // One ordinary click that resolves (DOM mutates) → not frustration.
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.click();
    document.body.appendChild(document.createElement('div')); // the app responded

    expect(onSignal).not.toHaveBeenCalled();
    stop();
  });

  it('does not capture an idle session (no interaction at all)', () => {
    const onSignal = vi.fn();
    const stop = startSignals({ onSignal });
    expect(onSignal).not.toHaveBeenCalled();
    stop();
  });
});
