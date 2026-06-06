# Testing backend

A live InsForge project carries the Hush demo bug surface so backend tickets
test against real data instead of mocks.

## The project

| | |
|---|---|
| Name | `hush` |
| OSS Host | `https://w369egnp.us-east.insforge.app` |
| Health check | `https://w369egnp.us-east.insforge.app/api/health` → `{"status":"ok",...}` (bare `/` returns `Cannot GET /` — API host, no homepage; not an outage) |
| Region | us-east |
| Backend version | **2.2.0** (per `/api/health` 2026-06-06) |

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

## Branching is available — the real fork path works

Backend is **2.2.0** (per `/api/health`, verified 2026-06-06) and InsForge
branching (needs ≥2.1.0) **is live**. A fork already exists:

```bash
npx @insforge/cli branch list
# → hush-fix-sandbox · ready · full
```

So the fork-and-test moat (tickets 0004 / 0006 / 0033 / 0034) and the slide-06
"prod red / fork green" money shot can run for **real**, not just in trace mode.

> Historical note: an earlier read of `cli metadata` reported `version: 1.0.0`
> (that field is the API-schema version, not the backend release) which led to a
> now-corrected "no branching" assumption. `/api/health` is the authoritative
> backend version.

Each test path:

- **Real fork** (preferred): apply the candidate patch to a branch project,
  replay the captured request against prod + fork → the two-signal verdict
  (tickets 0006 + 0008). This is the demo's strongest moment.
- **Trace-only fallback** (ticket 0012): if a fork can't be acquired in budget,
  evaluate the patched predicate against the captured request — proven green by
  [`functions/e2e-trace.test.ts`](../functions/e2e-trace.test.ts) above. Caps at
  `draft_pr`; never opens a PR.
- **Read-path / pure-logic tickets** test against the seeded rows and via their
  vitest suites as before.

## Real fork verdict — proven end-to-end (2026-06-06)

Manually exercised the real fork path against the live `hush-fix-sandbox`
branch (`branch switch` → set up → patch → measure → `branch switch --parent`).
The fork was empty (forked before the schema existed at 19:19 UTC), so it was
given the buggy schema + seed first, then the patch was applied — exactly the
fork-then-apply flow.

| Project | `orders_select` policy | migrated `tenant_ids[]` JWT | Globex JWT |
|---|---|---|---|
| **PROD** (parent `hush`) | buggy (`-> 'tenant'`) | **0 rows** — the bug | — |
| **FORK** (`hush-fix-sandbox`) | patched (OR branch) | **3 rows** — the fix | **0** — no widening |

Two separate InsForge projects, different deployed policies, different results
for the same query+claims. That's the slide-06 money shot, real.

### ⚠️ The fork caught a demo-critical bug the trace path masked

The canonical patch shape used across the codebase —
`ANY((auth.jwt() -> 'tenant_ids')::uuid[])` — is **invalid Postgres**:

```
ERROR: cannot cast type jsonb to uuid[]
```

You cannot direct-cast jsonb to `uuid[]`. The correct form is:

```sql
ANY(array(select jsonb_array_elements_text(auth.jwt() -> 'tenant_ids'))::uuid[])
```

No unit test caught it — they treat the patch as a *string* (safety does widening
analysis; traceReplay evaluates `ANY(...)` in JavaScript). Only the live fork runs
real SQL. This is the concrete payoff of the fork path over trace mode, and the
reason [`agents/inbox/0044`](../agents/inbox/0044-patch-cast-jsonb-uuid-array.md)
exists. The runtime source (diagnose prompts + fixture) is fixed; the remaining
test/slide constants are tracked in 0044.

### Fork state note

`hush-fix-sandbox` currently holds the buggy schema + seed + the *patched*
policy (left over from this proof). For a clean demo run, reset and re-fork
*after* prod has the schema, or `branch reset hush-fix-sandbox` and re-apply the
buggy schema so Hush can apply the patch live.

## Reset / reseed

```bash
# wipe rows, keep schema
npx @insforge/cli db query "truncate bug_decisions, bug_runs, request_log, orders, tenants restart identity cascade"
# then re-run the seed block from the migration's companion (see git history of this doc)
```
