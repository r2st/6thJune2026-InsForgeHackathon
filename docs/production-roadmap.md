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

## Phase 1 — product surface (epic: `self-serve-product`)

The connectors and tenancy that let a customer use Hush at all.

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

## Phase 2 — hardening & go-to-market (epic: `hardening`)

What makes it *production-ready*: shippable safely, at scale, and discoverable.
Several come straight from the hackathon's live-integration scars.

| # | Ticket | Pillar | Pri |
|---|---|---|---|
| [0059](../agents/inbox/0059-cicd-staging-pipeline.md) | CI/CD pipeline + staging (test, build-verify, deploy gate) | Delivery | P0 |
| [0060](../agents/inbox/0060-edge-runtime-parity-guardrail.md) | Edge-runtime parity guardrail (no Node-only globals / disk reads) | Delivery | P0 |
| [0061](../agents/inbox/0061-security-hardening.md) | Security hardening — ingest abuse, secret rotation, SAST/dep scan | Security | P0 |
| [0062](../agents/inbox/0062-generalize-bug-surface.md) | Generalize the bug surface beyond the demo RLS case | Coverage | P1 |
| [0063](../agents/inbox/0063-notifications-integrations.md) | Notifications & integrations (Slack / email / webhook) | UX | P1 |
| [0064](../agents/inbox/0064-reliability-idempotency.md) | Reliability & idempotency — retries, DLQ, graceful degradation | Reliability | P1 |
| [0065](../agents/inbox/0065-scale-performance.md) | Scale & performance — load test, concurrency, cost guardrails | Scale | P2 |
| [0066](../agents/inbox/0066-docs-onboarding-landing.md) | Docs, onboarding & landing — customer docs, SDK ref, public site | GTM | P2 |

## Phase 3 — operate, trust & grow (epic: `operate-trust-grow`)

The product surface (P1) makes Hush *usable*; hardening (P2) makes it *shippable*.
Phase 3 is what makes customers *keep* it: own the PRs it opens, earn autonomy,
never break prod, prove ROI, and run the business.

| # | Ticket | Pillar | Pri |
|---|---|---|---|
| [0067](../agents/inbox/0067-pr-lifecycle-management.md) | PR lifecycle — track, respond to review, rebase, close stale | Trust | P0 |
| [0068](../agents/inbox/0068-human-in-the-loop-feedback.md) | Human-in-the-loop review & feedback → Memoir | Trust | P1 |
| [0069](../agents/inbox/0069-auto-rollback-regression-detection.md) | Auto-rollback & post-fix regression detection | Safety | P1 |
| [0070](../agents/inbox/0070-observe-only-dry-run-mode.md) | Observe-only / dry-run mode + graduated trust | Adoption | P1 |
| [0071](../agents/inbox/0071-outcome-measurement.md) | Outcome measurement — did the fix reduce frustration? | ROI | P1 |
| [0072](../agents/inbox/0072-prompt-model-eval-harness.md) | Prompt & model evaluation harness (quality gate) | Quality | P1 |
| [0073](../agents/inbox/0073-dr-backups-continuity.md) | DR, backups & business continuity | Ops | P1 |
| [0074](../agents/inbox/0074-compliance-program.md) | Compliance — SOC 2 / GDPR DPA / data residency | Enterprise | P2 |
| [0075](../agents/inbox/0075-admin-support-status.md) | Internal admin, support tooling & status page | Ops | P2 |
| [0076](../agents/inbox/0076-capture-sdk-hardening.md) | Capture SDK hardening — perf, CSP, adapters, versioning | Trust | P1 |
| [0077](../agents/inbox/0077-product-analytics-activation.md) | Product analytics & activation (funnel, retention) | Growth | P2 |

## Critical path to a first external customer

`0048 (workspaces) → 0052 (secrets vault) → 0049 (GitHub) + 0050 (sites) + 0051 (backend) → 0053 (fork pool) → 0054 (dashboard)`,
with **0059 + 0060 + 0061 in parallel from day one** (you cannot safely ship the
above without CI, runtime-parity guards, and security). The rest harden, scale,
and monetize.

## Non-goals for v1

- On-prem / self-hosted control plane (cloud-first).
- Non-InsForge backends (the fork-and-replay moat is InsForge-specific; other
  backends get a degraded trace-only mode at best — revisit later).
- Languages beyond the `insforge.toml` policy surface (no arbitrary app-code fixes yet).
