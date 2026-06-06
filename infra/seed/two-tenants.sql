-- Hush — demo seed.
--
-- Two tenants. Two users (one per tenant). Three orders for tenant A;
-- zero orders for tenant B. The demo bug: user A logs in with a JWT
-- migrated to the new `tenant_ids[]` claim shape, the RLS policy still
-- reads the singular `tenant` claim, and the orders page renders empty
-- even though three rows exist.
--
-- Apply on the branch project at demo start:
--   insforge db seed --branch hush-fix-sandbox --file infra/seed/two-tenants.sql

INSERT INTO tenants (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Acme'),
  ('22222222-2222-2222-2222-222222222222', 'Globex')
ON CONFLICT (id) DO NOTHING;

-- user A → tenant Acme (the demo user)
INSERT INTO orders (id, tenant_id, user_id, total) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-0000000000a1', 12.50),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-0000000000a1', 39.00),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-0000000000a1', 7.25)
ON CONFLICT (id) DO NOTHING;

-- user B → tenant Globex (the cross-tenant safety check — must stay empty)
-- Intentionally no orders for tenant B so a widening patch (lie #04)
-- would surface as "tenant B suddenly sees data."
