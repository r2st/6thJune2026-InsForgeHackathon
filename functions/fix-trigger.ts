// functions/fix-trigger.ts
//
// The glue. Given one captured session (a bug_runs row in 'captured' state),
// drive diagnose → test → ship and stream progress to the receipt page. Each
// stage already has its owning ticket and returns a strict type from types.ts;
// this file does NOT reshape their outputs — it sequences them and dispatches
// on the result.
//
// Stages (owning ticket):
//   1. correlate + capture   → ReplayPayload         (0014, 0005)
//   2. toml + diagnose       → Diagnosis             (0019, 0018)
//   3. safety                → SafetyResult          (0021)  — widens ⇒ stop → issue
//   4. fork + applyDiff + forgeJwt + replay → Verdict (0004/0006/0007/0008)
//      └ fork unavailable ⇒ trace-only fallback      (0012)  — caps tier at draft_pr
//   5. score                 → ConfidenceResult      (0020, 0035)
//   6. dispatch by tier      → PR / draft PR / issue  (0011)
//
// Every stage publishes one ReceiptEvent on channel 'receipt'. A failure
// publishes step:'failed' with a reason and stops the loop cleanly. All
// collaborators are injected (OrchestratorDeps) so the loop is unit-tested
// without a live backend; the defaults wire to the real functions.

import type {
  BugRun, ConfidenceResult, Diagnosis, ReceiptEvent, ReplayPayload,
  RequestLogEntry, SafetyResult, Verdict,
} from './types.js';
import { correlate } from './correlate.js';
import { toReplayPayload } from './capture.js';
import { extractTomlContext } from './toml.js';
import { diagnose as realDiagnose } from './diagnose.js';
import { validateDiff } from './safety.js';
import { applyTomlDiff, type ApplyResult } from './applyDiff.js';
import { forgeForkJwt } from './forgeJwt.js';
import { replayBoth } from './replay.js';
import { traceReplay } from './traceReplay.js';
import { scoreConfidence } from './score.js';
import { firstFree, type PoolEntry } from './lib/pool.js';
import { getClient } from './lib/insforgeClient.js';

const CHANNEL = 'receipt';
/** No corpus on hackathon day — neutral pgvector signal. */
const NEUTRAL_SIMILARITY = 50;

/** The bug_runs row this run reads, plus the captured user's claims. */
export interface RunContext {
  run: BugRun;
  requestLogWindow: RequestLogEntry[];
  /** Verbatim prod JWT the failing request carried (for replay against prod). */
  prodJwt: string;
  /** Decoded claims — forged onto the fork token, fed to diagnose. */
  jwtClaims: Record<string, unknown>;
}

export interface ShipDecision {
  runId: string;
  tier: ConfidenceResult['tier'];
  diagnosis: Diagnosis;
  verdict: Verdict;
  confidence: ConfidenceResult;
}

export interface OrchestratorDeps {
  loadContext: (runId: string) => Promise<RunContext>;
  publish: (event: ReceiptEvent) => Promise<void>;
  updateRun: (runId: string, patch: Partial<Record<string, unknown>>) => Promise<void>;
  tableColumns: (table: string) => string[];
  diagnose: (input: Parameters<typeof realDiagnose>[0]) => Promise<Diagnosis>;
  acquireFork: (runId: string) => PoolEntry | null;
  applyDiff: (branchId: string, patch: Diagnosis['tomlDiff']) => Promise<ApplyResult>;
  replayFork: (payload: ReplayPayload, fork: PoolEntry, forkJwt: string) => Promise<Verdict>;
  traceReplay: (payload: ReplayPayload, patch: Diagnosis['tomlDiff']) => Verdict | Promise<Verdict>;
  ship: (decision: ShipDecision) => Promise<{ prUrl: string | null }>;
  now: () => string;
}

export interface FixResult {
  runId: string;
  tier: ConfidenceResult['tier'] | null;
  prUrl: string | null;
  status: BugRun['status'];
}

