// functions/calibration.ts
// Confidence calibration — make Hush's "90%" actually mean ~90% merged.
//
// Ticket:  agents/tasks/0091-confidence-calibration.md
// Defends: ADR 0003 Risk 6 — an *uncalibrated* confidence number manufactures
//          false trust. Tier routing and any autonomy (0070) are only safe if the
//          score maps to reality.
//
// Pure, testable core: given past (predicted confidence → actual outcome) pairs,
// build a reliability report (predicted vs. observed merge rate per bin, Brier
// score, expected calibration error), a monotonic recalibration map, and an
// autonomy gate. The "log outcomes / apply to score.ts" wiring is the seam; this
// is the statistics it depends on. Honest about small samples — never fakes a
// calibration it doesn't have the data for.

/** One historical run: what Hush predicted vs. what actually happened. */
export interface CalibrationSample {
  predicted: number;     // 0..100 confidence Hush assigned
  /** Did the fix turn out correct? merged-and-not-reverted = true. */
  correct: boolean;
}

export interface ReliabilityBin {
  lo: number;            // bin lower bound (inclusive), 0..100
  hi: number;            // bin upper bound (exclusive, except the top bin)
  count: number;
  meanPredicted: number; // avg predicted confidence in the bin (0..100)
  observed: number;      // observed correct-rate in the bin (0..100)
}

export interface CalibrationReport {
  sampleSize: number;
  bins: ReliabilityBin[];
  /** Brier score (0 best, 1 worst) on the [0,1] scale. */
  brier: number;
  /** Expected Calibration Error: avg |predicted - observed|, count-weighted, 0..100. */
  ece: number;
  /** False with too few samples — don't trust a calibration you can't support. */
  reliable: boolean;
}

/** Minimum samples before we treat a calibration as meaningful. */
const MIN_SAMPLES = 30;
const DEFAULT_BINS = 10;

export function calibrationReport(samples: CalibrationSample[], binCount = DEFAULT_BINS): CalibrationReport {
  const n = samples.length;
  const width = 100 / binCount;
  const bins: ReliabilityBin[] = [];

  for (let i = 0; i < binCount; i++) {
    const lo = i * width;
    const hi = i === binCount - 1 ? 100.0001 : (i + 1) * width; // top bin includes 100
    const inBin = samples.filter((s) => clamp(s.predicted) >= lo && clamp(s.predicted) < hi);
    if (inBin.length === 0) continue;
    const meanPredicted = avg(inBin.map((s) => clamp(s.predicted)));
    const observed = (inBin.filter((s) => s.correct).length / inBin.length) * 100;
    bins.push({ lo, hi: Math.min(hi, 100), count: inBin.length, meanPredicted, observed });
  }

  const brier = n === 0 ? 0 : avg(samples.map((s) => (clamp(s.predicted) / 100 - (s.correct ? 1 : 0)) ** 2));
  const ece =
    n === 0 ? 0 : bins.reduce((acc, b) => acc + (b.count / n) * Math.abs(b.meanPredicted - b.observed), 0);

  return { sampleSize: n, bins, brier: round4(brier), ece: round2(ece), reliable: n >= MIN_SAMPLES };
}

/**
 * Recalibrate a raw confidence to the observed-correct-rate of its bin — a
 * monotonic (isotonic-style) map fitted to history. With too little data, the
 * raw score passes through unchanged (we don't invent a correction).
 */
export function recalibrate(raw: number, report: CalibrationReport): number {
  const r = clamp(raw);
  if (!report.reliable) return r;
  const bin = report.bins.find((b) => r >= b.lo && r < b.hi) ?? nearestBin(report.bins, r);
  if (!bin) return r;
  // Enforce monotonicity across bins so recalibration never inverts order.
  return clamp(monotoneObserved(report.bins, bin));
}

/**
 * Autonomy gate (0070): a workspace may enable auto-PR only when its high-tier
 * predictions are empirically high-merge. Requires enough samples AND that the
 * top bin's observed correctness clears the bar.
 */
export function meetsAutonomyBar(report: CalibrationReport, opts?: { minObserved?: number }): boolean {
  const minObserved = opts?.minObserved ?? 85;
  if (!report.reliable) return false;
  const top = report.bins.filter((b) => b.lo >= 85);
  if (top.length === 0) return false;
  const weighted = avg(top.flatMap((b) => Array<number>(b.count).fill(b.observed)));
  return weighted >= minObserved;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function monotoneObserved(bins: ReliabilityBin[], target: ReliabilityBin): number {
  // running max of observed up to and including the target bin (isotonic, increasing)
  let best = 0;
  for (const b of bins) {
    best = Math.max(best, b.observed);
    if (b === target) break;
  }
  return best;
}

function nearestBin(bins: ReliabilityBin[], v: number): ReliabilityBin | undefined {
  if (bins.length === 0) return undefined;
  return bins.reduce((a, b) => (Math.abs(b.meanPredicted - v) < Math.abs(a.meanPredicted - v) ? b : a));
}

function clamp(n: number, lo = 0, hi = 100): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}
function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }
