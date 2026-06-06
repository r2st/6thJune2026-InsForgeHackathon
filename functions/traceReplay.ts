// functions/traceReplay.ts
//
// Trace-only fallback (ticket 0012). When the branch-project pool is empty or a
// fork spin-up errors/times out, we can't run the real parallel replay (0008).
// Instead of stalling the loop, we evaluate the candidate RLS predicate
// *in-process* against the seeded demo rows and the captured claims, and return
// a Verdict tagged mode:'trace'.
//
// Honesty over polish: this proves the *policy* fix, not the running system. A
// trace verdict is explicitly weaker than a fork verdict — the orchestrator
// caps its dispatch tier at draft_pr (never opens a real PR), and the receipt
// page renders a distinct cool badge ("verified via trace · branch unavailable")
// so it can never masquerade as the real thing. See
// docs/decisions/0001-test-on-a-fork.md.
//
// Scope: the v1 diff family is a single RLS predicate that is a disjunction of
// `tenant_id`-scoping comparisons. We evaluate that family exactly; anything
// outside it yields an unfalsifiable verdict (bugConfirmed=false) rather than a
// guess — same deny-by-default stance as safety.ts.

import type { ReplayPayload, TomlPatch, Verdict, ReplaySide } from './types.js';
import { decodeJwtBody } from './lib/jwt.js';

export interface SeedRow {
  tenant_id: string;
  [col: string]: unknown;
}

export interface TraceInput {
  payload: ReplayPayload;
  patch: TomlPatch;
  /** Rows the policy filters over. Defaults to the two-tenants demo seed. */
  seedRows?: SeedRow[];
}

/** The orders rows from infra/seed/two-tenants.sql: 3 for Acme, 0 for Globex. */
const DEMO_SEED: SeedRow[] = [
  { tenant_id: '11111111-1111-1111-1111-111111111111' },
  { tenant_id: '11111111-1111-1111-1111-111111111111' },
  { tenant_id: '11111111-1111-1111-1111-111111111111' },
];

export function traceReplay(input: TraceInput): Verdict {
  const { payload, patch } = input;
  const seed = input.seedRows ?? DEMO_SEED;
  const claims = decodeJwtBody(payload.jwt);
  const expected = payload.expectedRows;

  const prodRows = evalPredicate(patch.before, seed, claims);
  const forkRows = evalPredicate(patch.after, seed, claims);

  const bugConfirmed = prodRows < expected && forkRows >= expected;
  const fixVerified = forkRows >= expected;

  return {
    prod: side(prodRows, `trace: prod predicate matched ${prodRows}/${seed.length} rows`),
    fork: side(forkRows, `trace: candidate predicate matched ${forkRows}/${seed.length} rows`),
    bugConfirmed,
    fixVerified,
    rationale: bugConfirmed && fixVerified
      ? `trace-only: prod policy returns ${prodRows}/${expected}, candidate returns ${forkRows} — fix verified against seed, NOT a live fork`
      : `trace-only: prod ${prodRows}/${expected}, candidate ${forkRows} — inconclusive without a fork`,
    mode: 'trace',
  };
}

// ── predicate evaluation ───────────────────────────────────────────────────────

/** Count rows the predicate admits for the given claims. */
function evalPredicate(predicate: string, rows: SeedRow[], claims: Record<string, unknown>): number {
  const branches = splitOr(predicate);
  return rows.filter((row) => branches.some((b) => branchMatches(b, row, claims))).length;
}

/**
 * Evaluate one OR-branch of the v1 predicate family:
 *   <col> = (auth.jwt() ->> '<key>')::uuid            scalar equality
 *   <col> = ANY((auth.jwt() -> '<key>')::uuid[])      array membership
 * A branch we don't recognise admits nothing — we never widen on a guess.
 */
function branchMatches(branch: string, row: SeedRow, claims: Record<string, unknown>): boolean {
  const col = /^\s*(\w+)\s*=/.exec(branch)?.[1];
  const key = /->>?\s*'([^']+)'/.exec(branch)?.[1];
  if (!col || !key) return false;
  const cell = row[col];
  const claim = claims[key];

  if (/\bANY\s*\(/i.test(branch)) {
    return Array.isArray(claim) && claim.some((v) => String(v) === String(cell));
  }
  return claim != null && String(claim) === String(cell);
}

/** Split on top-level OR (the v1 family is flat — no parenthesised sub-disjunctions). */
function splitOr(predicate: string): string[] {
  return predicate.split(/\bOR\b/i).map((s) => s.trim()).filter(Boolean);
}

function side(rows: number, snippet: string): ReplaySide {
  return { status: 200, rowsReturned: rows, latencyMs: 0, snippet };
}
