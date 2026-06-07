// functions/memoryIntegrity.ts
// Feedback / Memoir integrity — keep the learning loop from being steered wrong.
//
// Ticket:  agents/tasks/0092-feedback-integrity.md
// Defends: ADR 0003 Risk 7 — Memoir learns from merge/reject; garbage or
//          adversarial feedback poisons future diagnoses. A learning system
//          without integrity controls degrades or gets weaponized.
//
// Pure, testable core layered on top of memory.ts: weight each outcome by
// provenance (a human review is worth more than an unverified auto-signal) and
// recency (stale memories decay), resist outliers (one lone reject can't tank an
// established pattern), and detect source-dominance (one actor moving the corpus
// too fast). The RealMemoir adapter consumes these weights at write/recall time.

/** Where an outcome came from — higher trust = more influence on the corpus. */
export type Provenance = 'human_review' | 'merge' | 'auto_revert' | 'unverified';

const TRUST: Record<Provenance, number> = {
  human_review: 1.0,   // a person explicitly approved/rejected — strongest signal
  merge: 0.8,          // a PR merged (implicit approval)
  auto_revert: 0.6,    // Hush's own regression watch reverted it
  unverified: 0.2,     // captured/inferred, not confirmed by a trusted actor
};

/** Default half-life: an outcome's recency weight halves every 90 days. */
const DEFAULT_HALF_LIFE_DAYS = 90;

export interface IntegrityRecord {
  /** +1 for a confirming/positive outcome (merged), -1 for negative (rejected). */
  sign: 1 | -1;
  provenance: Provenance;
  at: string;          // ISO8601
  source: string;      // actor/workspace member or webhook id — for dominance checks
}

/** Trust weight in [0,1] for a provenance class. */
export function trustWeight(p: Provenance): number {
  return TRUST[p] ?? 0;
}

/** Exponential recency decay in (0,1]; 1 at now, 0.5 at one half-life. */
export function recencyWeight(at: string, nowMs: number, halfLifeDays = DEFAULT_HALF_LIFE_DAYS): number {
  const ageMs = Math.max(0, nowMs - Date.parse(at));
  const ageDays = ageMs / 86_400_000;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/** Combined influence of one record: trust × recency, in [0,1]. */
export function effectiveWeight(r: IntegrityRecord, nowMs: number, halfLifeDays = DEFAULT_HALF_LIFE_DAYS): number {
  return trustWeight(r.provenance) * recencyWeight(r.at, nowMs, halfLifeDays);
}

export interface IntegritySignal {
  /** Net weighted signal in [-1, 1]; positive = pattern trusted, negative = pattern suspect. */
  net: number;
  /** Total effective weight behind it — low = thin evidence, treat as inconclusive. */
  support: number;
  /** True when the signal rests on enough independent, trusted weight to act on. */
  confident: boolean;
}

/**
 * Aggregate records into a net signal with outlier resistance:
 *   - each record contributes sign × effectiveWeight,
 *   - a single low-trust record can't dominate (capped by its weight),
 *   - a *strong* negative requires corroboration: one unverified reject alone
 *     stays inconclusive; two trusted, agreeing records make it confident.
 */
export function integritySignal(
  records: IntegrityRecord[],
  nowMs: number,
  opts?: { minSupport?: number; halfLifeDays?: number },
): IntegritySignal {
  const minSupport = opts?.minSupport ?? 1.0;
  const hl = opts?.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;

  let weighted = 0;
  let support = 0;
  for (const r of records) {
    const w = effectiveWeight(r, nowMs, hl);
    weighted += r.sign * w;
    support += w;
  }
  const net = support === 0 ? 0 : weighted / support; // normalized to [-1,1]

  // Corroboration: need at least minSupport of trusted weight AND more than one
  // contributing record before a signal is "confident" enough to move a pattern.
  const contributing = records.filter((r) => effectiveWeight(r, nowMs, hl) > 0.05).length;
  const confident = support >= minSupport && contributing >= 2;

  return { net: round3(net), support: round3(support), confident };
}

/**
 * Source-dominance guard (anti-poisoning): flag when a single source produced
 * more than `maxShare` of the (recency-weighted) recent outcome volume — an actor
 * or webhook moving the corpus too fast deserves review/rate-limiting.
 */
export function sourceDominance(
  records: IntegrityRecord[],
  nowMs: number,
  opts?: { maxShare?: number; halfLifeDays?: number },
): { dominated: boolean; topSource: string | null; share: number } {
  const maxShare = opts?.maxShare ?? 0.5;
  const hl = opts?.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;

  const bySource = new Map<string, number>();
  let total = 0;
  for (const r of records) {
    const w = recencyWeight(r.at, nowMs, hl); // volume weight ignores provenance
    bySource.set(r.source, (bySource.get(r.source) ?? 0) + w);
    total += w;
  }
  if (total === 0) return { dominated: false, topSource: null, share: 0 };

  let topSource: string | null = null;
  let topW = 0;
  for (const [s, w] of bySource) if (w > topW) { topW = w; topSource = s; }
  const share = topW / total;
  return { dominated: share > maxShare && bySource.size > 1, topSource, share: round3(share) };
}

function round3(n: number): number { return Math.round(n * 1000) / 1000; }
