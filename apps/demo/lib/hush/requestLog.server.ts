// apps/demo/lib/hush/requestLog.server.ts
//
// Server-side request_log writer for the toy app (ticket 0016 + 0014).
//
// Mirrors functions/lib/requestLog.ts — replicated here, not cross-imported,
// because functions/ is a separate workspace package with its own build. The
// row shape MUST stay identical to the canonical writer so correlate() can read
// it: same columns, same rls_decisions = [{ policy, rows_before, rows_after }].
//
// Without this call on the orders read path, request_log stays empty,
// correlate() returns no_logs, and every run lands captured_no_logs — the
// symptom→cause link breaks. This is the server half the demo bug needs.

import { createAdminClient } from '@insforge/sdk';

export interface RlsDecision {
  policy: string;
  rows_before: number;
  rows_after: number;
}

export interface LogRequestInput {
  sessionId: string | null;
  userId: string | null;
  tenantId: string | null;
  route: string;
  method: string;
  rlsDecisions?: RlsDecision[] | null;
  returnedRows: number | null;
  status: number;
}

/** Read the session id the toy app stamps on every request. */
export function sessionIdFromHeaders(headers: Headers): string | null {
  return headers.get('x-hush-session-id');
}

/**
 * Fire-and-forget insert into request_log. Never throws into the hot path.
 * No-ops cleanly when the service key is absent (e.g. local dev without a
 * linked backend) so the page still renders.
 */
export async function logRequest(input: LogRequestInput): Promise<void> {
  const baseUrl = process.env.INSFORGE_URL;
  const apiKey = process.env.INSFORGE_SERVICE_KEY;
  if (!baseUrl || !apiKey) return; // no backend wired — skip silently

  try {
    await createAdminClient({ baseUrl, apiKey })
      .database.from('request_log')
      .insert({
        session_id: input.sessionId,
        user_id: input.userId,
        tenant_id: input.tenantId,
        route: input.route,
        method: input.method,
        rls_decisions: input.rlsDecisions ?? null,
        returned_rows: input.returnedRows,
        status: input.status,
      });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[hush] request_log insert failed', err);
  }
}
