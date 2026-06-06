// apps/receipt/lib/realtime.ts
//
// Subscriber side of ticket 0009 + the wiring for 0015. The publisher lives in
// the backend orchestrator (functions/fix-trigger.ts), which calls
// `getClient().realtime.publish('receipt', step, event)` once per stage. We
// subscribe to that same channel and hand each event to the receipt UI.
//
// Tickets: 0015 (subscribe + render <1s), 0009 (the step stream).
//
// The event shape is a LOCAL MIRROR of `ReceiptEvent` in functions/types.ts —
// it arrives as JSON over Realtime, so a mirror (not a cross-package import) is
// the right coupling, same convention as ConfidenceBadge. Keep them in sync.

export type ReceiptStep =
  | 'captured'
  | 'correlated'
  | 'diagnosed'
  | 'testing'
  | 'shipped'
  | 'failed';

export interface ReceiptEvent {
  runId: string;
  step: ReceiptStep;
  at: string; // ISO8601
  detail?: Record<string, unknown>;
}

/** The canonical step order for the status feed (failed is terminal, off-list). */
export const STEP_SEQUENCE: { step: ReceiptStep; label: string; sub: string }[] = [
  { step: 'captured', label: 'Session captured', sub: 'frustration signal · rrweb' },
  { step: 'correlated', label: 'Backend log tapped', sub: 'request_log · 1 anomaly' },
  { step: 'diagnosed', label: 'Policy diagnosed', sub: 'InsForge AI' },
  { step: 'testing', label: 'Replayed on a fork', sub: 'branch project' },
  { step: 'shipped', label: 'Fix shipped', sub: 'PR · draft · or issue' },
];

const CHANNEL = 'receipt';

export type Unsubscribe = () => void;

interface SubscribeOptions {
  /** Called for every event whose runId matches (or every event if runId is '*'). */
  onEvent: (event: ReceiptEvent) => void;
  /** Called when the transport degrades to polling, so the UI can show it. */
  onTransport?: (mode: 'realtime' | 'polling') => void;
}

/**
 * Subscribe to the receipt channel for one run. Tries InsForge Realtime over a
 * WebSocket; if the connection can't be opened (no env, blocked, dev), falls
 * back to polling the `bug_runs` snapshot every second so the page still lives.
 *
 * Returns an unsubscribe function — call it on unmount.
 */
export function subscribeToReceipt(runId: string, opts: SubscribeOptions): Unsubscribe {
  const url = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const key = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;

  // No backend configured → caller should use demo mode; we no-op politely.
  if (!url || !key) {
    opts.onTransport?.('polling');
    return () => {};
  }

  let socket: WebSocket | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const startPolling = () => {
    if (closed || pollTimer) return;
    opts.onTransport?.('polling');
    pollTimer = setInterval(async () => {
      try {
        const res = await fetch(
          `${url}/rest/v1/bug_runs?id=eq.${encodeURIComponent(runId)}&select=*`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } },
        );
        if (!res.ok) return;
        const rows = (await res.json()) as Array<Record<string, unknown>>;
        const row = rows[0];
        if (row) emitSnapshotFromRow(runId, row, opts.onEvent);
      } catch {
        /* keep polling; transient */
      }
    }, 1000);
  };

  try {
    const wsUrl = url.replace(/^http/, 'ws') + `/realtime/v1/websocket?apikey=${key}`;
    socket = new WebSocket(wsUrl);
    socket.onopen = () => {
      opts.onTransport?.('realtime');
      socket?.send(JSON.stringify({ type: 'subscribe', channel: CHANNEL }));
    };
    socket.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data as string) as Partial<ReceiptEvent> & {
          payload?: ReceiptEvent;
        };
        const event = (data.payload ?? data) as ReceiptEvent;
        if (!event || !event.step) return;
        if (runId === '*' || event.runId === runId) opts.onEvent(event);
      } catch {
        /* ignore malformed frames */
      }
    };
    socket.onerror = () => startPolling();
    socket.onclose = () => {
      if (!closed) startPolling();
    };
  } catch {
    startPolling();
  }

  return () => {
    closed = true;
    if (pollTimer) clearInterval(pollTimer);
    try {
      socket?.close();
    } catch {
      /* noop */
    }
  };
}

/** Rebuild step events from a polled bug_runs row (refresh / fallback survival). */
function emitSnapshotFromRow(
  runId: string,
  row: Record<string, unknown>,
  onEvent: (e: ReceiptEvent) => void,
) {
  const status = String(row.status ?? '');
  const at = String(row.updated_at ?? new Date(0).toISOString());
  const reached: ReceiptStep[] = ['captured'];
  if (row.diagnosis) reached.push('correlated', 'diagnosed');
  if (status === 'shipped') reached.push('testing', 'shipped');
  for (const step of reached) {
    onEvent({
      runId,
      step,
      at,
      detail:
        step === 'diagnosed'
          ? {
              summary: (row.diagnosis as Record<string, unknown> | undefined)?.summary,
              failingPolicy: (row.diagnosis as Record<string, unknown> | undefined)?.failingPolicy,
            }
          : step === 'shipped'
            ? { tier: row.tier, confidence: row.confidence, prUrl: row.pr_url }
            : undefined,
    });
  }
}

// ---------------------------------------------------------------------------
// Demo mode — a scripted run on a realistic timeline. Lets the receipt page
// play the full 60-second arc with no backend, for rehearsal and screenshots.
// ?demo=1 on /r/[runId] uses this instead of the live socket.
// ---------------------------------------------------------------------------

export interface DemoVerdict {
  prodRows: number;
  forkRows: number;
}

const DEMO_DIAGNOSIS = {
  summary: 'User expected to see their orders but the list came back empty.',
  expectation: '3 orders for tenant "acme"',
  observation: '0 rows returned — server answered 200',
  failingPolicy: 'orders.orders_select',
  failingJwtClaim: "auth.jwt() ->> 'tenant'",
};

/** Fire the canonical demo sequence; returns a cancel function. */
export function playDemoSequence(
  runId: string,
  onEvent: (e: ReceiptEvent) => void,
): Unsubscribe {
  const now = () => new Date().toISOString();
  const beats: { at: number; event: () => ReceiptEvent }[] = [
    { at: 0, event: () => ({ runId, step: 'captured', at: now(), detail: { signal: 'rage_click', sessionId: 'sess_demo' } }) },
    { at: 600, event: () => ({ runId, step: 'correlated', at: now(), detail: { route: '/api/orders', expectedRows: 3 } }) },
    { at: 1600, event: () => ({ runId, step: 'diagnosed', at: now(), detail: DEMO_DIAGNOSIS }) },
    { at: 2800, event: () => ({ runId, step: 'testing', at: now(), detail: { mode: 'fork', prodRows: 0, forkRows: 3 } }) },
    { at: 4400, event: () => ({ runId, step: 'shipped', at: now(), detail: { tier: 'pr', confidence: 92, prUrl: 'https://github.com/r2st/hush-victim-acme/pull/1', mode: 'fork', verified: true, prodRows: 0, forkRows: 3 } }) },
  ];
  const timers = beats.map((b) => setTimeout(() => onEvent(b.event()), b.at));
  return () => timers.forEach(clearTimeout);
}
