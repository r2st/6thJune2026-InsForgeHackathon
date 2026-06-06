'use client';

// apps/receipt/app/r/[runId]/page.tsx
//
// The receipt page (tickets 0015 + 0009 subscriber + 0022). Subscribes to the
// 'receipt' Realtime channel for one run and lights up the status feed as each
// stage event arrives. Renders the diagnosis card on 'diagnosed', the prod-vs-
// fork pair on the testing verdict, and the confidence badge + PR link on
// 'shipped'. Add ?demo=1 to play the scripted sequence with no backend.

import { use, useEffect, useMemo, useRef, useState } from 'react';
import {
  STEP_SEQUENCE,
  playDemoSequence,
  subscribeToReceipt,
  type ReceiptEvent,
  type ReceiptStep,
} from '../../../lib/realtime';
import DiagnosisCard, { type DiagnosisCardProps } from '../../../components/DiagnosisCard';
import VerdictPair from '../../../components/VerdictPair';
import ConfidenceBadge, { type ConfidenceTier } from '../../../components/ConfidenceBadge';

const IDLE_MS = 30_000;

export default function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ demo?: string }>;
}) {
  const { runId } = use(params);
  const { demo } = use(searchParams);
  const isDemo = demo === '1' || demo === 'true';

  // Last event per step (last-write-wins handles out-of-order arrival).
  const [events, setEvents] = useState<Record<ReceiptStep, ReceiptEvent | undefined>>(
    {} as Record<ReceiptStep, ReceiptEvent | undefined>,
  );
  const [transport, setTransport] = useState<'realtime' | 'polling' | 'demo'>(
    isDemo ? 'demo' : 'realtime',
  );
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onEvent = useMemo(
    () => (e: ReceiptEvent) => {
      setEvents((prev) => ({ ...prev, [e.step]: e }));
      setIdle(false);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
    },
    [],
  );

  useEffect(() => {
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
    const stop = isDemo
      ? playDemoSequence(runId, onEvent)
      : subscribeToReceipt(runId, { onEvent, onTransport: setTransport });
    return () => {
      stop();
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [runId, isDemo, onEvent]);

  const diagnosed = events.diagnosed?.detail as DiagnosisCardProps | undefined;
  const testingDetail = events.testing?.detail as
    | { mode?: string; prodRows?: number; forkRows?: number }
    | undefined;
  const shipped = events.shipped?.detail as
    | { tier?: ConfidenceTier; confidence?: number; prUrl?: string | null; mode?: string; verified?: boolean; prodRows?: number; forkRows?: number }
    | undefined;
  const failed = events.failed?.detail as { error?: string; reason?: string } | undefined;

  const verdict = pickVerdict(testingDetail, shipped);
  const reachedIndex = STEP_SEQUENCE.reduce(
    (acc, s, i) => (events[s.step] ? i : acc),
    -1,
  );

  return (
    <main style={styles.wrap}>
      <header style={styles.head}>
        <div style={styles.eyebrow}>
          <span style={styles.dot} /> hush · live receipt
          <span style={styles.transport}>
            {transport === 'demo' ? 'demo mode' : transport}
          </span>
        </div>
        <h1 style={styles.h1}>run {runId}</h1>
        <p style={styles.lede}>
          A customer got stuck. Watch Hush trace the symptom to the policy and ship the fix.
        </p>
      </header>

      <ol style={styles.feed}>
        {STEP_SEQUENCE.map((s, i) => {
          const seen = Boolean(events[s.step]);
          const active = i === reachedIndex && s.step !== 'shipped';
          return (
            <li key={s.step} style={styles.step}>
              <span
                style={{
                  ...styles.tick,
                  borderColor: seen ? 'var(--good)' : 'var(--line)',
                  background: seen ? 'var(--good)' : 'transparent',
                  animation: active ? 'hush-pulse 1.1s ease-in-out infinite' : undefined,
                }}
              />
              <span style={{ ...styles.stepLabel, color: seen ? 'var(--ink)' : 'var(--ink-dim)' }}>
                {s.label}
              </span>
              <span style={styles.stepSub}>{seen ? relTime(events[s.step]!.at) : s.sub}</span>
            </li>
          );
        })}
      </ol>

      {diagnosed ? <DiagnosisCard {...diagnosed} /> : null}

      {verdict ? (
        <section style={styles.block}>
          <div style={styles.blockLabel}>// REPLAY VERDICT{testingDetail?.mode === 'trace' ? ' · trace fallback' : ''}</div>
          <VerdictPair prodRows={verdict.prodRows} forkRows={verdict.forkRows} />
        </section>
      ) : null}

      {shipped?.tier ? (
        <section style={styles.block}>
          <div style={styles.blockLabel}>// SHIPPED</div>
          <ConfidenceBadge score={shipped.confidence ?? 0} tier={shipped.tier} />
          {shipped.prUrl ? (
            <p style={styles.prLine}>
              <a href={shipped.prUrl} style={styles.prLink} target="_blank" rel="noreferrer">
                {shipped.prUrl}
              </a>
            </p>
          ) : null}
        </section>
      ) : null}

      {failed ? (
        <section style={{ ...styles.block, borderColor: 'var(--accent)' }}>
          <div style={{ ...styles.blockLabel, color: 'var(--accent)' }}>// STOPPED</div>
          <p style={styles.lede}>{failed.error ?? failed.reason ?? 'Run stopped.'}</p>
        </section>
      ) : null}

      {idle && reachedIndex < 0 ? (
        <p style={styles.idle}>Waiting for a session — nothing captured yet.</p>
      ) : null}
    </main>
  );
}

function pickVerdict(
  testing: { prodRows?: number; forkRows?: number } | undefined,
  shipped: { prodRows?: number; forkRows?: number } | undefined,
): { prodRows: number; forkRows: number } | null {
  const src = shipped?.forkRows !== undefined ? shipped : testing;
  if (src && typeof src.prodRows === 'number' && typeof src.forkRows === 'number') {
    return { prodRows: src.prodRows, forkRows: src.forkRows };
  }
  return null;
}

function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'just now';
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (secs < 2) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  return `${Math.round(secs / 60)}m ago`;
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 720, margin: '0 auto', padding: '56px 28px 96px' },
  head: { borderBottom: '1px solid var(--line)', paddingBottom: 28, marginBottom: 32 },
  eyebrow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--ink-dim)',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: 'var(--accent)',
    boxShadow: '0 0 12px var(--accent)',
    display: 'inline-block',
  },
  transport: { marginLeft: 'auto', color: 'var(--good)', letterSpacing: '0.08em' },
  h1: {
    fontFamily: "'Instrument Serif', serif",
    fontWeight: 400,
    fontSize: 44,
    margin: '18px 0 10px',
    letterSpacing: '-0.02em',
  },
  lede: { color: 'var(--ink-dim)', fontSize: 15, lineHeight: 1.55, margin: 0, maxWidth: '52ch' },
  feed: { listStyle: 'none', margin: '0 0 8px', padding: 0 },
  step: {
    display: 'grid',
    gridTemplateColumns: '22px 1fr auto',
    alignItems: 'center',
    gap: 14,
    padding: '13px 0',
    borderBottom: '1px dashed var(--line)',
  },
  tick: { width: 13, height: 13, borderRadius: '50%', border: '2px solid', justifySelf: 'center' },
  stepLabel: { fontFamily: "'Instrument Serif', serif", fontSize: 19 },
  stepSub: { fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--ink-dim)' },
  block: {
    background: 'var(--bg-elev)',
    border: '1px solid var(--line)',
    borderRadius: 14,
    padding: '20px 24px',
    margin: '14px 0',
  },
  blockLabel: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10.5,
    letterSpacing: '0.16em',
    color: 'var(--ink-dim)',
    marginBottom: 14,
  },
  prLine: { margin: '14px 0 0' },
  prLink: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    color: 'var(--good)',
    borderBottom: '1px dotted rgba(110,231,183,0.4)',
    textDecoration: 'none',
  },
  idle: { color: 'var(--ink-dim)', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 24 },
};
