// rrweb capture — 30s rolling ring buffer, masked, in-memory only.
//
// Ticket: agents/tasks/0023-embed-rrweb-capture-sdk.md
//
// No transport here. flush() returns the buffer; ticket 0024 wires the
// frustration detector; ticket 0013 ships the buffer to the /capture
// edge function.

import { record, type eventWithTime } from 'rrweb';

const WINDOW_MS = 30_000;

/**
 * PII masking config (ticket 0017). `maskAllInputs` redacts every input value
 * in the recording by default; `maskTextSelector` masks any element opted in
 * with `data-hush="mask"`; `blockSelector` drops `data-hush="block"` subtrees
 * entirely. Exported so the masking contract is unit-testable.
 */
export const MASK_CONFIG = {
  maskAllInputs: true,
  maskTextSelector: '[data-hush="mask"]',
  blockSelector: '[data-hush="block"]',
} as const;

let events: eventWithTime[] = [];
let stop: (() => void) | null = null;

function trim(now: number): void {
  const cutoff = now - WINDOW_MS;
  while (events.length > 0 && events[0]!.timestamp < cutoff) {
    events.shift();
  }
}

/** Start recording. Idempotent. */
export function start(): void {
  if (stop) return;
  const handle = record({
    emit(event) {
      events.push(event);
      trim(event.timestamp);
    },
    ...MASK_CONFIG,
  });
  stop = handle ?? null;
}

/** Stop recording. */
export function stopRecording(): void {
  stop?.();
  stop = null;
}

/** Return and clear the current buffer. */
export function flush(): eventWithTime[] {
  const drained = events;
  events = [];
  return drained;
}

/** Peek at the buffer without clearing. For verification only. */
export function peek(): eventWithTime[] {
  return events.slice();
}

/** Current buffer size — for the frustration detector + debug. */
export function size(): number {
  return events.length;
}
