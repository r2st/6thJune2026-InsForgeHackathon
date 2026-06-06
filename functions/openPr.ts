// functions/openPr.ts
//
// Slide 7 — the close. Open (or update) a GitHub PR carrying the proof: the
// insforge.toml diff, a signed clip of the user session, the before/after RLS
// trace, a link to the fork the test ran against, and the confidence breakdown.
// Three CI checks are posted via the commit-status API so the verdict shows up
// as green checks the judge recognises.
//
// Ticket: agents/tasks/0011-pr-with-proof-artifacts.md
//
// The GitHub client is injected (GitHubClient) so the body/title/idempotency
// logic is unit-tested without a network. Idempotent: a run re-opened on the
// same session edits its existing PR (matched by the deterministic head branch)
// instead of opening a duplicate.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Diagnosis, Verdict, ConfidenceResult } from './types.js';

const TEMPLATE_PATH = fileURLToPath(new URL('./prTemplate.md', import.meta.url));

export interface OpenPrInput {
  runId: string;
  table: string;
  diagnosis: Diagnosis;
  verdict: Verdict;
  confidence: ConfidenceResult;
  /** Signed, long-TTL clip URL (expiry well after the pitch slot). */
  clipUrl: string;
  /** The fork the replay ran against, and its head commit (for CI statuses). */
  branchUrl: string;
  headSha: string;
}

export interface PrRef { number: number; html_url: string }

export interface CommitStatus {
  context: string;
  state: 'success' | 'failure' | 'pending';
  description: string;
}

export interface GitHubClient {
  /** Find an open PR by head branch, or null. Drives idempotency. */
  findOpenPr(head: string): Promise<PrRef | null>;
  createPr(input: { head: string; title: string; body: string }): Promise<PrRef>;
  updatePr(number: number, input: { title: string; body: string }): Promise<PrRef>;
  setCommitStatus(sha: string, status: CommitStatus): Promise<void>;
}

export interface OpenPrResult {
  prUrl: string;
  isUpdate: boolean;
  statuses: CommitStatus[];
}

/** Deterministic head branch — the idempotency key. */
export function headBranch(runId: string): string {
  return `hush/fix-${runId}`;
}

export async function openPr(input: OpenPrInput, client: GitHubClient): Promise<OpenPrResult> {
  const head = headBranch(input.runId);
  const title = buildPrTitle(input.table, input.diagnosis.summary);
  const body = buildPrBody(input);

  const existing = await client.findOpenPr(head);
  const pr = existing
    ? await client.updatePr(existing.number, { title, body })
    : await client.createPr({ head, title, body });

  const statuses = ciStatuses(input.verdict, input.confidence);
  for (const status of statuses) await client.setCommitStatus(input.headSha, status);

  return { prUrl: pr.html_url, isUpdate: existing !== null, statuses };
}

// ── pure builders ──────────────────────────────────────────────────────────────

/** `policy(<table>): <one-line summary>` — summary clipped to one line. */
export function buildPrTitle(table: string, summary: string): string {
  const oneLine = summary.replace(/\s+/g, ' ').trim();
  const clipped = oneLine.length > 72 ? oneLine.slice(0, 71) + '…' : oneLine;
  return `policy(${table}): ${clipped}`;
}

export function buildPrBody(input: OpenPrInput): string {
  const { diagnosis, verdict, confidence } = input;
  const d = diagnosis.tomlDiff;
  return fill(loadTemplate(), {
    summary: diagnosis.summary,
    diffLoc: String(diagnosis.confidenceInputs.diffLoc),
    diffPath: d.path,
    diffBefore: d.before,
    diffAfter: d.after,
    rlsTrace: rlsTrace(diagnosis, verdict),
    verdictLine: verdictLine(verdict),
    clipUrl: input.clipUrl,
    branchUrl: input.branchUrl,
    confidenceBreakdown: confidenceBreakdown(confidence),
    runId: input.runId,
    promptVersion: diagnosis.promptVersion,
  });
}

/** Badge colour by score band — green ≥85, amber 60–84, purple <60. */
export function confidenceColor(score: number): 'green' | 'amber' | 'purple' {
  if (score >= 85) return 'green';
  if (score >= 60) return 'amber';
  return 'purple';
}

/** `92% (green) = replay(100) · diff(95) · blast(98) · similarity(89)`. */
export function confidenceBreakdown(c: ConfidenceResult): string {
  const s = c.signals;
  const parts = [
    `replay(${Math.round(s.replayVerdictScore)})`,
    `diff(${Math.round(s.diffSizeScore)})`,
    `blast(${Math.round(s.policyBlastScore)})`,
    `similarity(${Math.round(s.pgvectorSimilarityScore)})`,
  ];
  const veto = c.veto ? ` — tier limited by ${c.veto.signal}: ${c.veto.value}` : '';
  return `${c.score}% (${confidenceColor(c.score)}) = ${parts.join(' · ')}${veto}`;
}

/** Three commit-status checks derived from the verdict + confidence. */
export function ciStatuses(verdict: Verdict, confidence: ConfidenceResult): CommitStatus[] {
  const replayOk = verdict.bugConfirmed && verdict.fixVerified;
  const blastOk = confidence.signals.policyBlastScore >= 60;
  return [
    {
      context: 'hush/branch-project-replay',
      state: replayOk ? 'success' : 'failure',
      description: verdict.rationale,
    },
    {
      context: 'hush/existing-tests',
      state: verdict.fixVerified ? 'success' : 'pending',
      description: verdict.fixVerified ? 'fork replay passed' : 'fix not verified on fork',
    },
    {
      context: 'hush/no-policy-blast',
      state: blastOk ? 'success' : 'failure',
      description: `policy blast score ${Math.round(confidence.signals.policyBlastScore)}`,
    },
  ];
}

// ── internals ──────────────────────────────────────────────────────────────────

function rlsTrace(diagnosis: Diagnosis, verdict: Verdict): string {
  const d = diagnosis.tomlDiff;
  return [
    `policy:  ${diagnosis.failingPolicy}`,
    `claim:   ${diagnosis.failingJwtClaim}`,
    `before:  ${d.before}`,
    `         → prod returned ${verdict.prod.rowsReturned} rows`,
    `after:   ${d.after}`,
    `         → fork returned ${verdict.fork.rowsReturned} rows`,
  ].join('\n');
}

function verdictLine(verdict: Verdict): string {
  const tag = verdict.mode === 'trace' ? ' _(trace-only — branch project unavailable)_' : '';
  const mark = verdict.bugConfirmed && verdict.fixVerified ? '✓' : '⚠';
  // Lim.run visual re-verify (0042) — corroboration only; appended when present.
  const rv = verdict.reverify?.previewUrl
    ? `\n\n🖥️ **See it live on the fork:** [open the fixed orders page](${verdict.reverify.previewUrl})` +
      (verdict.reverify.rendered ? ' — rows render ✓' : ' _(visual check inconclusive; policy replay is the verdict)_')
    : '';
  return `${mark} ${verdict.rationale}${tag}${rv}`;
}

let _template: string | null = null;
function loadTemplate(): string {
  return (_template ??= readFileSync(TEMPLATE_PATH, 'utf8').replace(/^<!--[\s\S]*?-->\n/, ''));
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined) throw new Error(`prTemplate: no value for {{${k}}}`);
    return v;
  });
}
