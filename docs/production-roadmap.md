# Production roadmap — from demo to self-serve product

> The hackathon build proves the loop on one seeded bug, one victim repo, one
> baked backend. This epic turns Hush into a product a customer can sign up for,
> **point at their own website(s), connect their GitHub, and receive auto-fix
> PRs** — multi-tenant, secure, and reliable.

## The target experience

1. Sign up → create a **workspace**.
2. **Add a website** by URL; drop in the capture snippet (or connect Replicas).
3. **Connect GitHub** (install the Hush GitHub App, pick the repos Hush may open PRs against).
4. **Connect the backend** Hush forks to verify fixes (the customer's InsForge project).
5. Hush watches real sessions → diagnoses silent backend bugs → opens confidence-tiered PRs on the customer's repos, with the fix verified on a fork.

## What changes from the demo

| Demo (today) | Product (this epic) |
|---|---|
| One seeded RLS bug | Any silent backend policy/auth bug, any customer |
| Hardcoded victim repo (`hush-victim-acme`) | Customer's repos via a **GitHub App** |
| Baked InsForge project | Customer **connects their own** InsForge backend |
| Local `.hush/pool.json` fork pool | **Multi-tenant fork pool in InsForge** |
| Secrets in `.env` / InsForge secrets | **Per-workspace encrypted secrets vault** |
| No accounts / single tenant | **Workspaces + RLS isolation per customer** |
| Demo-mode receipt | **Customer dashboard** (sites, runs, PRs, settings) |

## Ticket map (epic: `self-serve-product`)

| # | Ticket | Pillar | Pri |
|---|---|---|---|
| [0048](../agents/inbox/0048-multi-tenant-workspaces-auth.md) | Multi-tenant workspaces + customer auth | Foundation | P0 |
| [0049](../agents/inbox/0049-github-app-connect-repos.md) | GitHub App — connect repos, open PRs as the customer | **GitHub access** | P0 |
| [0050](../agents/inbox/0050-site-connector-capture-install.md) | Site connector — add a website by URL + install capture | **Connect sites** | P0 |
| [0051](../agents/inbox/0051-customer-backend-connector.md) | Customer-backend connector — fork & replay their InsForge | Moat, generalized | P0 |
| [0052](../agents/inbox/0052-secrets-vault.md) | Per-workspace encrypted secrets vault | Security | P0 |
| [0053](../agents/inbox/0053-fork-pool-in-insforge.md) | Productionize the fork pool in InsForge (multi-tenant) | Reliability | P1 |
| [0054](../agents/inbox/0054-customer-dashboard.md) | Customer dashboard (sites, runs, PRs, settings) | UX | P1 |
| [0055](../agents/inbox/0055-llm-reliability-byok.md) | LLM reliability — failover, BYO-key, quota handling | Reliability | P1 |
| [0056](../agents/inbox/0056-privacy-retention-consent.md) | Privacy — PII scrubbing at scale, retention, consent | Compliance | P1 |
| [0057](../agents/inbox/0057-observability-ops.md) | Observability & ops — logs, metrics, alerting, audit trail | Ops | P2 |
| [0058](../agents/inbox/0058-billing-plans.md) | Billing & plans (per-confirmed-fix pricing) | Business | P2 |

## Critical path to a first external customer

`0048 (workspaces) → 0052 (secrets vault) → 0049 (GitHub) + 0050 (sites) + 0051 (backend) → 0053 (fork pool) → 0054 (dashboard)`.
The rest (0055–0058) harden and monetize.

## Non-goals for v1

- On-prem / self-hosted control plane (cloud-first).
- Non-InsForge backends (the fork-and-replay moat is InsForge-specific; other
  backends get a degraded trace-only mode at best — revisit later).
- Languages beyond the `insforge.toml` policy surface (no arbitrary app-code fixes yet).
