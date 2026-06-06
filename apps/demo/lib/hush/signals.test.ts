import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { start, type Signal } from './signals';

function clickAt(target: Element, x: number, y: number): void {
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }),
  );
}

describe('signals — rage-click', () => {
  let stop: (() => void) | null = null;
  let signals: Signal[];

  beforeEach(() => {
    signals = [];
    document.body.innerHTML = '<button id="b">click me</button>';
  });

  afterEach(() => {
    stop?.();
    stop = null;
  });

  it('fires rage_click on three clicks on the same target inside 1s', () => {
    stop = start({ onSignal: (s) => signals.push(s) });
    const btn = document.getElementById('b')!;
    clickAt(btn, 100, 100);
    clickAt(btn, 100, 100);
    clickAt(btn, 100, 100);
    expect(signals.length).toBe(1);
    expect(signals[0]!.kind).toBe('rage_click');
    expect(signals[0]!.target).toContain('button');
  });

  it('does not fire rage_click on two clicks (below threshold)', () => {
    stop = start({ onSignal: (s) => signals.push(s) });
    const btn = document.getElementById('b')!;
    clickAt(btn, 100, 100);
    clickAt(btn, 100, 100);
    expect(signals.filter((s) => s.kind === 'rage_click').length).toBe(0);
  });

  it('respects cooldown — a second rage burst inside cooldown is ignored', () => {
    stop = start({ onSignal: (s) => signals.push(s), cooldownMs: 10_000 });
    const btn = document.getElementById('b')!;
    for (let i = 0; i < 3; i++) clickAt(btn, 100, 100);
    for (let i = 0; i < 3; i++) clickAt(btn, 100, 100);
    expect(signals.filter((s) => s.kind === 'rage_click').length).toBe(1);
  });
});

describe('signals — dead-click', () => {
  let stop: (() => void) | null = null;
  let signals: Signal[];

  beforeEach(() => {
    signals = [];
    document.body.innerHTML = '<button id="inert">does nothing</button>';
    vi.useFakeTimers();
  });

  afterEach(() => {
    stop?.();
    stop = null;
    vi.useRealTimers();
  });

  it('fires dead_click when a click triggers no mutation and no fetch within the window', async () => {
    stop = start({
      onSignal: (s) => signals.push(s),
      deadClickMs: 100,
      // Force the rage threshold above 1 so the single click can't match
      // rage-click and we isolate dead-click behavior.
      rageClicks: 99,
    });
    const btn = document.getElementById('inert')!;
    clickAt(btn, 50, 50);
    await vi.advanceTimersByTimeAsync(200);
    expect(signals.length).toBe(1);
    expect(signals[0]!.kind).toBe('dead_click');
  });
});
