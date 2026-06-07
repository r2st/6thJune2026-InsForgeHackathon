// functions/evalHarness.ts
// Prompt & model evaluation harness — diagnose quality + regression gate.
//
// Ticket:  agents/tasks/0072-prompt-model-eval-harness.md
// Defends: diagnose is the AI core. Today it's one prompt against one model with
//          unit tests that MOCK the LLM. A product needs a real eval: scoring each
//          (prompt-version × provider × model) against a labelled bug corpus so a
//          prompt edit or model swap can't silently degrade fix quality — and the
//          default model is chosen by evidence, not vibes.
//
// Pure, testable core: given a labelled eval set (expected policy/diff/verdict) and
// a model's outputs, score each case on the dimensions that matter — correct
// failing-policy ID, a valid+safe diff, a passing fork verdict, and NO hallucinated
// columns/functions. A hallucinated or unsafe diff is a HARD fail (it can't ship,
// so correctness is moot). Aggregate to a run score, gate CI on no-regression, and
// build a cost/latency/quality table to pick the default + tiered models. The
// actual LLM calls, fixtures, and the CI workflow are the integration seam.

export type Difficulty = 'easy' | 'medium' | 'hard';

/** One labelled case: the ground truth a correct diagnose must reproduce. */
export interface EvalCase {
  id: string;
  difficulty: Difficulty;
  expectedPolicy: string;          // "<table>.<policy>" the model should identify
}

/** What a (prompt × provider × model) produced for a case, post-replay. */
export interface EvalOutput {
  caseId: string;
  policy: string;                  // the failing policy the model named
  /** Diff is structurally valid AND passes the safety rail (no widening). */
  diffValidAndSafe: boolean;
  /** The fork replay verdict passed (bug reproduced on prod, fixed on fork). */
  forkVerdictPass: boolean;
  /** Identifiers the model invented that don't exist (columns/functions). */
  hallucinatedIdentifiers: string[];
}

export interface CaseScore {
  caseId: string;
  score: number;                   // 0..1
  policyMatch: boolean;
  forkPass: boolean;
  /** A hard fail: an unsafe/invalid diff or a hallucination — cannot ship at any score. */
  hardFail: boolean;
  reason: string;
}

// Correctness weights (only applied when the case did NOT hard-fail).
const W_POLICY = 0.5;
const W_FORK = 0.5;

/**
 * Score one case. A hallucinated identifier or an invalid/unsafe diff is a hard
 * fail (score 0) — a wrong or access-widening fix is worse than no fix, so it must
 * not earn partial credit. Otherwise correctness = did it name the right policy
 * and did the fork verdict pass.
 */
export function scoreCase(c: EvalCase, out: EvalOutput): CaseScore {
  const policyMatch = norm(c.expectedPolicy) === norm(out.policy);
  const hallucinated = out.hallucinatedIdentifiers.length > 0;
  const hardFail = hallucinated || !out.diffValidAndSafe;

  if (hardFail) {
    return {
      caseId: c.id, score: 0, policyMatch, forkPass: out.forkVerdictPass, hardFail: true,
      reason: hallucinated
        ? `hard fail — hallucinated ${out.hallucinatedIdentifiers.length} identifier(s): ${out.hallucinatedIdentifiers.join(', ')}`
        : 'hard fail — diff invalid or widens access (safety rail)',
    };
  }
  const score = (policyMatch ? W_POLICY : 0) + (out.forkVerdictPass ? W_FORK : 0);
  return {
    caseId: c.id, score, policyMatch, forkPass: out.forkVerdictPass, hardFail: false,
    reason: `policy ${policyMatch ? 'matched' : 'WRONG'}, fork verdict ${out.forkVerdictPass ? 'passed' : 'FAILED'}`,
  };
}

// ── run aggregation ────────────────────────────────────────────────────────────────

export interface RunIdentity {
  promptVersion: string;
  provider: string;
  model: string;
}

export interface EvalRunResult {
  identity: RunIdentity;
  meanScore: number;               // 0..1 across all cases
  passRate: number;                // fraction of cases scoring ≥ caseThreshold
  hardFails: number;
  byDifficulty: Record<Difficulty, { n: number; meanScore: number }>;
  cases: CaseScore[];
}

/** A case "passes" when it scored at least this — both policy and fork correct. */
export const CASE_PASS_THRESHOLD = 1.0;

/**
 * Aggregate a run: mean score, pass-rate, hard-fail count, and a per-difficulty
 * breakdown (so a model that's fine on easy bugs but collapses on hard ones is
 * visible — that's what drives tiered model selection).
 */
export function scoreRun(identity: RunIdentity, cases: EvalCase[], outputs: EvalOutput[]): EvalRunResult {
  const byId = new Map(outputs.map((o) => [o.caseId, o]));
  const scored: CaseScore[] = cases.map((c) => {
    const out = byId.get(c.id);
    if (!out) return { caseId: c.id, score: 0, policyMatch: false, forkPass: false, hardFail: true, reason: 'no output for case (model produced nothing)' };
    return scoreCase(c, out);
  });

  const meanScore = mean(scored.map((s) => s.score));
  const passRate = scored.length ? scored.filter((s) => s.score >= CASE_PASS_THRESHOLD).length / scored.length : 0;
  const hardFails = scored.filter((s) => s.hardFail).length;

  const byDifficulty = {} as Record<Difficulty, { n: number; meanScore: number }>;
  for (const d of ['easy', 'medium', 'hard'] as Difficulty[]) {
    const idsAtD = new Set(cases.filter((c) => c.difficulty === d).map((c) => c.id));
    const at = scored.filter((s) => idsAtD.has(s.caseId));
    byDifficulty[d] = { n: at.length, meanScore: mean(at.map((s) => s.score)) };
  }

  return { identity, meanScore, passRate, hardFails, byDifficulty, cases: scored };
}

