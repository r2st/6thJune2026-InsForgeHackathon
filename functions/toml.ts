// functions/toml.ts
// TOML context extractor — the schema-grounding step before diagnose().
//
// Ticket:  agents/tasks/0019-toml-context-extractor.md
// Feeds:   diagnose() (DiagnoseInput.tomlContext) and the 0008 column-existence
//          check. Output is raw TOML embedded verbatim in the prompt.
//
// Why grounding matters: if the model can't see that `orders` has columns
// (id, tenant_id, user_id, total, created_at) it will invent one, and the PR
// opens with a diff referencing a column that doesn't exist. That's the
// difference between "credible" and "confidently wrong" — docs/the-hardest-part.
//
// We do NOT parse TOML semantically. The demo schema is regular enough that a
// header-delimited block scan is correct and far less brittle than a parser we
// don't need. A real TOML AST is ticket 0032's job (validation), not ours.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/** Max bytes of context handed to the prompt. Over this, FK slices drop first. */
const MAX_CONTEXT_BYTES = 4096;

export interface ExtractInput {
  table: string;
  /**
   * The TOML to slice. When omitted, loaded from disk (HUSH_TOML_PATH or the
   * canonical infra/insforge.toml). Callers that already hold the *applied*
   * config — e.g. the orchestrator after an InsForge config export — should
   * pass it here so we ground against reality, not a possibly-stale git copy.
   */
  toml?: string;
}

/** Resolve the TOML source, then slice. The documented entry point. */
export function extractTomlContext(input: ExtractInput): string {
  const toml = input.toml ?? loadCanonicalToml();
  return sliceTomlContext(toml, input.table);
}

/**
 * Pure core: given the full TOML and a target table, return a verbatim slice
 * with the table block, any auth policies its RLS references, and a minimal
 * (id + tenant-scoping) slice of each FK-referenced table. Capped at 4kb.
 */
export function sliceTomlContext(toml: string, table: string): string {
  const blocks = splitBlocks(toml);

  const targetHeader = `[tables.${table}]`;
  const target = blocks.get(targetHeader);
  if (!target) {
    throw new Error(`table not found in TOML: ${table}`);
  }

  const parts: string[] = [target.trimEnd()];

  // Auth policies referenced by this table's RLS predicate (if any exist).
  const rls = rlsLine(target);
  for (const [header, body] of blocks) {
    if (!header.startsWith('[auth.policies.')) continue;
    const name = header.slice('[auth.policies.'.length, -1);
    if (rls.includes(name)) parts.push(body.trimEnd());
  }

  // FK-referenced tables — minimal slice (id + any tenant-scoping columns).
  const fkSlices: string[] = [];
  for (const fk of referencedTables(target)) {
    if (fk === table) continue;
    const fkBlock = blocks.get(`[tables.${fk}]`);
    if (!fkBlock) continue;
    fkSlices.push(minimalTableSlice(fk, fkBlock));
  }

  return assembleWithinBudget(parts, fkSlices);
}

// ── block scanning ────────────────────────────────────────────────────────────

/**
 * Split TOML into header → block-body. A block runs from its `[header]` line
 * to (but not including) the next top-level `[header]` line, comments and blank
 * lines included. Good enough for the demo schema; not a general TOML parser.
 */
function splitBlocks(toml: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const lines = toml.split('\n');
  let header: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (header) blocks.set(header, buf.join('\n'));
    buf = [];
  };

  for (const line of lines) {
    const m = /^\s*(\[[^\]]+\])\s*$/.exec(line);
    if (m && m[1]) {
      flush();
      header = m[1];
      buf = [line];
    } else if (header) {
      buf.push(line);
    }
  }
  flush();
  return blocks;
}

/** The `rls = "..."` value of a block, or '' if none. */
function rlsLine(block: string): string {
  const m = /^\s*rls\s*=\s*"([^"]*)"/m.exec(block);
  return m?.[1] ?? '';
}

/** Table names referenced via `references <table>(...)` in column definitions. */
function referencedTables(block: string): string[] {
  const out = new Set<string>();
  const re = /references\s+(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    if (m[1]) out.add(m[1]);
  }
  return [...out];
}

/**
 * A minimal slice of an FK table: its header plus only the `id` column and any
 * column mentioning `tenant` (the scoping columns diagnose() needs to reason
 * about cross-tenant access). Keeps the context small and on-point.
 */
function minimalTableSlice(table: string, block: string): string {
  const cols = columnLines(block).filter((c) => {
    const name = c.replace(/^"/, '').trimStart().split(/\s+/)[0];
    return name === 'id' || c.includes('tenant');
  });
  const body = cols.length
    ? `columns = [\n${cols.map((c) => `  ${c.endsWith(',') ? c : c + ','}`).join('\n')}\n]`
    : 'columns = []';
  return `[tables.${table}]\n${body}`;
}

/** The quoted entries of a block's `columns = [ ... ]` array. */
function columnLines(block: string): string[] {
  const m = /columns\s*=\s*\[([\s\S]*?)\]/m.exec(block);
  if (!m || !m[1]) return [];
  return [...m[1].matchAll(/"[^"]*"/g)].map((x) => x[0]);
}

// ── budgeting + source loading ───────────────────────────────────────────────

/** Join target + FK slices, dropping FK slices (last-first) to fit the budget. */
function assembleWithinBudget(parts: string[], fkSlices: string[]): string {
  const sep = '\n\n';
  const fks = [...fkSlices];
  while (true) {
    const all = [...parts, ...fks];
    const text = all.join(sep);
    if (Buffer.byteLength(text, 'utf8') <= MAX_CONTEXT_BYTES || fks.length === 0) {
      return text;
    }
    fks.pop(); // drop the least-critical FK slice and retry
  }
}

function loadCanonicalToml(): string {
  const fromEnv = process.env.HUSH_TOML_PATH;
  const here = dirname(fileURLToPath(import.meta.url));
  const path = fromEnv ?? resolve(here, '..', 'infra', 'insforge.toml');
  return readFileSync(path, 'utf8');
}
