-- Hush — demo bug surface + internal tables.
-- Mirrors infra/insforge.toml (the conceptual schema + the thing Hush patches).
--
-- The orders RLS policy is intentionally BUGGY: it reads the singular 'tenant'
-- JWT claim, but the demo user's JWT carries 'tenant_ids' (array). That
-- mismatch returns zero rows → the silent empty-orders-page bug.
--
-- JWT claims reach the DB session via PostgREST's request.jwt.claims GUC.
-- helper hush_jwt_claims() reads it; this is what auth.jwt() wraps under the hood.

-- claim accessor
create or replace function hush_jwt_claims() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  )
$$;

-- tenants
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- orders (the demo bug surface)
create table orders (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  user_id     uuid not null,
  total       numeric(10,2) not null,
  created_at  timestamptz not null default now()
);

alter table orders enable row level security;

-- >>> THE DEMO BUG <<<
-- Reads 'tenant' (singular). The migrated JWT carries 'tenant_ids' (array).
-- Hush's fix adds an OR branch covering the new claim shape.
create policy orders_select on orders
  for select
  using ( tenant_id = (hush_jwt_claims() ->> 'tenant')::uuid );

-- bug_runs (Hush's own ledger; one row per run)
create table bug_runs (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  captured_at         timestamptz not null default now(),
  session_clip_url    text,
  request_log_window  jsonb,
  session_id          text,
  diagnosis           jsonb,
  toml_diff           jsonb,
  confidence          integer,
  tier                text,
  status              text not null default 'captured',
  pr_url              text,
  prompt_version      text,
  embedding           vector(1536)
);

-- bug_decisions (learning loop feedback)
create table bug_decisions (
  id          bigserial primary key,
  run_id      uuid not null references bug_runs(id),
  verdict     text not null,
  closed_at   timestamptz not null default now(),
  closed_by   text
);

-- request_log (the correlation link; ticket 0014)
create table request_log (
  id              bigserial primary key,
  ts              timestamptz not null default now(),
  session_id      text,
  user_id         uuid,
  tenant_id       uuid,
  route           text not null,
  method          text not null,
  rls_decisions   jsonb,
  returned_rows   integer,
  status          integer
);

create index request_log_session_ts_idx on request_log (session_id, ts);
create index request_log_tenant_ts_idx  on request_log (tenant_id, ts);
