# Production roadmap — from demo to self-serve product

> The hackathon build proves the loop on one seeded bug, one victim repo, one
> baked backend. This epic turns Hush into a product a customer can sign up for,
> **point at their own website(s), connect their GitHub, and receive auto-fix
> PRs** — multi-tenant, secure, and reliable.

## The target experience

1. Sign up → create a **workspace**.
2. **Add a website** by URL; drop in the capture snippet (or connect Replicas).
3. Confirm the capture snippet propagates a **Hush session id** into backend
   requests.
4. **Connect GitHub** (install the Hush GitHub App, pick the repos Hush may open PRs against).
5. **Connect the backend** Hush forks to verify fixes (the customer's InsForge project).
6. Install backend request/RLS instrumentation so Hush can see the production
   evidence, not just the frontend symptom.
7. Start in **observe-only** mode: Hush watches real sessions → triages only the
   high-evidence candidates → diagnoses silent backend bugs → shows verified
   would-be PRs, then graduates to draft/auto PRs as trust builds.

## What changes from the demo

| Demo (today) | Product (this epic) |
|---|---|
| One seeded RLS bug | Any silent backend policy/auth bug, any customer |
| Hardcoded victim repo (`hush-victim-acme`) | Customer's repos via a **GitHub App** |
| Baked InsForge project | Customer **connects their own** InsForge backend |
| Toy app manually writes `request_log` | Customer backend emits a normalized **request-log + RLS evidence contract** |
| Every rage-click is narratively useful | Signals are **triaged, deduped, budgeted**, and only escalated with backend proof |
| Local `.hush/pool.json` fork pool | **Multi-tenant fork pool in InsForge** |
| Secrets in `.env` / InsForge secrets | **Per-workspace encrypted secrets vault** |
| No accounts / single tenant | **Workspaces + RLS isolation per customer** |
| Demo-mode receipt | **Customer dashboard** (sites, runs, PRs, settings) |

## Critical analysis — what still breaks in production

The demo proves the loop, but a production product needs several extra defenses:

1. **Evidence is not automatic.** The demo bug is caught because the toy backend
   writes `rows_before=3` and `rows_after=0`. Real customer apps will not have
   that log unless we install it. [[0086]] is P0 because without it Hush has
   session replay, but not backend proof.
2. **Rage-clicks are noisy.** A frustrated click can mean bad UX, slow network,
   a disabled button, or a frontend bug. [[0087]] is P0 because Hush must require
   a same-session backend anomaly before spending LLM/fork budget or opening a
   PR.
3. **Leaks may not create frustration.** Vanished rows produce rage-clicks; leaked
   rows often do not. [[0088]] adds canary policy probes so "leaked tenant" claims
   are backed by proactive evidence, not hope.
4. **Expected rows are an oracle, not a constant.** The demo knows "3 orders"
   ahead of time. Production must derive or validate that expectation per route,
   policy, and tenant. [[0078]] owns the expectation oracle; [[0062]] owns the
   wider taxonomy and expected-row generalization.
5. **Trust comes before autonomy.** The first customer should run observe-only,
   then review/draft, then auto-PR. [[0070]] and [[0068]] are first-customer
   blockers, not polish.

## Phase 1 — product surface (epic: `self-serve-product`)

The connectors and tenancy that let a customer use Hush at all.

| # | Ticket | Pillar | Pri |
|---|---|---|---|
| [0048](../agents/done/0048-multi-tenant-workspaces-auth.md) | Multi-tenant workspaces + customer auth | Foundation | P0 |
| [0049](../agents/inbox/0049-github-app-connect-repos.md) | GitHub App — connect repos, open PRs as the customer | **GitHub access** | P0 |
| [0050](../agents/inbox/0050-site-connector-capture-install.md) | Site connector — add a website by URL + install capture | **Connect sites** | P0 |
| [0051](../agents/inbox/0051-customer-backend-connector.md) | Customer-backend connector — fork & replay their InsForge | Moat, generalized | P0 |
| [0052](../agents/inbox/0052-secrets-vault.md) | Per-workspace encrypted secrets vault | Security | P0 |
| [0086](../agents/inbox/0086-production-request-log-rls-instrumentation.md) | Production request-log + RLS instrumentation contract | **Backend proof** | P0 |
| [0053](../agents/inbox/0053-fork-pool-in-insforge.md) | Productionize the fork pool in InsForge (multi-tenant) | Reliability | P1 |
| [0054](../agents/inbox/0054-customer-dashboard.md) | Customer dashboard (sites, runs, PRs, settings) | UX | P1 |
| [0055](../agents/done/0055-llm-reliability-byok.md) | LLM reliability — failover, BYO-key, quota handling | Reliability | P1 |
| [0056](../agents/done/0056-privacy-retention-consent.md) | Privacy — PII scrubbing at scale, retention, consent | Compliance | P1 |
| [0057](../agents/inbox/0057-observability-ops.md) | Observability & ops — logs, metrics, alerting, audit trail | Ops | P2 |
| [0058](../agents/inbox/0058-billing-plans.md) | Billing & plans (per-confirmed-fix pricing) | Business | P2 |

## Phase 2 — hardening & go-to-market (epic: `hardening`)

What makes it *production-ready*: shippable safely, at scale, and discoverable.
Several come straight from the hackathon's live-integration scars.

| # | Ticket | Pillar | Pri |
|---|---|---|---|
| [0059](../agents/inbox/0059-cicd-staging-pipeline.md) | CI/CD pipeline + staging (test, build-verify, deploy gate) | Delivery | P0 |
| [0060](../agents/done/0060-edge-runtime-parity-guardrail.md) | Edge-runtime parity guardrail (no Node-only globals / disk reads) | Delivery | P0 |
| [0061](../agents/done/0061-security-hardening.md) | Security hardening — ingest abuse, secret rotation, SAST/dep scan | Security | P0 |
| [0078](../agents/done/0078-expectation-oracle.md) | Expectation oracle — empty result vs. real bug | Quality | P0 |
| [0079](../agents/done/0079-robust-correlation.md) | Robust correlation & disambiguation | Quality | P0 |
| [0080](../agents/done/0080-incident-aggregation.md) | Bug grouping / incident aggregation | Cost, trust | P0 |
| [0087](../agents/done/0087-signal-triage-dedup-noise-budget.md) | Signal triage, deduplication, and production noise budget | Quality | P0 |
| [0062](../agents/done/0062-generalize-bug-surface.md) | Generalize the bug surface beyond the demo RLS case | Coverage | P1 |
| [0089](../agents/done/0089-representative-fork-validation.md) | Representative fork validation | Safety | P1 |
| [0090](../agents/done/0090-config-drift-reconciliation.md) | Config drift detection & reconciliation | Safety | P1 |
| [0091](../agents/done/0091-confidence-calibration.md) | Confidence calibration against real outcomes | Quality | P1 |
| [0092](../agents/done/0092-feedback-integrity.md) | Feedback / Memoir integrity — poisoning resistance | Trust | P1 |
| [0093](../agents/done/0093-stateful-multistep-bugs.md) | Stateful & multi-request bugs — detect and decline | Scope | P2 |
| [0088](../agents/done/0088-canary-policy-probes-for-silent-leaks.md) | Canary policy probes for silent leaks and over-permissive RLS | Coverage | P1 |
| [0063](../agents/done/0063-notifications-integrations.md) | Notifications & integrations (Slack / email / webhook) | UX | P1 |
| [0064](../agents/done/0064-reliability-idempotency.md) | Reliability & idempotency — retries, DLQ, graceful degradation | Reliability | P1 |
| [0065](../agents/done/0065-scale-performance.md) | Scale & performance — load test, concurrency, cost guardrails | Scale | P2 |
| [0066](../agents/inbox/0066-docs-onboarding-landing.md) | Docs, onboarding & landing — customer docs, SDK ref, public site | GTM | P2 |

## Phase 3 — operate, trust & grow (epic: `operate-trust-grow`)

The product surface (P1) makes Hush *usable*; hardening (P2) makes it *shippable*.
Phase 3 is what makes customers *keep* it: own the PRs it opens, earn autonomy,
never break prod, prove ROI, and run the business.

| # | Ticket | Pillar | Pri |
|---|---|---|---|
| [0067](../agents/done/0067-pr-lifecycle-management.md) | PR lifecycle — track, respond to review, rebase, close stale | Trust | P0 |
| [0068](../agents/done/0068-human-in-the-loop-feedback.md) | Human-in-the-loop review & feedback → Memoir | Trust | P0 |
| [0069](../agents/done/0069-auto-rollback-regression-detection.md) | Auto-rollback & post-fix regression detection | Safety | P1 |
| [0070](../agents/done/0070-observe-only-dry-run-mode.md) | Observe-only / dry-run mode + graduated trust | Adoption | P0 |
| [0071](../agents/done/0071-outcome-measurement.md) | Outcome measurement — did the fix reduce frustration? | ROI | P1 |
| [0072](../agents/done/0072-prompt-model-eval-harness.md) | Prompt & model evaluation harness (quality gate) | Quality | P1 |
| [0073](../agents/inbox/0073-dr-backups-continuity.md) | DR, backups & business continuity | Ops | P1 |
| [0074](../agents/inbox/0074-compliance-program.md) | Compliance — SOC 2 / GDPR DPA / data residency | Enterprise | P2 |
| [0075](../agents/inbox/0075-admin-support-status.md) | Internal admin, support tooling & status page | Ops | P2 |
| [0076](../agents/inbox/0076-capture-sdk-hardening.md) | Capture SDK hardening — perf, CSP, adapters, versioning | Trust | P1 |
| [0077](../agents/inbox/0077-product-analytics-activation.md) | Product analytics & activation (funnel, retention) | Growth | P2 |

## Critical path to a first external customer

`0048 (workspaces) → 0052 (secrets vault) → 0049 (GitHub) + 0050 (sites) + 0051 (backend) → 0086 (backend proof) → 0078 (expectation oracle) → 0079 (correlation) → 0080/0087 (incident + triage/noise) → 0053 (fork pool) → 0054 (dashboard) → 0070 (observe-only)`,
with **0059 + 0060 + 0061 in parallel from day one** (you cannot safely ship the
above without CI, runtime-parity guards, and security). Add [[0068]] before
draft/auto PRs. The rest harden, scale, and monetize.

## Non-goals for v1

- On-prem / self-hosted control plane (cloud-first).
- Non-InsForge backends (the fork-and-replay moat is InsForge-specific; other
  backends get a degraded trace-only mode at best — revisit later).
- Languages beyond the `insforge.toml` policy surface (no arbitrary app-code fixes yet).
- Auto-PR by default for new customers. v1 defaults to observe-only, then earns
  draft/auto permissions through review history and outcome evidence.
