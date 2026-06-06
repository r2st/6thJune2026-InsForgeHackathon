// Request-log writer. Any edge function that serves a tenant-scoped
// query calls logRequest() so the correlator can later link a frontend
// frustration signal to the backend decision that caused it.
//
// The `x-hush-session-id` header is set by the toy app's wrapped client
// (apps/demo/lib/hush/insforge-client.ts). Read it off the inbound
// Request and pass it through.
//
// Ticket: agents/tasks/0014-backend-log-correlation.md

import type { RlsDecision } from '../types.js';
import { getClient } from './insforgeClient.js';

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
export function sessionIdFromHeaders(req: Request): string | null {
  return req.headers.get('x-hush-session-id');
}

/** Fire-and-forget insert into request_log. Never throws into the hot path. */
export async function logRequest(input: LogRequestInput): Promise<void> {
  try {
    await getClient()
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
