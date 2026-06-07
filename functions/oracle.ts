// functions/oracle.ts
// The expectation oracle — is an empty/wrong result a *bug*, or correct?
//
// Ticket:  agents/tasks/0078-expectation-oracle.md
// Defends: ADR 0003 Risk 1 (the existential one). A user with no orders, an empty
//          cart, zero notifications all return `200 OK` + 0 rows — identical to
//          the bug. Without a precise "what should have happened" judgment,
//          detection precision collapses into a false-positive firehose.
//
// Pure, testable core: combine several oracle signals into an is-likely-bug
// verdict + an expected-row estimate, with abstain-by-default (precision before
// recall). The strongest, uniquely-cheap-on-InsForge signal is the POLICY
// COUNTERFACTUAL: relax the RLS predicate on the fork and re-run the query — if
// rows appear that the live policy filtered, the data exists and the policy hid
// it. That's near-definitive proof of a bug, not a guess.

export interface OracleSignals {
  /**
   * The sharp signal. `current` = rows the failing request returned (typically
   * 0); `relaxed` = rows the SAME query returns on the fork with the RLS
   * predicate relaxed. relaxed > current ⇒ the data exists and the policy hid it.
   */
  counterfactual?: { current: number; relaxed: number };
  /** Did this user/route return rows before and just drop to 0? null = unknown. */
  baseline?: { previousRows: number | null };
  /**
   * Population context: the route's normal empty-result rate vs. what we're now
   * seeing. A spike on a normally-non-empty route is bug-shaped.
   */
  population?: { normalEmptyRate: number; observedEmptyRate: number };
  /** The user behaved as if they expected data (rage-click on a list, etc.). */
  frustrationCorroborated?: boolean;
}

export interface ExpectationVerdict {
  isLikelyBug: boolean;
  confidence: number;     // 0..100 — precision-oriented
  expectedRows: number;   // best estimate of what the user should have seen
  abstain: boolean;       // below threshold ⇒ don't flag (precision before recall)
  reasons: string[];
}

/** Below this confidence we abstain — a missed bug beats a false alarm. */
const ABSTAIN_THRESHOLD = 60;

export function assessExpectation(signals: OracleSignals): ExpectationVerdict {
  const reasons: string[] = [];
  let confidence = 0;
  let expectedRows = 0;

  // 1. Policy counterfactual — near-definitive when present.
  const cf = signals.counterfactual;
  if (cf) {
    if (cf.relaxed > cf.current) {
      confidence = Math.max(confidence, 92);
      expectedRows = Math.max(expectedRows, cf.relaxed);
      reasons.push(`policy counterfactual: ${cf.current} rows live vs ${cf.relaxed} with the predicate relaxed — the data exists, the policy hid it`);
    } else {
      // Relaxing the policy changed nothing → the rows genuinely aren't there.
      // Strong evidence this is NOT a bug.
      reasons.push('policy counterfactual: relaxing the predicate returns no extra rows — likely correct-empty');
      return { isLikelyBug: false, confidence: 90, expectedRows: 0, abstain: false, reasons };
    }
  }

  // 2. Historical baseline — the user used to get rows here.
  const bl = signals.baseline;
  if (bl?.previousRows != null && bl.previousRows > 0) {
    confidence = Math.max(confidence, 75);
    expectedRows = Math.max(expectedRows, bl.previousRows);
    reasons.push(`historical baseline: this user previously saw ${bl.previousRows} rows here, now 0`);
  }

  // 3. Population spike — corroborating, not sufficient alone.
  const pop = signals.population;
  if (pop && pop.observedEmptyRate > pop.normalEmptyRate + 0.2 && pop.normalEmptyRate < 0.5) {
    confidence = Math.min(100, confidence + 20);
    reasons.push(`population: empty-rate ${pct(pop.observedEmptyRate)} vs normal ${pct(pop.normalEmptyRate)} on a usually-populated route`);
  }

  // 4. Frustration corroboration — weak, only adds when other evidence exists.
  if (signals.frustrationCorroborated && confidence > 0) {
    confidence = Math.min(100, confidence + 8);
    reasons.push('frustration corroborates: the user behaved as if data was expected');
  }

  if (confidence === 0) reasons.push('no oracle evidence that rows were expected');

  const abstain = confidence < ABSTAIN_THRESHOLD;
  return {
    isLikelyBug: !abstain && confidence >= ABSTAIN_THRESHOLD,
    confidence: clamp(confidence),
    expectedRows,
    abstain,
    reasons,
  };
}

function pct(x: number): string { return `${Math.round(x * 100)}%`; }
function clamp(n: number, lo = 0, hi = 100): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
