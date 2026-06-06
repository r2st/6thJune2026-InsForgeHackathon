# infra — InsForge canonical config

[`insforge.toml`](insforge.toml) is the single source of truth for the schema, RLS policies, storage, realtime channels, and edge function manifest. Apply it with the `insforge-cli` skill.

## Apply

```bash
# Prod (only once, at bring-up — see docs/deployment.md §3)
insforge link <project-id>
insforge config apply --file infra/insforge.toml

# Branch project (each demo run)
insforge config apply --file infra/insforge.toml --branch hush-fix-sandbox
insforge db seed --branch hush-fix-sandbox --file infra/seed/two-tenants.sql
```

## What's intentionally buggy

The RLS predicate on `tables.orders` reads `auth.jwt() ->> 'tenant'` (singular). The demo user's JWT was migrated to `tenant_ids[]` last week. That mismatch is the silent bug Hush diagnoses on stage.

The patch (the four-line PR Hush opens) adds an OR branch covering the new claim shape. The safety rail in [`functions/safety.ts`](../functions/safety.ts) verifies the patch does not widen access — Tenant B must still see zero orders after the patch applies. The seed in [`seed/two-tenants.sql`](seed/two-tenants.sql) provides the second tenant whose silence proves the patch is scoped.

## Lint before apply

```bash
insforge config lint --file infra/insforge.toml
```

Catches malformed TOML before it hits the project. Run this from CI; don't trust the apply step to surface every typo cleanly.
