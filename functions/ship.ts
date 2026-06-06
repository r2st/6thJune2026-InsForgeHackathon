// functions/ship.ts
//
// The integration that turns openPr.ts (ticket 0011) from a tested-but-unwired
// module into the orchestrator's real ship step. fix-trigger's default `ship`
// was a stub returning prUrl:null; this wires it to GitHub.
//
// Two halves:
//   1. createGitHubClient() — a concrete GitHubClient over the GitHub REST API
//      (the interface openPr() depends on; only injected in tests before now).
//   2. defaultShip() — maps a ShipDecision to OpenPrInput and opens/updates the
//      PR. Env-guarded and best-effort: with no GITHUB_TOKEN/GITHUB_REPO it
//      returns { prUrl: null } so a run never breaks for lack of GitHub config,
//      and any GitHub error is swallowed to null rather than failing the loop.
//
// The 'issue' tier does not open a PR (the dispatch already records the tier);
// PRs are for 'pr' and 'draft_pr' only.

import { openPr, type GitHubClient, type OpenPrInput, type PrRef, type CommitStatus } from './openPr.js';
import type { ShipDecision } from './fix-trigger.js';

const GITHUB_API = process.env.GITHUB_API_URL ?? 'https://api.github.com';

/** Concrete GitHubClient over REST. `repo` is "owner/name". */
export function createGitHubClient(repo: string, token: string, base = 'main'): GitHubClient {
  const owner = repo.split('/')[0]!;
  const h = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  return {
    async findOpenPr(head: string): Promise<PrRef | null> {
      const res = await fetch(
        `${GITHUB_API}/repos/${repo}/pulls?head=${encodeURIComponent(`${owner}:${head}`)}&state=open`,
        { headers: h },
      );
      if (!res.ok) return null;
      const rows = (await res.json()) as PrRef[];
      return rows[0] ?? null;
    },
    async createPr(input: { head: string; title: string; body: string }): Promise<PrRef> {
      const res = await fetch(`${GITHUB_API}/repos/${repo}/pulls`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ base, head: input.head, title: input.title, body: input.body }),
      });
      if (!res.ok) throw new Error(`createPr ${res.status}: ${await res.text()}`);
      return (await res.json()) as PrRef;
    },
    async updatePr(number: number, input: { title: string; body: string }): Promise<PrRef> {
      const res = await fetch(`${GITHUB_API}/repos/${repo}/pulls/${number}`, {
        method: 'PATCH',
        headers: h,
        body: JSON.stringify({ title: input.title, body: input.body }),
      });
      if (!res.ok) throw new Error(`updatePr ${res.status}: ${await res.text()}`);
      return (await res.json()) as PrRef;
    },
    async setCommitStatus(sha: string, status: CommitStatus): Promise<void> {
      await fetch(`${GITHUB_API}/repos/${repo}/statuses/${sha}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          context: status.context,
          state: status.state,
          description: status.description.slice(0, 140),
        }),
      });
    },
  };
}

/** `"orders.orders_select"` → `"orders"`; falls back to the diff path's table. */
export function tableFromDecision(decision: ShipDecision): string {
  const policy = decision.diagnosis.failingPolicy;
  if (policy.includes('.')) return policy.split('.')[0]!;
  const path = decision.diagnosis.tomlDiff.path; // e.g. "tables.orders.rls"
  const m = path.match(/tables\.([^.]+)/);
  return m ? m[1]! : policy;
}

/** Map the orchestrator's decision to openPr's input, deriving artifact links
 *  from env conventions (clip in Storage, fork dashboard link, head sha). */
export function toOpenPrInput(decision: ShipDecision): OpenPrInput {
  const insforgeUrl = process.env.INSFORGE_URL ?? '';
  return {
    runId: decision.runId,
    table: tableFromDecision(decision),
    diagnosis: decision.diagnosis,
    verdict: decision.verdict,
    confidence: decision.confidence,
    clipUrl:
      process.env.HUSH_CLIP_URL ??
      (insforgeUrl ? `${insforgeUrl}/storage/v1/object/public/clips/${decision.runId}.json` : 'about:blank'),
    branchUrl:
      process.env.HUSH_BRANCH_URL ??
      (insforgeUrl ? `${insforgeUrl}/dashboard/branches/${decision.runId}` : 'about:blank'),
    headSha: process.env.GITHUB_HEAD_SHA ?? decision.runId,
  };
}

export interface ShipResult { prUrl: string | null }

/**
 * The orchestrator's real ship step. Env-guarded and best-effort.
 * @param client injectable for tests; defaults to a REST client from env.
 */
export async function defaultShip(decision: ShipDecision, client?: GitHubClient): Promise<ShipResult> {
  if (decision.tier === 'issue') return { prUrl: null }; // no PR for issue tier

  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  const gh = client ?? (repo && token ? createGitHubClient(repo, token) : null);
  if (!gh) return { prUrl: null }; // GitHub not configured — degrade cleanly

  try {
    const result = await openPr(toOpenPrInput(decision), gh);
    return { prUrl: result.prUrl };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[hush] ship: openPr failed, returning null', err);
    return { prUrl: null };
  }
}
