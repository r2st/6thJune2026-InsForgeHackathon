// functions/e2e-trace.test.ts
// Headless end-to-end pipeline check against the LIVE test backend.
//
// This is the "does the whole loop actually run" harness from the recommended
// two-track plan. It exercises the real seam between four modules — traceReplay
// (0012) → safety (0021) → score (0020) → trace tier cap — using REAL rows
// pulled from the live `hush` InsForge project (docs/TESTING.md), not the
// hardcoded DEMO_SEED.
//
// Why trace mode: the test backend is InsForge v1.0.0 (no branch projects), so
// the real fork replay (0008) can't run here yet. Trace-only is the path that
// works today — and proving it end-to-end de-risks everything downstream.
//
// Integration test: it shells out to `npx @insforge/cli db query`. If the CLI
// isn't authed / linked (e.g. CI without secrets), every case SKIPS with a
// clear reason rather than failing — it never blocks the unit suite.
//
// Run: pnpm -F @hush/functions test e2e-trace
//      (or `npx vitest run e2e-trace.test.ts` from functions/)

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';

import type { ReplayPayload, TomlPatch } from './types.js';
import { traceReplay, type SeedRow } from './traceReplay.js';
import { validateDiff } from './safety.js';
import { scoreConfidence } from './score.js';

const ACME = '11111111-1111-1111-1111-111111111111';
const TENANT_COLS = ['id', 'tenant_id', 'user_id', 'total', 'created_at'];

// The candidate fix Hush would propose: add an OR branch for the migrated
// tenant_ids[] claim shape. before = the buggy policy; after = the patch.
const PATCH: TomlPatch = {
  path: 'tables.orders.rls',
  before: "tenant_id = (auth.jwt() ->> 'tenant')::uuid",
  after:
    "tenant_id = (auth.jwt() ->> 'tenant')::uuid OR tenant_id = ANY((auth.jwt() -> 'tenant_ids')::uuid[])",
};

/** A decodable (unsigned) JWT carrying the migrated claim shape. */
function jwtWithClaims(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
}

// The `.insforge` project link lives at the repo root; vitest runs from
// functions/, so point the CLI at the root explicitly.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Pull live orders rows from the test backend; null if the CLI can't reach it. */
function fetchLiveSeed(): SeedRow[] | null {
  try {
    const out = execFileSync(
      'npx',
      ['@insforge/cli', 'db', 'query', 'select tenant_id from orders', '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000, cwd: REPO_ROOT },
    );
    const parsed = JSON.parse(out) as { rows?: Array<{ tenant_id: string }> };
    if (!parsed.rows) return null;
    return parsed.rows.map((r) => ({ tenant_id: r.tenant_id }));
  } catch {
    return null;
  }
}

describe('E2E (live backend) · trace-only pipeline', () => {
  let seed: SeedRow[] | null;

  beforeAll(() => {
    seed = fetchLiveSeed();
  });

  it('drives capture→diagnose-patch→trace→safety→score against real seeded rows', (ctx) => {
    if (!seed) {
      ctx.skip(); // CLI not authed/linked — see docs/TESTING.md to set up the backend.
      return;
    }

    // Sanity: the live seed must carry the demo shape (3 Acme orders) for the
    // bug to be reproducible. If it drifted, fail loudly — the backend is wrong.
    const acmeRows = seed.filter((r) => r.tenant_id === ACME).length;
    expect(acmeRows, 'live backend should have 3 Acme orders (run the seed)').toBe(3);

    // The captured failing request: user A on /orders, JWT migrated to tenant_ids[].
    const payload: ReplayPayload = {
      method: 'GET',
      path: '/orders',
      headers: {},
      body: null,
      query: {},
      ts: '2026-06-06T19:00:00.000Z',
      jwt: jwtWithClaims({ sub: 'user-a', tenant_ids: [ACME] }),
      expectedRows: acmeRows, // what the user should have seen
    };

    // 1. Trace replay against the LIVE rows (no fork — v1.0.0 backend).
    const verdict = traceReplay({ payload, patch: PATCH, seedRows: seed });
    expect(verdict.mode, 'must be tagged trace, never masquerade as fork').toBe('trace');
    expect(verdict.prod.rowsReturned, 'buggy policy → 0 rows (the silent bug)').toBe(0);
    expect(verdict.fork.rowsReturned, 'patched policy → expected rows (the fix)').toBe(acmeRows);
    expect(verdict.bugConfirmed).toBe(true);
    expect(verdict.fixVerified).toBe(true);

    // 2. Safety rail: the patch must NOT widen access.
    const safety = validateDiff({ patch: PATCH, tableColumns: TENANT_COLS });
    expect(safety.widens, safety.reasons.join('; ')).toBe(false);

    // 3. Score the run. The diagnosis side-data mirrors the small single-policy fix.
    const result = scoreConfidence({
      diagnosis: {
        summary: 'orders policy reads tenant; JWT carries tenant_ids',
        expectation: 'user A sees their 3 orders',
        observation: 'RLS returned 0 rows',
        failingPolicy: 'orders.orders_select',
        failingJwtClaim: "auth.jwt() ->> 'tenant'",
        tomlDiff: PATCH,
        widensAccess: safety.widens,
        confidenceInputs: { diffLoc: 1, tablesTouched: 1, policyBlast: 1 },
        promptVersion: 'diagnose-v1.0.0',
      },
      verdict,
      safety,
      pgvectorSimilarity: 50, // no corpus on day one — neutral
    });

    // 4. Trace honesty: a trace verdict can never open a PR. Cap the tier.
    const dispatchTier = verdict.mode === 'trace' && result.tier === 'pr' ? 'draft_pr' : result.tier;
    expect(dispatchTier, 'trace must cap at draft_pr — never PR').not.toBe('pr');

    // Human-readable trace for the run log.
    // eslint-disable-next-line no-console
    console.log(
      `\n  [e2e] live rows=${seed.length} · prod=${verdict.prod.rowsReturned} fork=${verdict.fork.rowsReturned}` +
        ` · bug=${verdict.bugConfirmed} fix=${verdict.fixVerified}` +
        ` · widens=${safety.widens} · score=${result.score} · tier=${dispatchTier} (${verdict.mode})\n`,
    );
  });
});
