import { describe, it, expect, vi } from 'vitest';
import { defaultShip, tableFromDecision, toOpenPrInput, createGitHubClient } from './ship.js';
import type { GitHubClient, PrRef, CommitStatus } from './openPr.js';
import type { ShipDecision } from './fix-trigger.js';
import type { Diagnosis, Verdict, ConfidenceResult } from './types.js';

const DIAGNOSIS: Diagnosis = {
  summary: 'The orders policy reads tenant but the JWT migrated to tenant_ids[].',
  expectation: '3 orders', observation: '0 orders',
  failingPolicy: 'orders.orders_select', failingJwtClaim: "auth.jwt() ->> 'tenant'",
  tomlDiff: {
    path: 'tables.orders.rls',
    before: "tenant_id = (auth.jwt() ->> 'tenant')::uuid",
    after: "tenant_id = (auth.jwt() ->> 'tenant')::uuid OR ...",
  },
  widensAccess: false,
  confidenceInputs: { diffLoc: 1, tablesTouched: 1, policyBlast: 1 },
  promptVersion: 'diagnose-v2.0.0',
};
const VERDICT: Verdict = {
  prod: { status: 200, rowsReturned: 0, latencyMs: 5, snippet: '[]' },
  fork: { status: 200, rowsReturned: 3, latencyMs: 6, snippet: '[...]' },
  bugConfirmed: true, fixVerified: true, rationale: 'prod 0; fork 3',
};
const CONF: ConfidenceResult = {
  score: 92, tier: 'pr',
  signals: { replayVerdictScore: 100, diffSizeScore: 95, policyBlastScore: 98, pgvectorSimilarityScore: 89 },
  ceiling: 'pr', promptVersion: 'diagnose-v2.0.0',
};
const decision = (tier: ConfidenceResult['tier'] = 'pr'): ShipDecision => ({
  runId: 'run_1', tier, diagnosis: DIAGNOSIS, verdict: VERDICT, confidence: { ...CONF, tier },
});

class FakeGitHub implements GitHubClient {
  created: { head: string; title: string }[] = [];
  updated = 0;
  statuses: CommitStatus[] = [];
  seed?: PrRef;
  async findOpenPr(): Promise<PrRef | null> { return this.seed ?? null; }
  async createPr(input: { head: string; title: string; body: string }): Promise<PrRef> {
    this.created.push({ head: input.head, title: input.title });
    return { number: 7, html_url: 'https://gh/pr/7' };
  }
  async updatePr(number: number): Promise<PrRef> { this.updated++; return { number, html_url: `https://gh/pr/${number}` }; }
  async setCommitStatus(_sha: string, status: CommitStatus): Promise<void> { this.statuses.push(status); }
}

describe('tableFromDecision', () => {
  it('reads the table from the policy name', () => {
    expect(tableFromDecision(decision())).toBe('orders');
  });
  it('falls back to the diff path table', () => {
    const d = decision();
    d.diagnosis = { ...DIAGNOSIS, failingPolicy: 'orders_select' };
    expect(tableFromDecision(d)).toBe('orders');
  });
});

describe('toOpenPrInput', () => {
  it('maps decision fields and derives artifact links', () => {
    const input = toOpenPrInput(decision());
    expect(input.runId).toBe('run_1');
    expect(input.table).toBe('orders');
    expect(input.diagnosis).toBe(DIAGNOSIS);
    expect(typeof input.clipUrl).toBe('string');
    expect(typeof input.branchUrl).toBe('string');
    expect(input.headSha).toBeTruthy();
  });
});

describe('defaultShip', () => {
  it('opens a PR via the injected client on the pr tier', async () => {
    const gh = new FakeGitHub();
    const res = await defaultShip(decision('pr'), gh);
    expect(res.prUrl).toBe('https://gh/pr/7');
    expect(gh.created).toHaveLength(1);
    expect(gh.created[0]!.head).toBe('hush/fix-run_1');
    expect(gh.statuses.length).toBe(3); // three CI checks posted
  });

  it('updates the existing PR (idempotent) instead of duplicating', async () => {
    const gh = new FakeGitHub();
    gh.seed = { number: 7, html_url: 'https://gh/pr/7' };
    const res = await defaultShip(decision('pr'), gh);
    expect(res.prUrl).toBe('https://gh/pr/7');
    expect(gh.created).toHaveLength(0);
    expect(gh.updated).toBe(1);
  });

  it('does NOT open a PR for the issue tier', async () => {
    const gh = new FakeGitHub();
    const res = await defaultShip(decision('issue'), gh);
    expect(res.prUrl).toBeNull();
    expect(gh.created).toHaveLength(0);
  });

  it('degrades to null when GitHub is not configured (no client, no env)', async () => {
    const prev = {
      repo: process.env.GITHUB_REPO,
      devinRepo: process.env.DEVIN_TARGET_REPO,
      token: process.env.GITHUB_TOKEN,
    };
    delete process.env.GITHUB_REPO;
    delete process.env.DEVIN_TARGET_REPO;
    delete process.env.GITHUB_TOKEN;
    const res = await defaultShip(decision('pr'));
    expect(res.prUrl).toBeNull();
    if (prev.repo) process.env.GITHUB_REPO = prev.repo;
    if (prev.devinRepo) process.env.DEVIN_TARGET_REPO = prev.devinRepo;
    if (prev.token) process.env.GITHUB_TOKEN = prev.token;
  });

  it('swallows a GitHub error into null (never breaks the run)', async () => {
    const boom: GitHubClient = {
      findOpenPr: async () => null,
      createPr: async () => { throw new Error('502'); },
      updatePr: async () => ({ number: 1, html_url: '' }),
      setCommitStatus: async () => {},
    };
    const res = await defaultShip(decision('pr'), boom);
    expect(res.prUrl).toBeNull();
  });
});

describe('createGitHubClient', () => {
  it('finds an open PR by owner:head', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => [{ number: 9, html_url: 'https://gh/pr/9' }] } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createGitHubClient('acme/store', 'tok');
    const pr = await client.findOpenPr('hush/fix-run_1');
    expect(pr?.number).toBe(9);
    expect(calls[0]).toContain('acme%3Ahush%2Ffix-run_1');
    vi.unstubAllGlobals();
  });
});
