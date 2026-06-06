// rrweb capture — 30s rolling ring buffer, masked, in-memory only.
//
// Ticket: agents/tasks/0023-embed-rrweb-capture-sdk.md
//
// No transport here. flush() returns the buffer; ticket 0024 wires the
// frustration detector; ticket 0013 ships the buffer to the /capture
// edge function.

import { record, type eventWithTime } from 'rrweb';

const WINDOW_MS = 30_000;

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
    maskAllInputs: true,
    maskTextSelector: '[data-hush="mask"]',
    blockSelector: '[data-hush="block"]',
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
