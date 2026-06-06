import { describe, it, expect } from 'vitest';
import {
  openPr, buildPrTitle, buildPrBody, confidenceColor, confidenceBreakdown,
  ciStatuses, headBranch, type GitHubClient, type OpenPrInput, type PrRef, type CommitStatus,
} from './openPr.js';
import type { Diagnosis, Verdict, ConfidenceResult } from './types.js';

const DIAGNOSIS: Diagnosis = {
  summary: 'The orders policy reads tenant but the JWT migrated to tenant_ids[].',
  expectation: '3 orders', observation: '0 orders',
  failingPolicy: 'orders.orders_select', failingJwtClaim: "auth.jwt() ->> 'tenant'",
  tomlDiff: {
    path: 'tables.orders.rls',
    before: "tenant_id = (auth.jwt() ->> 'tenant')::uuid",
    after: "tenant_id = (auth.jwt() ->> 'tenant')::uuid OR tenant_id = ANY(array(select jsonb_array_elements_text(auth.jwt() -> 'tenant_ids'))::uuid[])",
  },
  widensAccess: false,
  confidenceInputs: { diffLoc: 1, tablesTouched: 1, policyBlast: 1 },
  promptVersion: 'diagnose-v2.0.0',
};

const VERDICT: Verdict = {
  prod: { status: 200, rowsReturned: 0, latencyMs: 5, snippet: '[]' },
  fork: { status: 200, rowsReturned: 3, latencyMs: 6, snippet: '[...]' },
  bugConfirmed: true, fixVerified: true, rationale: 'prod 0/3; fork 3 — reproduced + fixed',
};

const CONF: ConfidenceResult = {
  score: 92, tier: 'pr',
  signals: { replayVerdictScore: 100, diffSizeScore: 95, policyBlastScore: 98, pgvectorSimilarityScore: 89 },
  ceiling: 'pr', promptVersion: 'diagnose-v2.0.0',
};

const INPUT: OpenPrInput = {
  runId: 'run_1', table: 'orders', diagnosis: DIAGNOSIS, verdict: VERDICT, confidence: CONF,
  clipUrl: 'https://store.example/clip?sig=abc', branchUrl: 'https://insforge.example/fork-0', headSha: 'deadbeef',
};

class FakeGitHub implements GitHubClient {
  prs: { number: number; head: string; title: string; body: string }[] = [];
  statuses: { sha: string; status: CommitStatus }[] = [];
  seedExisting?: PrRef;
  async findOpenPr(head: string): Promise<PrRef | null> {
    if (this.seedExisting) return this.seedExisting;
    const found = this.prs.find((p) => p.head === head);
    return found ? { number: found.number, html_url: `https://gh/pr/${found.number}` } : null;
  }
  async createPr(input: { head: string; title: string; body: string }): Promise<PrRef> {
    const number = this.prs.length + 1;
    this.prs.push({ number, ...input });
    return { number, html_url: `https://gh/pr/${number}` };
  }
  async updatePr(number: number, input: { title: string; body: string }): Promise<PrRef> {
    return { number, html_url: `https://gh/pr/${number}` };
  }
  async setCommitStatus(sha: string, status: CommitStatus): Promise<void> {
    this.statuses.push({ sha, status });
  }
}

describe('pure builders', () => {
  it('title is policy(<table>): <one-liner>', () => {
    expect(buildPrTitle('orders', DIAGNOSIS.summary)).toBe(`policy(orders): ${DIAGNOSIS.summary}`);
  });

  it('clips an overlong summary in the title', () => {
    const t = buildPrTitle('orders', 'x'.repeat(200));
    expect(t.length).toBeLessThanOrEqual(`policy(orders): `.length + 72);
    expect(t).toMatch(/…$/);
  });

  it('confidence colour bands: green ≥85, amber 60–84, purple <60', () => {
    expect(confidenceColor(92)).toBe('green');
    expect(confidenceColor(85)).toBe('green');
    expect(confidenceColor(84)).toBe('amber');
    expect(confidenceColor(60)).toBe('amber');
    expect(confidenceColor(59)).toBe('purple');
  });

  it('renders the confidence breakdown with all four signals', () => {
    const b = confidenceBreakdown(CONF);
    expect(b).toBe('92% (green) = replay(100) · diff(95) · blast(98) · similarity(89)');
  });

  it('body embeds diff, clip, branch link, and trace in fixed order', () => {
    const body = buildPrBody(INPUT);
    const order = ['**What broke**', '**The fix**', '**Proof it works**', '**Session replay**', '**Poke at it**', '**Confidence**'];
    const positions = order.map((h) => body.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions]).toEqual([...positions].sort((a, b) => a - b)); // monotonic
    expect(body).toContain(INPUT.clipUrl);
    expect(body).toContain(INPUT.branchUrl);
    expect(body).toContain(DIAGNOSIS.tomlDiff.after);
  });

  it('ci statuses derive three checks from the verdict', () => {
    const s = ciStatuses(VERDICT, CONF);
    expect(s.map((x) => x.context)).toEqual([
      'hush/branch-project-replay', 'hush/existing-tests', 'hush/no-policy-blast',
    ]);
    expect(s.every((x) => x.state === 'success')).toBe(true);
  });

  it('marks the replay check failure when the fix is not verified', () => {
    const bad: Verdict = { ...VERDICT, fixVerified: false, bugConfirmed: false };
    const s = ciStatuses(bad, CONF);
    expect(s[0]!.state).toBe('failure');
    expect(s[1]!.state).toBe('pending');
  });
});

describe('openPr', () => {
  it('creates a PR and posts three commit statuses on first run', async () => {
    const gh = new FakeGitHub();
    const r = await openPr(INPUT, gh);
    expect(r.isUpdate).toBe(false);
    expect(r.prUrl).toBe('https://gh/pr/1');
    expect(gh.statuses).toHaveLength(3);
    expect(gh.statuses.every((s) => s.sha === 'deadbeef')).toBe(true);
  });

  it('is idempotent — re-running edits the existing PR instead of duplicating', async () => {
    const gh = new FakeGitHub();
    gh.seedExisting = { number: 7, html_url: 'https://gh/pr/7' };
    const r = await openPr(INPUT, gh);
    expect(r.isUpdate).toBe(true);
    expect(r.prUrl).toBe('https://gh/pr/7');
    expect(gh.prs).toHaveLength(0); // never created
  });

  it('uses the deterministic head branch as the idempotency key', () => {
    expect(headBranch('run_1')).toBe('hush/fix-run_1');
  });
});
