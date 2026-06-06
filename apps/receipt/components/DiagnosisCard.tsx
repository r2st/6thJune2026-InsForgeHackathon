// apps/receipt/components/DiagnosisCard.tsx
//
// Ticket 0022 — the plain-English diagnosis card. Renders on the 'diagnosed'
// Realtime event. This is the on-stage moment Hush stops looking like a black
// box: it says, in one sentence, what the user expected and which policy
// filtered them. The failing JWT claim is the most interesting bit — rendered
// inline as a code chip.
//
// Degrades gracefully: the live 'diagnosed' event carries { summary,
// failingPolicy }; demo mode carries the full set. Render whatever is present;
// never crash on a partial. Style per assets/brand/brand-guide.md.

import type { CSSProperties } from 'react';

export interface DiagnosisCardProps {
  summary?: string;
  expectation?: string;
  observation?: string;
  failingPolicy?: string;
  failingJwtClaim?: string;
}

export function DiagnosisCard(props: DiagnosisCardProps) {
  const { summary, expectation, observation, failingPolicy, failingJwtClaim } = props;
  if (!summary && !failingPolicy && !failingJwtClaim) return null;

  return (
    <div style={styles.card}>
      <div style={styles.eyebrow}>{'// DIAGNOSIS'}</div>

      {summary ? <p style={styles.summary}>{summary}</p> : null}

      {(expectation || observation) && (
        <div style={styles.pairRow}>
          {expectation ? (
            <div style={styles.pair}>
              <span style={styles.pairLabel}>expected</span>
              <span style={styles.pairBody}>{expectation}</span>
            </div>
          ) : null}
          {observation ? (
            <div style={styles.pair}>
              <span style={{ ...styles.pairLabel, color: 'var(--accent)' }}>observed</span>
              <span style={styles.pairBody}>{observation}</span>
            </div>
          ) : null}
        </div>
      )}

      {(failingPolicy || failingJwtClaim) && (
        <div style={styles.policyLine}>
          {failingPolicy ? (
            <>
              policy <code style={styles.chip}>{failingPolicy}</code>
            </>
          ) : null}
          {failingJwtClaim ? (
            <>
              {' '}reads <code style={styles.chip}>{failingJwtClaim}</code>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default DiagnosisCard;

const styles: Record<string, CSSProperties> = {
  card: {
    background: 'var(--bg-elev2)',
    borderLeft: '3px solid var(--accent)',
    border: '1px solid var(--line)',
    borderLeftWidth: 3,
    borderRadius: 12,
    padding: '20px 24px',
    margin: '8px 0',
    animation: 'hush-fade-in 200ms ease-out',
  },
  eyebrow: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10.5,
    letterSpacing: '0.16em',
    color: 'var(--accent)',
    marginBottom: 12,
  },
  summary: {
    fontFamily: "'Instrument Serif', serif",
    fontSize: 22,
    lineHeight: 1.35,
    color: 'var(--ink)',
    margin: '0 0 14px',
  },
  pairRow: { display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 12 },
  pair: { display: 'flex', flexDirection: 'column', gap: 2 },
  pairLabel: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--ink-dim)',
  },
  pairBody: { fontSize: 14, color: 'var(--ink)' },
  policyLine: {
    fontSize: 13.5,
    lineHeight: 1.7,
    color: 'var(--ink-dim)',
    fontFamily: 'Inter, sans-serif',
  },
  chip: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12.5,
    background: 'rgba(255,107,53,0.12)',
    color: 'var(--accent)',
    padding: '2px 7px',
    borderRadius: 5,
  },
};
