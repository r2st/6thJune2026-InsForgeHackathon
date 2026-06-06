# Testing backend

A live InsForge project carries the Hush demo bug surface so backend tickets
test against real data instead of mocks.

## The project

| | |
|---|---|
| Name | `hush` |
| OSS Host | `https://w369egnp.us-east.insforge.app` |
| Region | us-east |
| Backend version | **1.0.0** |

> Not to be confused with `https://z739c3mi.insforge.site/` — that's **Authmatic**,
> an unrelated prior project. It is not a Hush test surface.

Link the directory (one-time, per machine):

```bash
npx @insforge/cli link   # select org → project "hush"
```

`.insforge/project.json` holds the admin key and is gitignored. Never commit it.

## What's provisioned

| Object | State |
|---|---|
| `tenants` | Acme (`1111…`), Globex (`2222…`) |
| `orders` | Acme has 3 orders; Globex has 0 (the cross-tenant widening tripwire) |
| `orders` RLS | **buggy** `orders_select` policy — reads `tenant` (singular) |
| `bug_runs` | 1 seeded run (`sess-demo-001`, status `captured`) + `vector(1536)` embedding col |
| `bug_decisions` | empty |
| `request_log` | 1 seeded row for `sess-demo-001` showing `rows_before:3, rows_after:0` |
| storage `clips` | private bucket |
| extension `vector` | enabled (pgvector) |

Schema lives in [`migrations/20260606191953_hush-bug-surface.sql`](../migrations/20260606191953_hush-bug-surface.sql).
It mirrors [`infra/insforge.toml`](../infra/insforge.toml) (the conceptual schema +
the thing Hush patches).

## Reproduce the bug (predicate-level proof)

The CLI's `db query` runs as admin (bypasses RLS) and blocks session-role
changes, so we evaluate the policy predicate directly against both JWT claim
shapes — which is exactly what Hush's replay step computes:

```bash
npx @insforge/cli db query "
with claims_new as (select '{\"tenant_ids\":[\"11111111-1111-1111-1111-111111111111\"]}'::jsonb c),
     claims_old as (select '{\"tenant\":\"11111111-1111-1111-1111-111111111111\"}'::jsonb c)
select
  (select count(*)::int from orders, claims_new where tenant_id = (c->>'tenant')::uuid) as buggy_new_jwt,
  (select count(*)::int from orders, claims_old where tenant_id = (c->>'tenant')::uuid) as buggy_old_jwt,
  (select count(*)::int from orders, claims_new
     where tenant_id = (c->>'tenant')::uuid
        or tenant_id = any(array(select jsonb_array_elements_text(c->'tenant_ids'))::uuid[])) as patched_new_jwt
"
```

Expected — and confirmed on 2026-06-06:

| column | value | meaning |
|---|---|---|
| `buggy_new_jwt` | **0** | the silent empty-orders bug |
| `buggy_old_jwt` | 3 | what the old claim shape returned |
| `patched_new_jwt` | **3** | Hush's fix verified |

`buggy_new_jwt = 0` and `patched_new_jwt = 3` is the prod-fails / fork-passes
verdict, the load-bearing signal the whole pipeline is built to produce.

## Headless end-to-end harness

[`functions/e2e-trace.test.ts`](../functions/e2e-trace.test.ts) drives the whole
pipeline against this live backend — no UI, no fork needed. It pulls the real
`orders` rows, builds the captured request (JWT migrated to `tenant_ids[]`), and
runs traceReplay (0012) → safety (0021) → score (0020) → trace tier-cap, asserting
the verdict end to end.

```bash
cd functions && npx vitest run e2e-trace.test.ts
```

Confirmed 2026-06-06 against the live backend:

```
[e2e] live rows=3 · prod=0 fork=3 · bug=true fix=true · widens=false · score=90 · tier=draft_pr (trace)
```

Score 90 would be PR tier, but trace mode correctly caps it to `draft_pr` — the
"a trace never opens a PR" honesty rule, enforced. If the CLI isn't linked/authed
(e.g. CI without secrets) the test **skips** rather than fails, so it never blocks
the unit suite.

## Known limitation — no branch projects yet

Backend is **1.0.0**; InsForge branching needs **2.1.0+**. The fork-and-test
moat (tickets 0004 / 0006 / 0033 / 0034) cannot run against this project until
it's upgraded. Until then:

- Read-path tickets (0014 correlate, 0018/0019 diagnose, 0022 receipt card)
  test against the seeded rows above.
- Pure-logic tickets (0021 safety, 0020/0035 score, 0032 validate) test via
  their vitest suites — no backend needed.
- The replay/verdict tickets fall back to the trace-only path (ticket 0012):
  evaluate the patched predicate against the captured request, exactly as the
  reproduce-the-bug query above does.

Ask the InsForge team to bump this project to ≥2.1.0 to unlock real branching.

## Reset / reseed

```bash
# wipe rows, keep schema
npx @insforge/cli db query "truncate bug_decisions, bug_runs, request_log, orders, tenants restart identity cascade"
# then re-run the seed block from the migration's companion (see git history of this doc)
```
