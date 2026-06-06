// functions/replay.ts
// Parallel replay against prod and the fork. Returns a falsifiable Verdict.
//
// Ticket: agents/tasks/0008-parallel-replay-and-verdict.md
// Two-signal principle ("Lie #03 + #05" defense from the-hardest-part.html):
//   bugConfirmed  iff prod returns fewer rows than expectedRows AND fork meets it
//   fixVerified   iff fork returns at least expectedRows
//   neither alone is sufficient to declare success — and the scorer (score.ts)
//   hard-caps any run where this verdict isn't a clean reproduce-then-fix.
//
// This is the data behind slide 06's two terminals (prod red / fork green).
// The rowsReturned 0-vs-3 delta is the only "is this real" signal we have, so
// the row-count parse and the verdict arithmetic are the load-bearing logic and
// are exhaustively unit-tested with an injected fetch (see replay.test.ts).

import type { ReplayPayload, Verdict, ReplaySide, ProbeVerdict, SuiteVerdict } from './types.js';

export interface ReplayInput {
  payload: ReplayPayload;
  branchId: string;
  /** Forged JWT signed by the fork's key, with the user's original claims (0007). */
  forkJwt: string;
}

/** Injectable seams — defaulted from env/global so tests stay hermetic. */
export interface ReplayDeps {
  fetch: typeof fetch;
  /** Base URL of the prod InsForge project (oss_host). */
  prodBaseUrl: string;
  /** Base URL of the fork branch project. Resolved by the pool/orchestrator. */
  forkBaseUrl: string;
  /** Wall-clock source — injectable so latency assertions are deterministic. */
  now: () => number;
}

const SNIPPET_MAX = 200;

export async function replayBoth(input: ReplayInput, deps?: Partial<ReplayDeps>): Promise<Verdict> {
  const d: ReplayDeps = {
    fetch: deps?.fetch ?? fetch,
    prodBaseUrl: deps?.prodBaseUrl ?? requireEnv('INSFORGE_URL'),
    forkBaseUrl: deps?.forkBaseUrl ?? requireEnv('HUSH_FORK_BASE_URL'),
    now: deps?.now ?? Date.now,
  };

  const { payload } = input;
  const expected = payload.expectedRows;

  // Fire both in parallel — total wall-clock is the slower of the two, not the
  // sum. The original JWT goes to prod; the forged one to the fork.
  const [prod, fork] = await Promise.all([
    replayOne(d, d.prodBaseUrl, payload, payload.jwt),
    replayOne(d, d.forkBaseUrl, payload, input.forkJwt),
  ]);

  // A transport error on either side makes the run unfalsifiable → not confirmed.
  if (prod.error || fork.error) {
    const which = prod.error ? `prod (${prod.error})` : `fork (${fork.error})`;
    return {
      prod: prod.side,
      fork: fork.side,
      bugConfirmed: false,
      fixVerified: false,
      rationale: `replay error on ${which} — verdict withheld`,
    };
  }

  const bugConfirmed = prod.side.rowsReturned < expected && fork.side.rowsReturned >= expected;
  const fixVerified = fork.side.rowsReturned >= expected;

  return {
    prod: prod.side,
    fork: fork.side,
    bugConfirmed,
    fixVerified,
    rationale: rationale(prod.side, fork.side, expected, bugConfirmed, fixVerified),
  };
}

interface OneResult {
  side: ReplaySide;
  error?: string;
}

