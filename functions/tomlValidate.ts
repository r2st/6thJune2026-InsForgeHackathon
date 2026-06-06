// functions/tomlValidate.ts
//
// Deterministic post-LLM STRUCTURAL validator. safety.ts is a *widening* rail
// (conjunct counts, scoping columns); this is the *well-formed* rail: does the
// proposed predicate reference real columns, cast them compatibly, call only
// whitelisted functions, and avoid widening through a sub-select? None of those
// failures necessarily widen access — they just break the run at apply-time.
// Catching them here, pre-apply, is the discipline judges notice.
//
// Ticket: agents/tasks/0032-toml-ast-validation.md
// Defends: Lie #02 deeper (docs/the-hardest-part-deeper.md).
//
// Not a SQL parser — a hand-written identifier/function/cast tokenizer for the
// v1 predicate family. Composes with safety.ts: either rail rejecting → issue.

import type { TomlPatch, ValidationResult, TableSchema } from './types.js';

export interface ValidateInput {
  patch: TomlPatch;
  /** The TOML slice the patch targets (toml.extractTomlContext output). */
  tomlContext: string;
  tableSchema: TableSchema;
}

/** Functions the predicate may call. Anything else → reject. */
const FN_WHITELIST = new Set(['auth.uid', 'auth.jwt', 'current_setting', 'coalesce', 'any']);

const KEYWORDS = new Set([
  'or', 'and', 'not', 'in', 'exists', 'select', 'from', 'where', 'any', 'is',
  'null', 'true', 'false', 'as',
]);
const TYPES = new Set([
  'uuid', 'int', 'int4', 'int8', 'integer', 'bigint', 'smallint', 'text',
  'varchar', 'numeric', 'decimal', 'boolean', 'bool', 'timestamptz',
  'timestamp', 'date', 'jsonb', 'json',
]);

/** Cast-compatibility classes. A column may only cast within its own class. */
function typeClass(t: string): string {
  const base = t.replace(/\[\]$/, '');
  if (base === 'uuid') return 'uuid';
  if (['int', 'int4', 'int8', 'integer', 'bigint', 'smallint', 'numeric', 'decimal'].includes(base)) return 'number';
  if (['text', 'varchar'].includes(base)) return 'text';
  if (['boolean', 'bool'].includes(base)) return 'bool';
  if (['timestamptz', 'timestamp', 'date'].includes(base)) return 'time';
  if (['jsonb', 'json'].includes(base)) return 'json';
  return base;
}

