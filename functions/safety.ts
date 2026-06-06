// functions/safety.ts
// Deterministic post-LLM check: does the proposed TomlPatch widen access?
//
// Ticket:   agents/tasks/0021-diff-safety-rail.md
// Defends:  "Lie #04" from docs/the-hardest-part.html.
//
// Scope:    RLS predicate edits only — the single diff shape Hush emits in v1.
//           Sub-select widening (e.g. `tenant_id IN (SELECT id FROM tenants)`)
//           and other structural failures are caught by ticket 0032 (TOML AST
//           validation). The two rails compose; either rejecting → drop to
//           issue. Deny-by-default: false positives are tolerated, false
//           negatives are not.

import type { TomlPatch, SafetyResult } from './types.js';

export interface SafetyInput {
  patch: TomlPatch;
  /** Columns of the targeted table — verifies scoping clauses reference real cols. */
  tableColumns: string[];
}

export function validateDiff(input: SafetyInput): SafetyResult {
  const { patch, tableColumns } = input;
  const reasons: string[] = [];

  const before = squashWs(patch.before);
  const after = squashWs(patch.after);

  // Rule 1 — top-level conjunct count
  const beforeAnds = splitTopLevel(before, 'AND');
  const afterAnds = splitTopLevel(after, 'AND');
  if (afterAnds.length < beforeAnds.length) {
    reasons.push(
      `after has ${afterAnds.length} top-level AND conjunct(s); before had ${beforeAnds.length}`,
    );
  }

  // Rule 2 — new top-level OR branch that doesn't reference any scoping column
  const beforeOrs = splitTopLevel(before, 'OR').map(canon);
  const afterOrs = splitTopLevel(after, 'OR');
  for (const branch of afterOrs) {
    if (beforeOrs.includes(canon(branch))) continue; // unchanged branch
    if (!referencesAnyColumn(branch, tableColumns)) {
      reasons.push(
        `new OR branch lacks any scoping column from [${tableColumns.join(', ')}]: "${branch}"`,
      );
    }
  }

  // Rule 3 — binding strength per scoping column became looser
  for (const col of tableColumns) {
    const b = bindingOf(col, before);
    const a = bindingOf(col, after);
    if (isLooser(b, a)) {
      reasons.push(`column "${col}" binding loosened: ${b} → ${a}`);
    }
  }

  return { widens: reasons.length > 0, reasons };
}

// ─── internals ──────────────────────────────────────────────────────────────

/**
 * How tightly a scoping column is constrained. The order matters: a binding
 * is "looser" if it lets more rows through.
 */
type Binding = 'equality' | 'membership' | 'unconstrained' | 'absent';

/**
 * Widening is asymmetric:
 *   equality   → equality/membership   OK (membership is "this user's set"
 *                                         and the demo fix relies on this).
 *   equality   → unconstrained|absent  WIDENING.
 *   membership → unconstrained|absent  WIDENING.
 *   unconstrained → anything           not widening (already unrestricted).
 *   absent → anything                  not widening (nothing was constrained).
 */
function isLooser(before: Binding, after: Binding): boolean {
  if (before === 'equality' && (after === 'unconstrained' || after === 'absent')) return true;
  if (before === 'membership' && (after === 'unconstrained' || after === 'absent')) return true;
  return false;
}

/**
 * Detect the strongest binding shape for `col` in `expr`. We pick the
 * tightest form present — equality wins over membership, because if both
 * appear (`col = X OR col IN (Y)`) the equality branch is the meaningful
 * floor. This keeps the demo fix from registering as "loosened."
 */
function bindingOf(col: string, expr: string): Binding {
  const w = `\\b${escapeRegex(col)}\\b`;
  if (!new RegExp(w, 'i').test(expr)) return 'absent';

  // Tightest first.
  if (new RegExp(`${w}\\s*=(?!\\s*ANY\\b)`, 'i').test(expr)) return 'equality';
  if (new RegExp(`${w}\\s*=\\s*ANY\\b`, 'i').test(expr)) return 'membership';
  if (new RegExp(`${w}\\s+IN\\b`, 'i').test(expr)) return 'membership';

  // Explicit unconstrained shapes.
  if (new RegExp(`${w}\\s+IS\\s+(NOT\\s+)?NULL`, 'i').test(expr)) return 'unconstrained';
  if (new RegExp(`${w}\\s+IS\\s+DISTINCT\\s+FROM\\s+NULL`, 'i').test(expr)) return 'unconstrained';

  // Present but in an unrecognised constraining shape (LIKE, >, <, etc.) —
  // conservatively classify as unconstrained so we err on the side of flagging.
  return 'unconstrained';
}

function referencesAnyColumn(expr: string, cols: string[]): boolean {
  return cols.some((c) => new RegExp(`\\b${escapeRegex(c)}\\b`, 'i').test(expr));
}

/**
 * Split a predicate by a top-level keyword (AND / OR), respecting
 * parenthesis depth and single-quoted string literals. Word-bounded match
 * so `OR` doesn't match inside `ORDER` or column names.
 */
function splitTopLevel(expr: string, keyword: string): string[] {
  const parts: string[] = [];
  const upper = keyword.toUpperCase();
  const kl = keyword.length;
  let depth = 0;
  let inString = false;
  let start = 0;
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (ch === "'") {
      // SQL doubled-single-quote escape inside strings.
      if (inString && expr[i + 1] === "'") {
        i += 2;
        continue;
      }
      inString = !inString;
      i++;
      continue;
    }
    if (inString) {
      i++;
      continue;
    }

    if (ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')') {
      depth--;
      i++;
      continue;
    }

    if (depth === 0 && i + kl <= expr.length) {
      if (expr.slice(i, i + kl).toUpperCase() === upper) {
        const left = i === 0 ? ' ' : expr[i - 1];
        const right = i + kl >= expr.length ? ' ' : expr[i + kl];
        if (!isWordChar(left) && !isWordChar(right)) {
          parts.push(expr.slice(start, i).trim());
          start = i + kl;
          i = start;
          continue;
        }
      }
    }

    i++;
  }

  const tail = expr.slice(start).trim();
  if (tail.length > 0) parts.push(tail);
  return parts.filter((s) => s.length > 0);
}

function isWordChar(c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9_]/.test(c);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function squashWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function canon(s: string): string {
  return squashWs(s).toLowerCase();
}
