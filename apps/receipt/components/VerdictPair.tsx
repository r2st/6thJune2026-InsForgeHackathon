// apps/receipt/components/VerdictPair.tsx
//
// The money shot (FINAL.html slide 06): prod vs fork, side by side. Prod still
// returns 0 rows (orange — still buggy); the fork returns 3 (mint — fixed).
// This is the one place the brand's "one accent at a time" rule is deliberately
// broken: the orange/mint contrast IS the proof, so it earns both.

import type { CSSProperties } from 'react';

export interface VerdictPairProps {
  prodRows: number;
  forkRows: number;
}

export function VerdictPair({ prodRows, forkRows }: VerdictPairProps) {
  return (
    <div style={styles.row}>
      <Side label="prod" rows={prodRows} tone="bad" caption="still empty" />
      <span style={styles.arrow}>→</span>
      <Side label="fork" rows={forkRows} tone="good" caption="orders visible" />
    </div>
  );
}

function Side({
  label,
  rows,
  tone,
  caption,
}: {
  label: string;
  rows: number;
  tone: 'bad' | 'good';
  caption: string;
}) {
  const color = tone === 'good' ? 'var(--good)' : 'var(--accent)';
  return (
    <div style={{ ...styles.side, borderColor: color }}>
      <div style={{ ...styles.sideLabel, color }}>{label}</div>
      <div style={{ ...styles.count, color }}>{rows}</div>
      <div style={styles.caption}>{caption}</div>
    </div>
  );
}

export default VerdictPair;

const styles: Record<string, CSSProperties> = {
  row: { display: 'flex', alignItems: 'center', gap: 16, margin: '8px 0' },
  arrow: { fontFamily: "'JetBrains Mono', monospace", color: 'var(--ink-dim)', fontSize: 20 },
  side: {
    flex: 1,
    background: 'var(--bg-elev)',
    border: '1px solid',
    borderRadius: 12,
    padding: '18px 22px',
    textAlign: 'center',
  },
  sideLabel: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  count: {
    fontFamily: "'Instrument Serif', serif",
    fontSize: 56,
    lineHeight: 1,
    letterSpacing: '-0.02em',
  },
  caption: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    color: 'var(--ink-dim)',
    marginTop: 8,
  },
};
