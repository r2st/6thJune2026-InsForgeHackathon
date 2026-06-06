// apps/demo/app/api/orders/route.ts
//
// The orders read path (ticket 0016). Serves the logged-in user's orders under
// the BUGGY production policy and — critically — logs the RLS decision to
// request_log so Hush's correlate() can later link the empty page to the policy
// that filtered it.
//
// Query: /api/orders?user=legacy | migrated
//   legacy   → 3 rows  (policy reads `tenant`, which this user has)
//   migrated → 0 rows  (user's JWT migrated to `tenant_ids[]`; policy can't see it)

import { NextResponse } from 'next/server';
import {
  ACME,
  ACME_ORDERS,
  DEMO_USER,
  ordersUnderBuggyPolicy,
  type UserShape,
} from '../../../lib/hush/orders-fixture';
import { logRequest, sessionIdFromHeaders } from '../../../lib/hush/requestLog.server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const shape: UserShape = url.searchParams.get('user') === 'migrated' ? 'migrated' : 'legacy';

  // rows_before = what the user *should* see (all their tenant's orders);
  // rows_after  = what the buggy policy actually returns.
  const rowsBefore = ACME_ORDERS.length;
  const visible = ordersUnderBuggyPolicy(shape);
  const rowsAfter = visible.length;

  // Log the decision so correlate() can find it from the frustration signal.
  await logRequest({
    sessionId: sessionIdFromHeaders(req.headers),
    userId: DEMO_USER,
    tenantId: ACME,
    route: '/api/orders',
    method: 'GET',
    rlsDecisions: [{ policy: 'orders.orders_select', rows_before: rowsBefore, rows_after: rowsAfter }],
    returnedRows: rowsAfter,
    status: 200,
  });

  return NextResponse.json({ orders: visible });
}
