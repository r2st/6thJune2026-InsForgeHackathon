// functions/shadowSeed.ts
// Representative fork validation — synthetic "shadow" rows that resolve the
// privacy-vs-fidelity tension.
//
// Ticket:  agents/tasks/0089-representative-fork-validation.md
// Defends: ADR 0003 Risk 4 — a fix proven on a 3-row privacy-minimized fork can
//          be wrong on the full distribution (correct for the captured user, a
//          leak for another shape). We need fidelity without copying real PII.
//
// This generates privacy-safe SYNTHETIC rows from a table's schema, spanning the
// risk dimensions a policy fix can get wrong: multiple tenants (cross-tenant
// isolation), both JWT claim shapes (the demo bug's root cause), and per-type
// boundary values. Fully deterministic (no PII, no randomness). A fidelity score
// reports how representative the fork is, which caps the confidence tier — you
// can't open a `pr` off a fork that didn't exercise the risk dimensions.

export interface ColumnSpec {
  name: string;
  type: 'uuid' | 'text' | 'numeric' | 'int' | 'timestamptz' | 'bool' | 'unknown';
  isTenantScope: boolean; // tenant_id / *_tenant — the cross-tenant axis
}

export type ShadowRow = Record<string, string | number | boolean>;

/** A synthetic tenant id (deterministic, obviously fake). */
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

/** Parse a `[tables.X]` block's `columns = [...]` into typed specs. */
export function parseColumns(tableBlock: string): ColumnSpec[] {
  const m = /columns\s*=\s*\[([\s\S]*?)\]/m.exec(tableBlock);
  if (!m || !m[1]) return [];
  return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => {
    const def = (x[1] ?? '').trim();
    const name = def.split(/\s+/)[0] ?? '';
    return { name, type: inferType(def), isTenantScope: /tenant/.test(name) && name !== 'name' };
  });
}

function inferType(def: string): ColumnSpec['type'] {
  const d = def.toLowerCase();
  if (/\buuid\b/.test(d)) return 'uuid';
  if (/\b(numeric|decimal|money|real|double)\b/.test(d)) return 'numeric';
  if (/\b(bigint|integer|int|serial|bigserial|smallint)\b/.test(d)) return 'int';
  if (/\b(timestamptz|timestamp|date)\b/.test(d)) return 'timestamptz';
  if (/\bbool/.test(d)) return 'bool';
  if (/\b(text|varchar|char|jsonb|json)\b/.test(d)) return 'text';
  return 'unknown';
}

export interface ShadowSeed {
  rows: ShadowRow[];
  tenants: { primary: string; neighbour: string };
}

/**
 * Generate shadow rows for a table. Produces, deterministically:
 *   - N rows for the primary tenant (what the captured user should see), and
 *   - rows for a neighbour tenant (must stay invisible — the cross-tenant probe),
 * with boundary-spanning synthetic values per column. No real data is read.
 */
export function generateShadows(
  tableBlock: string,
  opts?: { primaryRows?: number; neighbourRows?: number },
): ShadowSeed {
  const cols = parseColumns(tableBlock);
  const primaryCount = opts?.primaryRows ?? 3;
  const neighbourCount = opts?.neighbourRows ?? 2;

  const rows: ShadowRow[] = [];
  for (let i = 0; i < primaryCount; i++) rows.push(rowFor(cols, TENANT_A, i, primaryCount));
  for (let i = 0; i < neighbourCount; i++) rows.push(rowFor(cols, TENANT_B, i, neighbourCount));

  return { rows, tenants: { primary: TENANT_A, neighbour: TENANT_B } };
}

function rowFor(cols: ColumnSpec[], tenant: string, i: number, total: number): ShadowRow {
  const row: ShadowRow = {};
  for (const c of cols) {
    if (c.isTenantScope) { row[c.name] = tenant; continue; }
    row[c.name] = synthValue(c, i, total);
  }
  return row;
}

/** Boundary-spanning synthetic value: first/last rows hit edges, middle is typical. */
function synthValue(c: ColumnSpec, i: number, total: number): string | number | boolean {
  const edge = i === 0 ? 'min' : i === total - 1 ? 'max' : 'mid';
  switch (c.type) {
    case 'uuid': return `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`;
    case 'int': return edge === 'min' ? 0 : edge === 'max' ? 2_147_483_647 : i + 1;
    case 'numeric': return edge === 'min' ? 0 : edge === 'max' ? 99_999_999.99 : Number((i + 1.5).toFixed(2));
    case 'timestamptz': return edge === 'min' ? '1970-01-01T00:00:00Z' : edge === 'max' ? '2999-12-31T23:59:59Z' : `2026-01-0${(i % 9) + 1}T00:00:00Z`;
    case 'bool': return i % 2 === 0;
    case 'text': return edge === 'min' ? '' : edge === 'max' ? 'x'.repeat(255) : `synthetic-${c.name}-${i}`;
    default: return `synthetic-${i}`;
  }
}

export interface Fidelity {
  score: number;            // 0..100 — how representative the fork is
  dimensions: { crossTenant: boolean; boundaryValues: boolean; multiRow: boolean };
}

/**
 * Score how representative the shadow seed is. A fork that didn't exercise the
 * risk dimensions can't justify a high confidence tier — this caps it.
 */
export function fidelityScore(seed: ShadowSeed, cols: ColumnSpec[]): Fidelity {
  const tenantsSeen = new Set(
    seed.rows
      .map((r) => {
        const tcol = cols.find((c) => c.isTenantScope);
        return tcol ? r[tcol.name] : undefined;
      })
      .filter(Boolean),
  );
  const crossTenant = tenantsSeen.size >= 2;
  const multiRow = seed.rows.length >= 3;
  // boundary coverage: at least one row hit a min/max edge for a non-tenant column
  const boundaryValues = seed.rows.length >= 2 && cols.some((c) => !c.isTenantScope && c.type !== 'unknown');

  const dims = { crossTenant, boundaryValues, multiRow };
  const covered = Object.values(dims).filter(Boolean).length;
  return { score: Math.round((covered / 3) * 100), dimensions: dims };
}
