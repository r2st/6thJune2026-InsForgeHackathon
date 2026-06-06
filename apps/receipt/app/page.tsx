import Link from 'next/link';

// The receipt app is per-run (/r/[runId]). This landing is just a way into the
// scripted demo run during rehearsal.
export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '96px 28px' }}>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-dim)',
        }}
      >
        hush · live receipt
      </div>
      <h1
        style={{
          fontFamily: "'Instrument Serif', serif",
          fontWeight: 400,
          fontSize: 56,
          margin: '16px 0 24px',
          letterSpacing: '-0.02em',
        }}
      >
        Nothing captured yet.
      </h1>
      <p style={{ color: 'var(--ink-dim)', fontSize: 16, lineHeight: 1.6 }}>
        A receipt opens per run at <code>/r/&lt;runId&gt;</code>. To rehearse the
        full arc with no backend, open{' '}
        <Link href="/r/demo?demo=1" style={{ color: 'var(--good)' }}>
          /r/demo?demo=1
        </Link>
        .
      </p>
    </main>
  );
}
