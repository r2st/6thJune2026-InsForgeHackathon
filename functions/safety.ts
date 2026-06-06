// functions/safety.ts
// Deterministic post-LLM check: does the proposed TomlPatch widen access?
//
// Ticket: agents/inbox/0021-diff-safety-rail.md
// Rule:   "Lie #04" defense from docs/the-hardest-part.html.

import type { TomlPatch, SafetyResult } from './types.js';

export interface SafetyInput {
  patch: TomlPatch;
  /** Columns of the targeted table — used to verify scoping clauses reference real cols. */
  tableColumns: string[];
}

export function validateDiff(_input: SafetyInput): SafetyResult {
  // TODO(0021):
  //  Widens IFF any of:
  //    - The `after` predicate has fewer top-level conjuncts than `before`.
  //    - A new top-level OR branch lacks any scoping column from tableColumns.
  //    - An equality against a scoping column is replaced with a broader
  //      predicate (IS NOT NULL, true, etc.) that does not constrain the column.
  //
  // The demo bug fix (= tenant → = tenant OR = ANY(tenant_ids)) must return
  // widens: false — the new branch still references tenant_id.
  throw new Error('not implemented');
}
