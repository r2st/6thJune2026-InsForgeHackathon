-- infra/seed/demo.sql — deterministic demo fixture (ticket 0010).
--
-- Two tenants (Acme, Globex). Three orders for Acme. Zero for Globex.
-- Applied to the demo prod project at boot and to every pre-warmed fork at
-- provisioning, so prod and fork start from identical data.
--
-- THE DEMO CONTRACT:
--   prod  → orders page returns 0 rows  (policy reads the legacy `tenant`
--           claim; the demo user's JWT migrated to `tenant_ids[]`)  → STILL BUGGY
--   fork  → orders page returns 3 rows  (patched policy reads both shapes) → FIX WORKS
--
-- The "3" must be deterministic — this seed is the only thing that guarantees
-- it. Idempotent: truncates then inserts, so re-running can't drift the count.
--
-- Apply:  scripts/seed.sh --env prod
--         scripts/seed.sh --env <branchId>

BEGIN;

TRUNCATE orders, tenants RESTART IDENTITY CASCADE;

INSERT INTO tenants (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Acme'),
  ('22222222-2222-2222-2222-222222222222', 'Globex');

-- Three orders, all for Acme, all owned by the demo user.
-- This is the "3" slide 06 hinges on.
INSERT INTO orders (id, tenant_id, user_id, total) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-0000000000a1', 12.50),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-0000000000a1', 39.00),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-0000000000a1', 7.25);

-- Globex intentionally has zero orders: the cross-tenant safety check. A
-- widening patch would surface here as "Globex suddenly sees Acme's rows."

COMMIT;
