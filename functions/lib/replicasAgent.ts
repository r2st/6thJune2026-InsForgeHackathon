// Replicas — background coding agent at the FIX step (ticket 0044).
//
// Replicas (tryreplicas.com) is NOT session capture. It takes a repo + a
// natural-language task, spins a workspace, runs Claude Code / Codex, and opens
// a PR. That's the same category as Devin — Hush's Fix/ship step.
//
// Verified from docs.tryreplicas.com/api-reference/replica/create-replica:
//   POST https://api.tryreplicas.com/v1/replica
//   Authorization: Bearer <REPLICAS_API_KEY>
//   body: { name, message, environment_id?, coding_agent?: "claude"|"codex", webhook_url? }
//   201 → { replica: { id, status, pull_requests: [{ repository, number, url }] } }
//
// Hush hands Replicas the diagnosis + the insforge.toml diff as the message, so
// the agent lands the policy fix as a reviewable PR. Env-guarded and best-effort:
// with no key it no-ops and the existing openPr/Devin ship path is unaffected.
//
// Ticket: agents/tasks/0044-replicas-is-a-fix-agent-not-capture.md

const REPLICAS_API = process.env.REPLICAS_API_URL ?? 'https://api.tryreplicas.com';

export interface DispatchFixInput {
  /** Short, whitespace-free replica name (pattern ^\S+$). */
  name: string;
  /** The task for the coding agent — diagnosis + the TOML diff to apply. */
  message: string;
  /** Environment that binds the target repo (dashboard → Environments). */
  environmentId?: string;
  codingAgent?: 'claude' | 'codex';
  /** Optional callback when the replica finishes. */
  webhookUrl?: string;
}

export interface DispatchFixResult {
  dispatched: boolean;
  replicaId: string | null;
  /** PR URL if Replicas opened one synchronously; usually arrives later via webhook/poll. */
  prUrl: string | null;
  status: string | null;
  reason?: 'no_key' | 'no_environment' | 'error';
}

/** The HTTP port (injectable for tests). */
export interface ReplicasHttp {
  post(path: string, apiKey: string, body: unknown): Promise<{ ok: boolean; status: number; json: unknown }>;
}

const realHttp: ReplicasHttp = {
  async post(path, apiKey, body) {
    const res = await fetch(`${REPLICAS_API}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let json: unknown = null;
    try { json = await res.json(); } catch { /* non-JSON body */ }
    return { ok: res.ok, status: res.status, json };
  },
};

export interface DispatchDeps {
  apiKey?: string | undefined;
  environmentId?: string | undefined;
  http?: ReplicasHttp;
}

/**
 * Dispatch a fix task to Replicas. Always resolves (never throws) so the ship
 * step can call it without risk. No key / no environment ⇒ a benign no-op so the
 * default openPr/Devin path stays the source of truth.
 */
export async function dispatchFix(
  input: DispatchFixInput,
  deps: DispatchDeps = {},
): Promise<DispatchFixResult> {
  const apiKey = deps.apiKey ?? process.env.REPLICAS_API_KEY;
  const environmentId = deps.environmentId ?? input.environmentId ?? process.env.REPLICAS_ENVIRONMENT_ID;
  const http = deps.http ?? realHttp;

  if (!apiKey) return { dispatched: false, replicaId: null, prUrl: null, status: null, reason: 'no_key' };
  if (!environmentId) return { dispatched: false, replicaId: null, prUrl: null, status: null, reason: 'no_environment' };

  try {
    const { ok, json } = await http.post('/v1/replica', apiKey, {
      name: input.name,
      message: input.message,
      environment_id: environmentId,
      coding_agent: input.codingAgent ?? 'claude',
      ...(input.webhookUrl ? { webhook_url: input.webhookUrl } : {}),
    });
    if (!ok) return { dispatched: false, replicaId: null, prUrl: null, status: null, reason: 'error' };

    const replica = (json as { replica?: Replica })?.replica;
    return {
      dispatched: true,
      replicaId: replica?.id ?? null,
      prUrl: replica?.pull_requests?.[0]?.url ?? null,
      status: replica?.status ?? null,
    };
  } catch {
    return { dispatched: false, replicaId: null, prUrl: null, status: null, reason: 'error' };
  }
}

interface Replica {
  id: string;
  status: string;
  pull_requests?: Array<{ repository: string; number: number; url: string }>;
}