async function replayOne(
  d: ReplayDeps,
  baseUrl: string,
  payload: ReplayPayload,
  jwt: string,
): Promise<OneResult> {
  const url = buildUrl(baseUrl, payload.path, payload.query);
  const started = d.now();
  try {
    const res = await d.fetch(url, {
      method: payload.method,
      headers: {
        ...payload.headers,
        authorization: `Bearer ${jwt}`,
        // Cache-bypass — we must observe the live policy decision, not a cached body.
        'cache-control': 'no-cache, no-store, max-age=0',
        pragma: 'no-cache',
        'x-hush-cache-bust': payload.ts,
      },
      body: hasBody(payload.method) ? JSON.stringify(payload.body ?? null) : undefined,
    });
    const latencyMs = d.now() - started;
    const text = await res.text();
    return {
      side: {
        status: res.status,
        rowsReturned: countRows(text),
        latencyMs,
        snippet: snippet(text),
      },
    };
  } catch (err) {
    const latencyMs = d.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    return {
      side: { status: 0, rowsReturned: 0, latencyMs, snippet: snippet(message) },
      error: message,
    };
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Count rows in a response body across the shapes InsForge/PostgREST return:
 * a bare JSON array, `{ data: [...] }`, or a count envelope (`count` / `rows` /
 * `rowsReturned`). Unparseable or scalar bodies count as 0 — a body we can't
 * read as rows is not evidence of rows.
 */
export function countRows(text: string): number {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return 0;
  }
  if (Array.isArray(body)) return body.length;
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data.length;
    if (Array.isArray(o.rows)) return o.rows.length;
    for (const key of ['count', 'rowsReturned', 'total'] as const) {
      if (typeof o[key] === 'number') return o[key] as number;
    }
  }
  return 0;
}

function rationale(
  prod: ReplaySide,
  fork: ReplaySide,
  expected: number,
  bugConfirmed: boolean,
  fixVerified: boolean,
): string {
  if (bugConfirmed && fixVerified) {
    return `prod returned ${prod.rowsReturned}/${expected} rows; fork returned ${fork.rowsReturned} — bug reproduced, fix verified on branch`;
  }
  if (!fixVerified) {
    return `fork returned ${fork.rowsReturned}/${expected} rows — patch did not restore expected rows; not a fix`;
  }
  // fixVerified but not bugConfirmed → prod already returned enough rows.
  return `prod already returned ${prod.rowsReturned}/${expected} rows — no bug to reproduce`;
}

function buildUrl(baseUrl: string, path: string, query: Record<string, string>): string {
  const url = new URL(path, ensureTrailingSlash(baseUrl));
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}

function ensureTrailingSlash(s: string): string {
  return s.endsWith('/') ? s : s + '/';
}

function hasBody(method: string): boolean {
  const m = method.toUpperCase();
  return m !== 'GET' && m !== 'HEAD';
}

function snippet(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > SNIPPET_MAX ? flat.slice(0, SNIPPET_MAX - 1) + '…' : flat;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`replay: missing required env ${name} (or pass it via deps)`);
  return v;
}

// ── Differential replay suite (ticket 0033) ─────────────────────────────────────
// Slide 06 reads "4 of 4 probes pass on fork · 1 of 4 on prod". Every load-bearing
// claim needs at least one OTHER probe to corroborate it: a cross-tenant probe to
// catch widening-through-indirection, and count/join probes to catch regressions a
// single SELECT can't see. All probes fire in parallel against both sides; the
// transport is injected (runProbe) so the probe set + verdict arithmetic are tested
// without a network, mirroring replayBoth's injected fetch.

/** A single thing to ask both prod and the fork. */
export interface ProbeSpec {
  name: 'failing' | 'neighbor' | 'count' | 'join';
  /** How to judge agreement between the two sides for THIS probe. */
  kind: 'reproduce_then_fix' | 'must_be_empty_both' | 'counts_must_match';
}

export interface SuiteInput {
  expectedRows: number;
}

export interface SuiteDeps {
  /** Run one probe against one side, return what came back. Injected for tests. */
  runProbe: (side: 'prod' | 'fork', probe: ProbeSpec) => Promise<ReplaySide>;
}

const SUITE_PROBES: ProbeSpec[] = [
  { name: 'failing', kind: 'reproduce_then_fix' },   // captured request, tenant A
  { name: 'neighbor', kind: 'must_be_empty_both' },  // tenant B (Globex), seeded empty
  { name: 'count', kind: 'counts_must_match' },      // count(*) orders, tenant A
  { name: 'join', kind: 'counts_must_match' },       // canonical join over orders
];

