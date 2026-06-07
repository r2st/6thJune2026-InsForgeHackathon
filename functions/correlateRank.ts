// functions/correlateRank.ts
// Robust correlation — pick the ONE failing request that caused the frustration,
// among a session's many requests, with a confidence and an abstain path.
//
// Ticket:  agents/tasks/0079-robust-correlation.md
// Defends: ADR 0003 Risk 2 — a real session fires dozens of requests, several
//          legitimately empty. "Pick the latest empty one" mis-correlates, and a
//          wrong correlation → confidently wrong diagnosis. Rank on evidence, and
//          abstain when it's ambiguous rather than guess.
//
// Pure + testable: scores each candidate failing request on (a) RLS evidence that
// a policy hid existing rows — the bug signature, (b) temporal proximity to the
// frustration, (c) the route the user was actually looking at, and (d) the
// failure shape. Returns a ranked list, a correlation confidence, and an abstain
// flag when no clear winner emerges.

import type { RequestLogEntry } from './types.js';

export interface CorrelationContext {
  /** ISO8601 of the frustration signal (rage-click). */
  frustrationAt: string | null;
  /** The route/page the user was looking at when they got frustrated (from capture). */
  frustrationRoute?: string;
}

export interface RankedCandidate {
  entry: RequestLogEntry;
  score: number;          // 0..100
  reasons: string[];
}

export interface CorrelationRanking {
  best: RequestLogEntry | null;
  confidence: number;     // 0..100 — how sure we are this is THE failing request
  ranked: RankedCandidate[];
  abstain: boolean;       // true → don't guess; drop or low-tier issue
}

/** A candidate is a request that plausibly failed: empty result or a client error. */
function isCandidate(e: RequestLogEntry): boolean {
  return (e.returnedRows ?? -1) === 0 || (e.status >= 400 && e.status < 500);
}

/** The bug signature: a policy filtered existing rows down to zero. */
function hidExistingRows(e: RequestLogEntry): boolean {
  return (e.rlsDecisions ?? []).some((d) => d.rowsBefore > 0 && d.rowsAfter === 0);
}

const ABSTAIN_MIN_SCORE = 45;   // top candidate must clear this to act
const ABSTAIN_MIN_MARGIN = 15;  // and beat the runner-up by this, when there is one

/**
 * Rank the failing requests in a session window. Highest-evidence first.
 * Window order doesn't matter (we sort). Abstains when the top pick isn't a
 * clear, well-evidenced winner.
 */
export function rankFailingRequests(
  window: RequestLogEntry[],
  ctx: CorrelationContext,
): CorrelationRanking {
  const candidates = window.filter(isCandidate);
  if (candidates.length === 0) {
    return { best: null, confidence: 0, ranked: [], abstain: true };
  }

  const ranked = candidates
    .map((entry) => scoreCandidate(entry, ctx))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0]!;
  const second = ranked[1];
  const margin = second ? top.score - second.score : 100;

  // Confidence rises with the top score and the margin over the runner-up.
  const confidence = clamp(Math.round(0.7 * top.score + 0.3 * Math.min(100, margin)));
  const abstain = top.score < ABSTAIN_MIN_SCORE || (second != null && margin < ABSTAIN_MIN_MARGIN);

  return { best: abstain ? null : top.entry, confidence, ranked, abstain };
}

function scoreCandidate(entry: RequestLogEntry, ctx: CorrelationContext): RankedCandidate {
  let score = 0;
  const reasons: string[] = [];

  // (a) RLS evidence — the strongest signal: a policy hid rows that existed.
  if (hidExistingRows(entry)) {
    score += 55;
    reasons.push('rls policy dropped existing rows to 0 (bug signature)');
  } else if ((entry.returnedRows ?? -1) === 0) {
    score += 15; // empty, but no evidence the rows existed — could be correct-empty
    reasons.push('empty result (no evidence rows existed)');
  }

  // (b) temporal proximity to the frustration.
  const prox = proximity(entry.ts, ctx.frustrationAt);
  score += Math.round(prox * 25);
  if (prox > 0.5) reasons.push('close in time to the frustration signal');

  // (c) the route the user was actually looking at.
  if (ctx.frustrationRoute && sameRoute(entry.route, ctx.frustrationRoute)) {
    score += 15;
    reasons.push('matches the route the user was viewing');
  }

  // (d) an explicit client error is weak positive evidence of a real failure.
  if (entry.status >= 400 && entry.status < 500) {
    score += 5;
    reasons.push(`client error ${entry.status}`);
  }

  return { entry, score: clamp(score), reasons };
}

/** 1.0 at the frustration moment, decaying over ~30s; neutral 0.5 if unknown. */
function proximity(ts: string, frustrationAt: string | null): number {
  if (!frustrationAt) return 0.5;
  const dt = Math.abs(Date.parse(ts) - Date.parse(frustrationAt)) / 1000;
  return 1 / (1 + dt / 30);
}

function sameRoute(a: string, b: string): boolean {
  const norm = (s: string) => s.split('?')[0]!.replace(/\/+$/, '');
  return norm(a) === norm(b);
}

function clamp(n: number, lo = 0, hi = 100): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