export async function fixTrigger(runId: string, deps?: Partial<OrchestratorDeps>): Promise<FixResult> {
  const d = withDefaults(deps);
  const at = () => d.now();
  const emit = (step: ReceiptEvent['step'], detail?: Record<string, unknown>) =>
    d.publish({ runId, step, at: at(), ...(detail ? { detail } : {}) });

  try {
    const ctx = await d.loadContext(runId);

    // 1. correlate + capture → the one replayable failing request.
    const corr = correlate(ctx.requestLogWindow);
    if (!corr.ok) return await fail(d, emit, runId, 'correlate', corr.reason);
    const payload = toReplayPayload(corr.entry, corr.expectedRows, ctx.prodJwt);
    const table = corr.entry.rlsDecisions?.[0]?.table ?? stripLeadingSlash(corr.entry.route);
    await emit('correlated', { route: corr.entry.route, expectedRows: corr.expectedRows });

    // 2. diagnose → structured Diagnosis with a TOML diff.
    const tomlContext = extractTomlContext({ table });
    const diagnosis = await d.diagnose({
      session: toSession(ctx),
      failingRequest: corr.entry,
      expectedRows: corr.expectedRows,
      tomlContext,
      jwtClaims: ctx.jwtClaims,
    });
    await emit('diagnosed', { summary: diagnosis.summary, failingPolicy: diagnosis.failingPolicy });

    // 3. safety rail — a widening diff the model didn't flag is a hard stop → issue.
    const safety = validateDiff({ patch: diagnosis.tomlDiff, tableColumns: d.tableColumns(table) });
    if (safety.widens && !diagnosis.widensAccess) {
      return await dispatch(d, emit, runId, diagnosis, vetoVerdict(safety), 'issue-from-safety');
    }

    // 4. test on a fork — or fall back to trace-only if the pool is empty.
    await emit('testing', { mode: 'fork' });
    const fork = d.acquireFork(runId);
    let verdict: Verdict;
    if (!fork) {
      verdict = await d.traceReplay(payload, diagnosis.tomlDiff);
    } else {
      const applied = await d.applyDiff(fork.branchId, diagnosis.tomlDiff);
      if (!applied.ok) {
        // Patch won't even lint on the branch — don't ship a diff we can't apply.
        return await dispatch(d, emit, runId, diagnosis, lintVerdict(applied.lintError), 'issue-from-lint');
      }
      // Forge from the already-claimed fork entry — no second pool read.
      const forkJwt = forgeForkJwt(fork.branchId, ctx.jwtClaims, { resolveEntry: () => fork });
      verdict = await d.replayFork(payload, fork, forkJwt);
    }

    // 5. score → tier.
    const confidence = scoreConfidence({ diagnosis, verdict, safety, pgvectorSimilarity: NEUTRAL_SIMILARITY });

    // 6. dispatch. A trace verdict can never reach 'pr' — cap it at draft_pr.
    const tier = verdict.mode === 'trace' ? capTrace(confidence.tier) : confidence.tier;
    return await dispatch(d, emit, runId, diagnosis, verdict, 'ship', { ...confidence, tier });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await emit('failed', { error: message });
    await d.updateRun(runId, { status: 'failed' });
    return { runId, tier: null, prUrl: null, status: 'failed' };
  }
}

// ── terminal paths ───────────────────────────────────────────────────────────

async function dispatch(
  d: OrchestratorDeps,
  emit: (step: ReceiptEvent['step'], detail?: Record<string, unknown>) => Promise<void>,
  runId: string,
  diagnosis: Diagnosis,
  verdict: Verdict,
  _from: string,
  confidenceOverride?: ConfidenceResult & { tier: ConfidenceResult['tier'] },
): Promise<FixResult> {
  const confidence = confidenceOverride ?? forcedIssue(diagnosis);
  const { prUrl } = await d.ship({ runId, tier: confidence.tier, diagnosis, verdict, confidence });

  await d.updateRun(runId, {
    diagnosis,
    toml_diff: diagnosis.tomlDiff,
    confidence: confidence.score,
    tier: confidence.tier,
    pr_url: prUrl,
    prompt_version: diagnosis.promptVersion,
    status: 'shipped',
  });
  await emit('shipped', {
    tier: confidence.tier,
    confidence: confidence.score,
    prUrl,
    mode: verdict.mode ?? 'fork',
    verified: verdict.bugConfirmed && verdict.fixVerified,
  });
  return { runId, tier: confidence.tier, prUrl, status: 'shipped' };
}

