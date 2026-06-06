// functions/fingerprint.ts
//
// Temporal anchor (ticket 0034). The two-signal verdict (prod fails AND fork
// passes) assumes both replays see the same world. They don't: the fork is a
// snapshot, prod is live. Between the two replays prod can drift — a new order
// lands, an admin import runs, a policy is edited in the dashboard — and then
// both checks happen to pass while comparing apples to oranges.
//
// We anchor every run to a pre-run snapshot and re-fingerprint at verdict time:
//   - schema fingerprint drift  → HARD: the run is inconclusive → issue.
//   - row-count drift > 0       → SOFT: warn; the LLM may still be right.
// The same fingerprint, computed against the fork after applyDiff, catches an
// apply that silently no-op'd (post-apply fingerprint == pre-apply fingerprint).
//
// Defends Lie #06/#07 (docs/the-hardest-part-deeper.md). Fingerprint is
// sha256(canonical columns + rls) — cheap, deterministic, no external deps.

import { createHash } from 'node:crypto';
import type { StateSnapshot, AnchorResult, TomlPatch } from './types.js';
import { applyPatch } from './tomlPatch.js';

/** sha256 over the table's sorted column list + its rls predicate. Pure. */
export function fingerprintSchema(tomlSlice: string, table: string): string {
  const header = `[tables.${table}]`;
  const start = tomlSlice.indexOf(header);
  const block = start === -1 ? '' : tomlSlice.slice(start);
  const end = nextHeaderIndex(block);
  const body = end === -1 ? block : block.slice(0, end);

  const columns = [...body.matchAll(/"([^"]*)"/g)].map((m) => m[1]!.trim()).sort();
  const rls = /rls\s*=\s*"([^"]*)"/.exec(body)?.[1]?.trim() ?? '';

  const canonical = JSON.stringify({ table, columns, rls });
  return createHash('sha256').update(canonical).digest('hex');
}

export interface SnapshotInput {
  tenantId: string;
  table: string;
  /** Current prod TOML slice — schema fingerprint source. */
  toml: string;
  /** Tenant-scoped row count of `table` right now. Injected (a query). */
  prodRowCount: number;
  capturedAt: string;
}

export function snapshotState(input: SnapshotInput): StateSnapshot {
  return {
    tenantId: input.tenantId,
    table: input.table,
    prodRowCount: input.prodRowCount,
    prodSchemaFingerprint: fingerprintSchema(input.toml, input.table),
    capturedAt: input.capturedAt,
  };
}

/**
 * Verify prod hasn't drifted since the snapshot. Called after the suite returns
 * with the freshly re-queried prod row count + schema fingerprint.
 */
export function verifyAnchor(args: {
  snapshot: StateSnapshot;
  current: { prodRowCount: number; prodSchemaFingerprint: string };
}): AnchorResult {
  const { snapshot, current } = args;
  if (current.prodSchemaFingerprint !== snapshot.prodSchemaFingerprint) {
    return {
      match: false,
      severity: 'hard',
      drift: `prod schema changed mid-run (${snapshot.prodSchemaFingerprint.slice(0, 8)} → ${current.prodSchemaFingerprint.slice(0, 8)})`,
    };
  }
  if (current.prodRowCount !== snapshot.prodRowCount) {
    return {
      match: false,
      severity: 'soft',
      drift: `prod row count moved ${snapshot.prodRowCount} → ${current.prodRowCount} during the run`,
    };
  }
  return { match: true };
}

/**
 * The schema fingerprint the fork SHOULD have after the patch is applied — i.e.
 * fingerprint of the patched TOML. Compare to the fork's actual post-apply
 * fingerprint: a mismatch means the apply silently no-op'd (or applied
 * something else). Hard fail.
 */
export function expectedForkFingerprint(toml: string, patch: TomlPatch, table: string): string {
  const patched = applyPatch(toml, patch);
  const text = patched.ok ? patched.toml : toml;
  return fingerprintSchema(text, table);
}

export function verifyPostApply(args: {
  expected: string;
  actual: string | undefined;
}): AnchorResult {
  if (!args.actual) {
    return { match: false, severity: 'hard', drift: 'fork did not report a post-apply schema fingerprint' };
  }
  if (args.actual !== args.expected) {
    return {
      match: false,
      severity: 'hard',
      drift: `fork schema did not match the intended patch — apply may have no-op'd (${args.actual.slice(0, 8)} ≠ ${args.expected.slice(0, 8)})`,
    };
  }
  return { match: true };
}

// ── helpers ────────────────────────────────────────────────────────────────────

function nextHeaderIndex(block: string): number {
  // Index of the next top-level [header] line after the first line, or -1.
  const m = /\n\s*\[[^\]]+\]\s*(?:\n|$)/.exec(block);
  return m ? m.index : -1;
}