export function validateTomlPatch(input: ValidateInput): ValidationResult {
  const { patch, tomlContext, tableSchema } = input;
  const reasons: string[] = [];
  const colNames = new Set(tableSchema.columns.map((c) => c.name));
  const colType = new Map(tableSchema.columns.map((c) => [c.name, c.type] as const));
  const scopingCols = tableSchema.columns.map((c) => c.name).filter((n) => /tenant/i.test(n));

  // 1. Path must resolve to an existing key in the TOML context.
  if (!pathResolves(patch.path, tomlContext)) {
    reasons.push(`path "${patch.path}" does not resolve to an existing key — would create a new key; escalate`);
  }

  const after = patch.after;

  // 2. Function calls — every called name must be whitelisted.
  for (const fn of functionCalls(after)) {
    if (!FN_WHITELIST.has(fn.toLowerCase())) {
      reasons.push(`unknown function "${fn}()" — not in whitelist`);
    }
  }

  // 3. Sub-select widening — an IN (SELECT…)/EXISTS(…) inner query must itself
  //    reference a scoping column, else it widens through indirection.
  for (const sub of subSelects(after)) {
    const scoped = scopingCols.some((c) => new RegExp(`\\b${escapeRe(c)}\\b`).test(sub));
    if (!scoped) {
      reasons.push(`sub-select does not reference a scoping column [${scopingCols.join(', ')}]: "${sub.trim()}"`);
    }
  }

  // 4. Casts — a column cast to an incompatible type class is rejected.
  for (const { col, type } of columnCasts(after)) {
    const declared = colType.get(col);
    if (declared && typeClass(declared) !== typeClass(type)) {
      reasons.push(`cast "${col}::${type}" incompatible with declared type ${declared}`);
    }
  }

  // 5. Column identifiers (top-level, outside sub-selects) must exist in the table.
  for (const id of topLevelIdentifiers(after)) {
    if (!colNames.has(id)) {
      reasons.push(`identifier "${id}" is not a column of ${tableSchema.table} [${[...colNames].join(', ')}]`);
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

// ── tokenizers ─────────────────────────────────────────────────────────────────

function pathResolves(path: string, tomlContext: string): boolean {
  const segs = path.split('.');
  const key = segs[segs.length - 1]!;
  const header = `[${segs.slice(0, -1).join('.')}]`;
  if (!tomlContext.includes(header)) return false;
  // The key must appear as an assignment somewhere after the header.
  const afterHeader = tomlContext.slice(tomlContext.indexOf(header));
  return new RegExp(`(^|\\n)\\s*${escapeRe(key)}\\s*=`).test(afterHeader);
}

/** Names immediately followed by `(` — both simple (`coalesce`) and dotted (`auth.jwt`). */
function functionCalls(s: string): string[] {
  const stripped = stripStrings(s);
  return [...stripped.matchAll(/([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)\s*\(/gi)].map((m) => m[1]!);
}

/** The inner text of each `IN (SELECT …)` / `EXISTS ( … )`. */
function subSelects(s: string): string[] {
  const out: string[] = [];
  const re = /\b(?:in|exists)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const open = s.indexOf('(', m.index);
    const inner = balancedSlice(s, open);
    if (inner !== null && /select/i.test(inner)) out.push(inner);
  }
  return out;
}

/** `<column>::<type>` casts applied directly to a bare identifier. */
function columnCasts(s: string): { col: string; type: string }[] {
  const stripped = stripStrings(s);
  return [...stripped.matchAll(/\b([a-z_][a-z0-9_]*)\s*::\s*([a-z0-9_]+(?:\[\])?)/gi)].map(
    (m) => ({ col: m[1]!, type: m[2]! }),
  );
}

/**
 * Bare identifiers in the top-level predicate (sub-selects removed): drop string
 * literals, cast types, function-call names, keywords and type names — whatever
 * remains is a column reference and must exist in the table.
 */
function topLevelIdentifiers(s: string): string[] {
  let work = removeSubSelects(s);
  work = stripStrings(work);
  work = work.replace(/::\s*[a-z0-9_]+(?:\[\])?/gi, ' ');          // cast types
  work = work.replace(/[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?\s*(?=\()/gi, ' '); // fn names
  const ids = [...work.matchAll(/[a-z_][a-z0-9_]*/gi)].map((m) => m[0]!.toLowerCase());
  return [...new Set(ids)].filter((id) => !KEYWORDS.has(id) && !TYPES.has(id));
}

// ── helpers ────────────────────────────────────────────────────────────────────

function removeSubSelects(s: string): string {
  let out = s;
  for (const sub of subSelects(s)) out = out.replace(`(${sub})`, ' ');
  return out;
}

function stripStrings(s: string): string {
  return s.replace(/'[^']*'/g, "''");
}

/** Content between `open` paren and its matching close (exclusive), or null. */
function balancedSlice(s: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0) return s.slice(open + 1, i);
    }
  }
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── convenience: derive a TableSchema from a TOML slice ─────────────────────────

/**
 * Parse `columns = ["<name> <type> …", …]` of a `[tables.<t>]` block into a
 * TableSchema. Lets callers (the orchestrator) build the schema straight from
 * the same TOML context they ground diagnose on.
 */
export function tableSchemaFromToml(tomlContext: string, table: string): TableSchema {
  const header = `[tables.${table}]`;
  const start = tomlContext.indexOf(header);
  const slice = start === -1 ? '' : tomlContext.slice(start);
  const m = /columns\s*=\s*\[([\s\S]*?)\]/.exec(slice);
  const columns = m
    ? [...m[1]!.matchAll(/"([a-z_][a-z0-9_]*)\s+([a-z0-9_]+(?:\([\d,]+\))?(?:\[\])?)/gi)].map((c) => ({
        name: c[1]!,
        type: c[2]!.replace(/\(.*\)$/, ''),
      }))
    : [];
  return { table, columns };
}