async function fail(
  d: OrchestratorDeps,
  emit: (step: ReceiptEvent['step'], detail?: Record<string, unknown>) => Promise<void>,
  runId: string,
  stage: string,
  reason: string,
): Promise<FixResult> {
  await emit('failed', { stage, reason });
  await d.updateRun(runId, { status: 'failed' });
  return { runId, tier: null, prUrl: null, status: 'failed' };
}

// ── small pure helpers ─────────────────────────────────────────────────────────

function capTrace(tier: ConfidenceResult['tier']): ConfidenceResult['tier'] {
  return tier === 'pr' ? 'draft_pr' : tier;
}

/** Safety veto / lint failure → an issue-tier confidence with a 0 score. */
function forcedIssue(diagnosis: Diagnosis): ConfidenceResult & { tier: ConfidenceResult['tier'] } {
  return {
    score: 0,
    tier: 'issue',
    signals: { replayVerdictScore: 0, diffSizeScore: 0, policyBlastScore: 0, pgvectorSimilarityScore: 0 },
    ceiling: 'issue',
    promptVersion: diagnosis.promptVersion,
  };
}

function vetoVerdict(safety: SafetyResult): Verdict {
  return {
    prod: emptySide(), fork: emptySide(),
    bugConfirmed: false, fixVerified: false,
    rationale: `safety rail: diff widens access — ${safety.reasons.join('; ')}`,
  };
}

function lintVerdict(lintError: string): Verdict {
  return {
    prod: emptySide(), fork: emptySide(),
    bugConfirmed: false, fixVerified: false,
    rationale: `branch apply failed: ${lintError}`,
  };
}

function emptySide() {
  return { status: 0, rowsReturned: 0, latencyMs: 0, snippet: '' };
}

function toSession(ctx: RunContext): Parameters<typeof realDiagnose>[0]['session'] {
  return {
    sessionId: ctx.run.id,
    tenantId: ctx.run.tenantId,
    userId: String(ctx.jwtClaims.sub ?? ''),
    startedAt: ctx.run.capturedAt,
    endedAt: ctx.run.capturedAt,
    frustrationAt: null,
    clipUrl: ctx.run.sessionClipUrl ?? '',
  };
}

function stripLeadingSlash(route: string): string {
  return route.replace(/^\//, '').split('?')[0]!;
}

// ── default wiring (real backend) ──────────────────────────────────────────────

function withDefaults(deps?: Partial<OrchestratorDeps>): OrchestratorDeps {
  return {
    loadContext: deps?.loadContext ?? defaultLoadContext,
    publish: deps?.publish ?? (async (e) => { await getClient().realtime.publish(CHANNEL, e.step, e); }),
    updateRun: deps?.updateRun ?? (async (id, patch) => { await getClient().database.from('bug_runs').update(patch).eq('id', id); }),
    tableColumns: deps?.tableColumns ?? defaultTableColumns,
    diagnose: deps?.diagnose ?? realDiagnose,
    acquireFork: deps?.acquireFork ?? ((_id) => firstFree()),
    applyDiff: deps?.applyDiff ?? applyTomlDiff,
    replayFork: deps?.replayFork ?? ((payload, fork, forkJwt) =>
      replayBoth({ payload, branchId: fork.branchId, forkJwt }, { forkBaseUrl: fork.baseUrl })),
    traceReplay: deps?.traceReplay ?? ((payload, patch) => traceReplay({ payload, patch })),
    ship: deps?.ship ?? (async () => ({ prUrl: null })), // 0011 plugs in here
    now: deps?.now ?? (() => new Date().toISOString()),
  };
}

async function defaultLoadContext(runId: string): Promise<RunContext> {
  // Default loader is intentionally thin; the demo wires a richer one that also
  // resolves the prod JWT. Throwing here surfaces a misconfiguration loudly
  // rather than silently shipping with an empty token.
  throw new Error(`fix-trigger: no loadContext configured for run ${runId} — inject one`);
}

function defaultTableColumns(table: string): string[] {
  try {
    const ctx = extractTomlContext({ table });
    return [...ctx.matchAll(/"\s*(\w+)\s+[a-z]/gi)].map((m) => m[1]!).filter(Boolean);
  } catch {
    return [];
  }
}

// ── HTTP handler ───────────────────────────────────────────────────────────────

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const { runId } = (await req.json()) as { runId: string };
  const result = await fixTrigger(runId);
  return Response.json(result);
}

export type { BugRun, ConfidenceResult, Verdict };
