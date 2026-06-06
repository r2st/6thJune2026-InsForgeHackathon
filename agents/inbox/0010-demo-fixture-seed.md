---
id: 0010
title: Deterministic demo-store fixture seeded into every pre-warmed fork
role: architect
priority: P0
owner:
started:
status: inbox
depends_on: [0004]
demo_path: yes — without this, prod/branch row counts are not reproducible
---

## Goal

A single SQL seed (`infra/seed/demo.sql`) that creates two tenants
(`acme`, `globex`) and three orders for `acme`. Applied to the demo
prod project at boot and to every pre-warmed fork at provisioning.

## Why it matters for the demo

Slide 6 hinges on **prod returns 0 rows, fork returns 3 rows.** That
"3" must be deterministic. Any seed drift between prod and fork breaks
the verdict — and so the demo.

## Acceptance criteria

- [ ] `infra/seed/demo.sql` is idempotent (TRUNCATE + INSERT or upsert)
- [ ] Three rows in `orders` with `tenant_id = 'acme'`
- [ ] Demo user's JWT has the claim shape that *should* match (i.e. the
      shape the new policy understands) — but prod's *policy* still
      reads the old claim, so it filters to 0
- [ ] `scripts/seed.sh --env prod` and `--env <branchId>` both work
- [ ] Documented: which row count means "fix works" (`3`) vs. "still
      buggy" (`0`)

## Likely files / surfaces touched

- `infra/seed/demo.sql`
- `scripts/seed.sh`
- `docs/architecture.md` (data model section)

## Notes

Keep the schema tiny — `orders(id, tenant_id, total, created_at)` is
plenty. Anything more is decoration.

## Outcome
