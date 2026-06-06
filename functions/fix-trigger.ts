// functions/fix-trigger.ts
// Orchestrates the diagnose → test → ship sequence after ingest() has captured
// a session. Called synchronously from ingest() with the new run id.
//
// Steps (matches docs/deployment.md §5):
//   1. Load the bug_runs row + correlated request log.
//   2. Pull the current TOML slice for the implicated table via toml.extractTomlContext().
//   3. Call diagnose() — InsForge AI generates the structured Diagnosis.
//   4. Run safety.validateDiff() on the proposed TomlPatch — override widensAccess
//      if the deterministic check disagrees with the model's self-report.
//   5. Claim a fork from the prewarm pool (.hush/pool.json).
//   6. applyDiff() the TomlPatch on the fork; forgeJwt() for the fork's audience.
//   7. replay.replayBoth() against prod + fork → Verdict.
//   8. score.scoreConfidence(diagnosis, verdict) → ConfidenceResult.
//   9. Dispatch by tier:
//        'pr'       → Devin opens PR with the diff and the clip
//        'draft_pr' → Devin opens draft PR with failing trace, no fix
//        'issue'    → GitHub issue with the clip and log diff
//  10. Update bug_runs.status, pr_url, tier. Broadcast 'shipped' or 'failed'.
//
// Owner: <unclaimed — coordinates 0018, 0019, 0020, 0021, 0007, 0008, 0006, 0004>

import type { BugRun, ConfidenceResult, Verdict } from './types.js';

export async function fixTrigger(_runId: string): Promise<{ runId: string; tier: ConfidenceResult['tier']; prUrl: string | null }> {
  // TODO: orchestrate the pipeline. Keep this function flat — the substeps
  // each live in their own file and have their own ticket.
  throw new Error('not implemented');
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const { runId } = await req.json() as { runId: string };
  const result = await fixTrigger(runId);
  return Response.json(result);
}

export type { BugRun, ConfidenceResult, Verdict };
