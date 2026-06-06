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
  RequestLogEntry, Reverification, SafetyResult, Verdict,
} from './types.js';
import { correlate } from './correlate.js';
import { toReplayPayload } from './capture.js';
import { extractTomlContext } from './toml.js';
import { diagnose as realDiagnose, DiagnoseError } from './diagnose.js';
import { validateDiff } from './safety.js';
import { validateTomlPatch, tableSchemaFromToml } from './tomlValidate.js';
import { expectedForkFingerprint, verifyPostApply } from './fingerprint.js';
import { applyTomlDiff, type ApplyResult } from './applyDiff.js';
import { forgeForkJwt } from './forgeJwt.js';
import { replayBoth } from './replay.js';
import { traceReplay } from './traceReplay.js';
import { reverifyOnFork, type ReverifyInput } from './limReverify.js';
import { scoreConfidence } from './score.js';
import { createMemoirClient, recallSimilarity, type RecallQuery } from './memory.js';
import { firstFree, type PoolEntry } from './lib/pool.js';
import { getClient, publishReceipt } from './lib/insforgeClient.js';
import { defaultShip } from './ship.js';

const CHANNEL = 'receipt';

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
  /** Lim.run visual re-verify on the fork (0042). Corroboration only — never
   *  gates. Default no-ops to { rendered:false } instantly without a key. */
  reverifyFork: (input: ReverifyInput) => Promise<Reverification>;
  ship: (decision: ShipDecision) => Promise<{ prUrl: string | null }>;
  /** Memoir recall → scorer's 0–100 pgvector signal (0043). Neutral 50 with no corpus. */
  recallSimilarity: (query: RecallQuery) => Promise<number>;
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

    // 2. diagnose → structured Diagnosis with a TOML diff. A resilience failure
    //    (timeout / overload / truncation, ticket 0036) is NOT a hard crash:
    //    degrade visibly to a failed step with the reason, so the receipt shows
    //    *why* instead of hanging on "diagnosing…".
    const tomlContext = extractTomlContext({ table });
    let diagnosis: Diagnosis;
    try {
      diagnosis = await d.diagnose({
        session: toSession(ctx),
        failingRequest: corr.entry,
        expectedRows: corr.expectedRows,
        tomlContext,
        jwtClaims: ctx.jwtClaims,
      });
    } catch (err) {
      if (err instanceof DiagnoseError) {
        return await fail(d, emit, runId, 'diagnose', `${err.reason}: ${err.message}`);
      }
      throw err;
    }
    await emit('diagnosed', { summary: diagnosis.summary, failingPolicy: diagnosis.failingPolicy });

    // 2b. model self-escalation (0037) — the model itself declined a safe fix
    //     (widensAccess, empty or no-op diff). Trust it: route to issue WITHOUT
    //     spending a fork. Distinct from the deterministic rails below.
    if (isNonActionable(diagnosis)) {
      return await dispatch(d, emit, runId, diagnosis, escalationVerdict(diagnosis), 'issue-from-escalation');
    }

    // 3a. structural rail (0032) — a malformed diff (wrong column, bad cast,
    //     fabricated fn, widening sub-select) breaks at apply-time. Reject pre-apply.
    const structure = validateTomlPatch({
      patch: diagnosis.tomlDiff, tomlContext, tableSchema: tableSchemaFromToml(tomlContext, table),
    });
    if (!structure.ok) {
      return await dispatch(d, emit, runId, diagnosis, structureVerdict(structure.reasons), 'issue-from-structure');
    }

    // 3b. safety rail (0021) — a widening diff the model didn't flag is a hard stop → issue.
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
      // Temporal anchor (0034) — confirm the fork actually holds the intended
      // patch. A fingerprint mismatch means apply silently no-op'd → don't replay
      // a fork that isn't really patched. (Skipped when the dep reports none.)
      if (applied.schemaFingerprint) {
        const anchor = verifyPostApply({
          expected: expectedForkFingerprint(tomlContext, diagnosis.tomlDiff, table),
          actual: applied.schemaFingerprint,
        });
        if (!anchor.match) {
          return await dispatch(d, emit, runId, diagnosis, anchorVerdict(anchor.drift!), 'issue-from-apply-noop');
        }
      }
      // Forge from the already-claimed fork entry — no second pool read.
      const forkJwt = forgeForkJwt(fork.branchId, ctx.jwtClaims, { resolveEntry: () => fork });
      verdict = await d.replayFork(payload, fork, forkJwt);

      // Lim.run visual re-verify on the fork (0042) — CORROBORATION ONLY.
      // Attaches a clickable before/after to the verdict; never changes
      // bugConfirmed/fixVerified and never gates the score. No key ⇒ instant
      // { rendered:false } no-op, so this can't stall or break the run.
      const reverify = await d.reverifyFork({
        branchId: fork.branchId,
        forkBaseUrl: fork.baseUrl,
        forkJwt,
        expectedRows: corr.expectedRows,
      });
      verdict = { ...verdict, reverify };
      if (reverify.previewUrl) {
        await emit('testing', { mode: 'fork', reverified: reverify.rendered, previewUrl: reverify.previewUrl });
      }
    }

    // 5. score → tier. Memoir (0043) recalls a real similarity neighbour from
    //    past outcomes; neutral 50 when there's no corpus (recall never blocks).
    const pgvectorSimilarity = await d.recallSimilarity({
      failingPolicy: diagnosis.failingPolicy,
      tomlDiff: diagnosis.tomlDiff,
      schemaSlice: tomlContext,
    });
    const confidence = scoreConfidence({ diagnosis, verdict, safety, pgvectorSimilarity });

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
  /** Why we dispatched: 'ship' | 'issue-from-escalation' | '…-safety' | '…-lint' | '…-structure'. */
  from: string,
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
    reason: from,
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