export async function replaySuite(input: SuiteInput, deps: SuiteDeps): Promise<SuiteVerdict> {
  const expected = input.expectedRows;

  // Fire all probes against both sides at once — 2×N concurrent requests.
  const results = await Promise.all(
    SUITE_PROBES.map(async (probe) => {
      const [prod, fork] = await Promise.all([deps.runProbe('prod', probe), deps.runProbe('fork', probe)]);
      return judgeProbe(probe, prod, fork, expected);
    }),
  );

  const failing = results.find((p) => p.name === 'failing')!;
  const neighbor = results.find((p) => p.name === 'neighbor');

  const bugConfirmed = failing.prod.rowsReturned < expected;
  const fixVerified = failing.fork.rowsReturned >= expected;
  // Widening: the cross-tenant probe (or any probe) shows MORE rows on fork than
  // prod where prod had none — data leaked through the patch.
  const widensAccess =
    (!!neighbor && neighbor.fork.rowsReturned > neighbor.prod.rowsReturned) ||
    results.some((p) => p.name !== 'failing' && p.fork.rowsReturned > p.prod.rowsReturned);

  const suiteScore = scoreSuite({ results, bugConfirmed, fixVerified, widensAccess });
  return {
    probes: results,
    bugConfirmed,
    fixVerified,
    widensAccess,
    suiteScore,
    rationale: suiteRationale(results, widensAccess),
  };
}

/** Build a single-payload Verdict from a SuiteVerdict (failing probe = headline). */
export function suiteToVerdict(suite: SuiteVerdict): Verdict {
  const failing = suite.probes.find((p) => p.name === 'failing')!;
  return {
    prod: failing.prod,
    fork: failing.fork,
    bugConfirmed: suite.bugConfirmed,
    // A widening suite must never read as a clean fix downstream.
    fixVerified: suite.fixVerified && !suite.widensAccess,
    rationale: suite.rationale,
    mode: 'fork',
    suiteScore: suite.suiteScore,
  };
}

function judgeProbe(probe: ProbeSpec, prod: ReplaySide, fork: ReplaySide, expected: number): ProbeVerdict {
  let pass: boolean;
  let note: string;
  switch (probe.kind) {
    case 'reproduce_then_fix':
      pass = prod.rowsReturned < expected && fork.rowsReturned >= expected;
      note = `prod ${prod.rowsReturned}/${expected}, fork ${fork.rowsReturned}`;
      break;
    case 'must_be_empty_both':
      pass = prod.rowsReturned === 0 && fork.rowsReturned === 0;
      note = `cross-tenant prod ${prod.rowsReturned}, fork ${fork.rowsReturned} (both must be 0)`;
      break;
    case 'counts_must_match':
      pass = prod.rowsReturned === fork.rowsReturned;
      note = `prod ${prod.rowsReturned}, fork ${fork.rowsReturned} (must match)`;
      break;
  }
  return { name: probe.name, prod, fork, pass, note };
}

/**
 * Translate suite outcomes to the replay signal (ticket 0033):
 *   all probes consistent          → 100
 *   bug confirmed + fix verified,
 *     one regression probe disagrees → 60
 *   bug confirmed, fix NOT verified  → 30
 *   widening detected                → 0  (forces tier issue)
 */
function scoreSuite(x: {
  results: ProbeVerdict[];
  bugConfirmed: boolean;
  fixVerified: boolean;
  widensAccess: boolean;
}): number {
  if (x.widensAccess) return 0;
  if (x.bugConfirmed && x.fixVerified) {
    return x.results.every((p) => p.pass) ? 100 : 60;
  }
  if (x.bugConfirmed && !x.fixVerified) return 30;
  return 0;
}

function suiteRationale(results: ProbeVerdict[], widens: boolean): string {
  const pass = results.filter((p) => p.pass).length;
  const lead = `${pass}/${results.length} probes consistent`;
  return widens ? `${lead} — WIDENING detected, blocked` : lead;
}
