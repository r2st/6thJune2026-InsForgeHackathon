---
id: 0049
title: GitHub App — connect repos and open PRs under the customer's account
role: builder
priority: P0
owner:
started:
status: inbox
depends_on: [0048, 0052]
demo_path: no — product (post-hackathon)
phase: production
epic: self-serve-product
---

## Goal

A workspace owner clicks **Connect GitHub**, installs the Hush GitHub App on
their org, and picks the repos Hush may open PRs against. Hush then opens its
fix PRs/draft-PRs/issues on the *customer's* repos — replacing the hardcoded
`hush-victim-acme` / `GITHUB_REPO` env target.

## Why it matters

"With access to GitHub" is the headline ask. The demo opens PRs on one baked
repo via a single PAT. A real product needs per-customer, least-privilege,
revocable GitHub access across many repos — which is exactly what a GitHub App
(not a PAT) provides.

## Acceptance criteria

- [ ] A **GitHub App** (not OAuth-PAT): permissions `contents: write`,
      `pull_requests: write`, `issues: write`, `metadata: read`. Installable per org.
- [ ] Install flow: `Connect GitHub` → GitHub App install → callback stores the
      `installation_id` on the workspace; list and **select repos** Hush may touch.
- [ ] `functions/ship.ts` / `openPr.ts` resolve the repo + a short-lived
      **installation access token** per run (minted from the App's private key
      via JWT) instead of reading `GITHUB_REPO` / a static PAT.
- [ ] Per-run target repo comes from the **site → repo mapping** (a site declares
      which repo backs it; see [[0050-site-connector-capture-install]]).
- [ ] Token handling: never persist installation tokens (mint per run, ≤10 min
      TTL); the App private key lives in the secrets vault ([[0052-secrets-vault]]).
- [ ] Disconnect / revoke flow; webhook handling for app-uninstalled.
- [ ] Branch-protection-aware: if the target branch requires reviews, Hush opens
      a PR (never force-merges) — already the model, just make it per-repo.

## Likely files / surfaces touched

- `functions/ship.ts`, `functions/openPr.ts`, `functions/lib/githubApp.ts` (new)
- `infra/insforge.toml` (`github_installations`, `repos` tables)
- `apps/dashboard/` (Connect GitHub + repo picker)

## Notes

- Replaces `DEVIN_TARGET_REPO` / `GITHUB_REPO` env indirection. Devin/Replicas
  (the background coding agents) operate *within* the App's granted repos.
- The App private key is the one credential to guard hardest — vault + rotation.

## Outcome
