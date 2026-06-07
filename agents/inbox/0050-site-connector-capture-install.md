---
id: 0050
title: Site connector — add a website by URL and install the capture SDK
role: builder
priority: P0
owner:
started:
status: inbox
depends_on: [0048]
demo_path: no — product (post-hackathon)
phase: production
epic: self-serve-product
---

## Goal

A workspace owner clicks **Add site**, enters their site URL(s), and gets a copy-
paste capture snippet (or a Replicas connection). Hush verifies the snippet is
live, and the site is mapped to a GitHub repo + a backend connection so a captured
session can flow all the way to a PR.

## Why it matters

"Provide links to different websites" is the second headline ask. The demo has
one baked storefront. A product lets a customer register N sites, each with its
own capture install, repo mapping, and backend — and route every captured
frustration to the right place.

## Acceptance criteria

- [ ] `Add site` flow: enter URL(s) + a friendly name → a `sites` row scoped to
      the workspace, with a unique `site_key`.
- [ ] **Capture install:** generate a `<script>` snippet (rrweb-based) keyed to
      the `site_key` + workspace API key, OR a "Connect Replicas" path
      ([[0041-replicas-session-capture-source]] generalized). The snippet posts
      sessions to `ingest` with the site/workspace identity.
- [ ] **Install verification:** a "Verify" button confirms Hush received a test
      session from the site (handshake ping), with a clear installed/not-installed
      state in the dashboard.
- [ ] **Site → repo + backend mapping:** each site declares which GitHub repo
      ([[0049-github-app-connect-repos]]) and which backend connection
      ([[0051-customer-backend-connector]]) it uses, so a run knows where to fork
      and where to PR.
- [ ] Per-site capture controls: sampling rate, frustration-signal toggles,
      masking rules (extends the existing rrweb masking + PII scrub).
- [ ] CSP/CORS guidance + an allowed-origins list per site so `ingest` only
      accepts sessions from registered origins.

## Likely files / surfaces touched

- `infra/insforge.toml` (`sites` table, origin allowlist)
- `functions/ingest.ts` (resolve workspace+site from `site_key`/origin, not a baked tenant)
- `apps/dashboard/` (Add-site wizard, snippet, verify), `apps/demo` → reference snippet
- `packages/capture-sdk/` (new — the embeddable, versioned snippet)

## Notes

- Ties the loop together: a session now carries (workspace, site) → which decides
  repo + backend for steps 4–5. This replaces the demo's single hardcoded tenant.
- Closes the spirit of [[0047-demo-login-tenant-claimed-token]] at product scale.

## Outcome
