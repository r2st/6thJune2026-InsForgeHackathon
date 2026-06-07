// functions/tomlDrift.ts
// Detect drift between the *applied* InsForge config and the repo's insforge.toml.
//
// Ticket:  agents/tasks/0090-config-drift-reconciliation.md
// Defends: ADR 0003 Risk 5 — Hush patches the repo toml, but the live policy may
//          have been changed out-of-band (dashboard hotfix). A patch against a
//          stale baseline conflicts or doesn't match reality.
//
// This is the pure, testable core: given two insforge.toml strings (applied vs
// repo), report which table/policy blocks — and which fields (RLS predicate,
// columns) — diverge. The orchestrator grounds diagnose() on the *applied*
// config and flags any drift in the PR body. Loading the applied config from the
// InsForge API per backend connection (0051) is the integration seam; this
// module is the comparison logic it feeds.

/** One block (e.g. `[tables.orders]`) that differs between applied and repo. */
export interface DriftChange {
  block: string;                       // the TOML header, e.g. "[tables.orders]"
  kind: 'added' | 'removed' | 'changed';
  /** For 'changed': which fields diverged (rls / columns / other). */
  fields?: DriftField[];
}

export interface DriftField {
  field: 'rls' | 'columns' | 'block';
  applied: string | null;              // value live (applied), null if absent
  repo: string | null;                 // value in the repo toml, null if absent
}

export interface TomlDrift {
  drifted: boolean;
  changes: DriftChange[];
}

/**
 * Diff the applied config against the repo's insforge.toml.
 *   - a block live-only        → 'added'   (the repo is missing it)
 *   - a block repo-only        → 'removed' (live dropped it)
 *   - a block in both, differing on rls/columns → 'changed' (the dangerous one:
 *     a dashboard hotfix changed the policy the repo doesn't know about)
 *
 * `applied` is the source of truth for diagnosis; `repo` is what a naive patch
 * would target. Any 'changed' RLS drift means Hush must ground on `applied`.
 */
export function diffToml(applied: string, repo: string): TomlDrift {
  const a = splitBlocks(applied);
  const r = splitBlocks(repo);
  const changes: DriftChange[] = [];

  const headers = new Set<string>([...a.keys(), ...r.keys()]);
  for (const header of [...headers].sort()) {
    if (!isComparable(header)) continue; // only tables / auth policies matter here
    const ab = a.get(header);
    const rb = r.get(header);

    if (ab && !rb) {
      changes.push({ block: header, kind: 'added' });
      continue;
    }
    if (!ab && rb) {
      changes.push({ block: header, kind: 'removed' });
      continue;
    }
    if (ab && rb) {
      const fields = diffFields(ab, rb);
      if (fields.length > 0) changes.push({ block: header, kind: 'changed', fields });
    }
  }

  return { drifted: changes.length > 0, changes };
}

/** Field-level diff within a block we care about: RLS predicate and columns. */
function diffFields(applied: string, repo: string): DriftField[] {
  const out: DriftField[] = [];

  const aRls = rlsOf(applied);
  const rRls = rlsOf(repo);
  if (norm(aRls) !== norm(rRls)) {
    out.push({ field: 'rls', applied: aRls, repo: rRls });
  }

  const aCols = norm(columnsOf(applied).join('|'));
  const rCols = norm(columnsOf(repo).join('|'));
  if (aCols !== rCols) {
    out.push({
      field: 'columns',
      applied: columnsOf(applied).join(', ') || null,
      repo: columnsOf(repo).join(', ') || null,
    });
  }

  // Catch-all: bodies differ but not on a field we model individually.
  if (out.length === 0 && norm(applied) !== norm(repo)) {
    out.push({ field: 'block', applied: applied.trim(), repo: repo.trim() });
  }
  return out;
}

/** A human-readable one-line summary per change — for the PR body / receipt. */
export function summarizeDrift(drift: TomlDrift): string[] {
  return drift.changes.map((c) => {
    if (c.kind === 'added') return `${c.block}: present in live config, missing from repo`;
    if (c.kind === 'removed') return `${c.block}: in repo, removed from live config`;
    const f = (c.fields ?? []).map((x) => x.field).join(', ');
    return `${c.block}: live and repo differ (${f}) — patch will be grounded on live`;
  });
}

// ── block scanning (header-delimited; same shape as toml.ts) ─────────────────

function splitBlocks(toml: string): Map<string, string> {
  const blocks = new Map<string, string>();
  let header: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (header) blocks.set(header, buf.join('\n'));
    buf = [];
  };
  for (const line of toml.split('\n')) {
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

function isComparable(header: string): boolean {
  return header.startsWith('[tables.') || header.startsWith('[auth.policies.');
}

function rlsOf(block: string): string | null {
  const m = /^\s*rls\s*=\s*"([^"]*)"/m.exec(block);
  return m ? (m[1] ?? '') : null;
}

function columnsOf(block: string): string[] {
  const m = /columns\s*=\s*\[([\s\S]*?)\]/m.exec(block);
  if (!m || !m[1]) return [];
  return [...m[1].matchAll(/"[^"]*"/g)].map((x) => x[0]);
}

/** Collapse comments + whitespace so cosmetic differences aren't "drift". */
function norm(s: string | null): string {
  if (s == null) return '';
  return s
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
