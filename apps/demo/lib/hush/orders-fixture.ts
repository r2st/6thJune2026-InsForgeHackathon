// apps/demo/lib/hush/orders-fixture.ts
//
// The demo's two users and the orders that exist for them. Mirrors
// infra/seed/demo.sql exactly (same ids, same totals) so the toy app and the
// backend agree on "3 orders for Acme."
//
// The two JWT shapes are the whole story:
//   legacy   → { tenant: "<acme uuid>" }      policy matches  → sees 3 orders
//   migrated → { tenant_ids: ["<acme uuid>"] } policy can't read it → sees 0
// Same data, same person, one claim shape apart.

export const ACME = '11111111-1111-1111-1111-111111111111';
export const DEMO_USER = '00000000-0000-0000-0000-0000000000a1';

export interface Order {
  id: string;
  tenant_id: string;
  user_id: string;
  total: number;
}

export const ACME_ORDERS: Order[] = [
  { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', tenant_id: ACME, user_id: DEMO_USER, total: 12.5 },
  { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', tenant_id: ACME, user_id: DEMO_USER, total: 39.0 },
  { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', tenant_id: ACME, user_id: DEMO_USER, total: 7.25 },
];

export type UserShape = 'legacy' | 'migrated';

/** The JWT claims each demo user carries. */
export function claimsFor(shape: UserShape): Record<string, unknown> {
  return shape === 'legacy' ? { tenant: ACME } : { tenant_ids: [ACME] };
}

/**
 * The buggy production policy: `tenant_id = (auth.jwt() ->> 'tenant')::uuid`.
 * It reads the singular `tenant` claim only. Returns the rows that policy lets
 * through for the given user — 3 for legacy, 0 for migrated.
 */
export function ordersUnderBuggyPolicy(shape: UserShape): Order[] {
  const claims = claimsFor(shape);
  const tenant = claims['tenant'];
  if (typeof tenant !== 'string') return []; // migrated user: no `tenant` claim → filtered to 0
  return ACME_ORDERS.filter((o) => o.tenant_id === tenant);
}
