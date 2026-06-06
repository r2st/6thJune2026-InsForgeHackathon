// apps/receipt/components/ConfidenceBadge.tsx
// The on-stage confidence badge (slide 07) + the per-signal veto chip (0035).
//
// Tickets: 0020 (composite + tier) · 0035 (ceiling + veto)
// Renders the composite score as the headline number and, when a single weak
// signal pulled the dispatch tier below what the composite alone would allow,
// a chip naming that signal — the answer to "could a 92% badge hide a weak
// replay?" rendered, not asserted.
//
// Pure presentation. Props mirror the relevant fields of `ConfidenceResult`
// in functions/types.ts; the receipt page receives them over the Realtime
// `receipt` channel as JSON, so a local mirror (not a cross-package import) is
// the right coupling here. Keep the two shapes in sync.
//
// Style: brand-guide.md — dark surface, Instrument Serif for the number,
// JetBrains Mono for labels. Tier colours: pr=mint (confirmed), draft=amber
// (provisional), issue=purple (info). One accent at a time; no glow on these.

import type { CSSProperties } from 'react';

export type ConfidenceTier = 'pr' | 'draft_pr' | 'issue';

export interface ConfidenceBadgeProps {
  score: number; // 0..100 composite — the headline
  tier: ConfidenceTier; // final dispatch tier (already floored by ceiling)
  veto?: { signal: string; value: number };
}

const TIER_META: Record<ConfidenceTier, { label: string; color: string }> = {
  pr: { label: 'open PR', color: '#6ee7b7' }, // --good (mint)
  draft_pr: { label: 'draft PR', color: '#fde68a' }, // --warn (amber)
  issue: { label: 'file issue', color: '#a78bfa' }, // --cool (purple)
};

export function ConfidenceBadge({ score, tier, veto }: ConfidenceBadgeProps) {
  const meta = TIER_META[tier];

  return (
    <div style={styles.wrap} data-tier={tier}>
      <div style={styles.row}>
        <span style={{ ...styles.score, color: meta.color }}>{score}%</span>
        <span style={styles.arrow}>→</span>
        <span style={{ ...styles.tier, color: meta.color, borderColor: meta.color }}>
          {meta.label}
        </span>
      </div>
      {veto ? (
        <div style={styles.veto}>
          tier limited by {veto.signal}: {veto.value}
        </div>
      ) : null}
    </div>
  );
}

export default ConfidenceBadge;

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: 'inline-flex',
    flexDirection: 'column',
    gap: 8,
    padding: '16px 20px',
    background: '#131418', // --bg-elev
    border: '1px solid #25272e', // --line
    borderRadius: 12,
  },
  row: { display: 'flex', alignItems: 'center', gap: 14 },
  score: {
    fontFamily: "'Instrument Serif', serif",
    fontSize: 48,
    lineHeight: 1,
    letterSpacing: '-0.02em',
  },
  arrow: { color: '#9097a3', fontFamily: "'JetBrains Mono', monospace" }, // --ink-dim
  tier: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    padding: '4px 12px',
    borderRadius: 999,
    border: '1px solid',
  },
  veto: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    letterSpacing: '0.04em',
    color: '#a78bfa', // --cool — the floor is an info-level override
  },
};