/** The model itself declined a safe fix: self-flagged widen, empty or no-op diff. */
function isNonActionable(diagnosis: Diagnosis): boolean {
  const after = (diagnosis.tomlDiff.after ?? '').trim();
  const before = (diagnosis.tomlDiff.before ?? '').trim();
  return diagnosis.widensAccess || after === '' || after === before;
}

function escalationVerdict(diagnosis: Diagnosis): Verdict {
  const why = diagnosis.widensAccess
    ? 'model self-escalated (widensAccess=true)'
    : 'model returned an empty/no-op diff';
  return {
    prod: emptySide(), fork: emptySide(),
    bugConfirmed: false, fixVerified: false,
    rationale: `escalated to issue: ${why} — ${diagnosis.summary}`,
  };
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

function anchorVerdict(drift: string): Verdict {
  return {
    prod: emptySide(), fork: emptySide(),
    bugConfirmed: false, fixVerified: false,
    rationale: `state anchor failed: ${drift}`,
  };
}

function structureVerdict(reasons: string[]): Verdict {
  return {
    prod: emptySide(), fork: emptySide(),
    bugConfirmed: false, fixVerified: false,
    rationale: `structural validation failed: ${reasons.join('; ')}`,
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
    publish: deps?.publish ?? (async (e) => { await publishReceipt(CHANNEL, e.step, e); }),
    updateRun: deps?.updateRun ?? (async (id, patch) => { await getClient().database.from('bug_runs').update(patch).eq('id', id); }),
    tableColumns: deps?.tableColumns ?? defaultTableColumns,
    diagnose: deps?.diagnose ?? realDiagnose,
    acquireFork: deps?.acquireFork ?? ((_id) => firstFree()),
    applyDiff: deps?.applyDiff ?? applyTomlDiff,
    replayFork: deps?.replayFork ?? ((payload, fork, forkJwt) =>
      replayBoth({ payload, branchId: fork.branchId, forkJwt }, { forkBaseUrl: fork.baseUrl })),
    traceReplay: deps?.traceReplay ?? ((payload, patch) => traceReplay({ payload, patch })),
    reverifyFork: deps?.reverifyFork ?? ((input) =>
      reverifyOnFork(input, { apiKey: process.env.LIMRUN_API_KEY })), // 0042 — no key ⇒ unavailable no-op
    ship: deps?.ship ?? ((decision) => defaultShip(decision)), // 0011 → openPr via ship.ts
    recallSimilarity: deps?.recallSimilarity ?? ((q) => recallSimilarity(createMemoirClient(), q)),
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