// ── CI regression gate ──────────────────────────────────────────────────────────────

export interface GateResult {
  pass: boolean;
  reason: string;
}

export interface GateOptions {
  /** Absolute floor the candidate must clear regardless of baseline. */
  minScore?: number;
  /** Max allowed drop vs the baseline run (catches a small-but-real regression). */
  maxDrop?: number;
}

const DEFAULT_MIN_SCORE = 0.8;
const DEFAULT_MAX_DROP = 0.02;

/**
 * Gate a prompt/model change for merge: the candidate must clear an absolute floor,
 * must not drop more than `maxDrop` below the baseline, and must not introduce ANY
 * new hard fail (a newly hallucinating or access-widening model never merges).
 */
export function regressionGate(baseline: EvalRunResult, candidate: EvalRunResult, opts: GateOptions = {}): GateResult {
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;
  const maxDrop = opts.maxDrop ?? DEFAULT_MAX_DROP;

  if (candidate.hardFails > baseline.hardFails) {
    return { pass: false, reason: `blocked — new hard fail(s): ${baseline.hardFails}→${candidate.hardFails} (hallucination or access-widening)` };
  }
  if (candidate.meanScore < minScore) {
    return { pass: false, reason: `blocked — score ${candidate.meanScore.toFixed(3)} below floor ${minScore}` };
  }
  if (candidate.meanScore < baseline.meanScore - maxDrop) {
    return { pass: false, reason: `blocked — regression ${baseline.meanScore.toFixed(3)}→${candidate.meanScore.toFixed(3)} exceeds maxDrop ${maxDrop}` };
  }
  return { pass: true, reason: `ok — score ${candidate.meanScore.toFixed(3)} (baseline ${baseline.meanScore.toFixed(3)}), no new hard fails` };
}

// ── model selection (cost / latency / quality) ──────────────────────────────────────

export interface ModelProfile {
  provider: string;
  model: string;
  run: EvalRunResult;
  costPer1kUsd: number;
  latencyMsP50: number;
}

export interface ModelSelection {
  /** Default for the reliability chain — best quality clearing the bar, cheapest tie-break. */
  defaultModel: ModelProfile;
  /** Cheapest model that still clears the easy-bug bar — for the cheap first hop. */
  easyModel: ModelProfile;
  /** Highest-quality model for hard bugs regardless of cost. */
  hardModel: ModelProfile;
  reason: string;
}

const QUALITY_BAR = 0.8;
const EASY_BAR = 0.9; // easy bugs should be nearly perfect even on a cheap model

/**
 * Pick models by EVIDENCE: the default is the highest overall quality that clears
 * the bar, breaking ties toward lower cost then lower latency; the easy-tier model
 * is the cheapest that's near-perfect on easy bugs; the hard-tier is simply the
 * best on hard bugs. Cheaper models for easy bugs, stronger for hard ones.
 */
export function pickModels(profiles: ModelProfile[]): ModelSelection {
  if (profiles.length === 0) throw new Error('pickModels: no model profiles to choose from');

  const qualified = profiles.filter((p) => p.run.meanScore >= QUALITY_BAR);
  const pool = qualified.length > 0 ? qualified : profiles; // fall back if none clear the bar

  const defaultModel = [...pool].sort(
    (a, b) => b.run.meanScore - a.run.meanScore || a.costPer1kUsd - b.costPer1kUsd || a.latencyMsP50 - b.latencyMsP50,
  )[0]!;

  const easyCandidates = profiles.filter((p) => p.run.byDifficulty.easy.meanScore >= EASY_BAR);
  const easyModel = (easyCandidates.length > 0 ? easyCandidates : profiles)
    .slice()
    .sort((a, b) => a.costPer1kUsd - b.costPer1kUsd || b.run.byDifficulty.easy.meanScore - a.run.byDifficulty.easy.meanScore)[0]!;

  const hardModel = [...profiles].sort(
    (a, b) => b.run.byDifficulty.hard.meanScore - a.run.byDifficulty.hard.meanScore || a.costPer1kUsd - b.costPer1kUsd,
  )[0]!;

  return {
    defaultModel,
    easyModel,
    hardModel,
    reason: `default ${defaultModel.provider}/${defaultModel.model} (q=${defaultModel.run.meanScore.toFixed(2)}); ` +
      `easy→${easyModel.provider}/${easyModel.model} ($${easyModel.costPer1kUsd}/1k); ` +
      `hard→${hardModel.provider}/${hardModel.model} (q_hard=${hardModel.run.byDifficulty.hard.meanScore.toFixed(2)})`,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────────

function norm(s: string): string { return s.trim().toLowerCase(); }
function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
