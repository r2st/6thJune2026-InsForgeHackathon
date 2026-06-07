---
id: 0086
title: Production request-log + RLS instrumentation contract
role: architect
priority: P0
owner:
started:
status: inbox
depends_on: [0050, 0051, 0052]
demo_path: no — product (post-hackathon)
phase: production
epic: self-serve-product
---

## Goal

A customer's production backend emits the normalized evidence Hush needs:
session id, route, user/tenant identity, auth claims shape, and policy decisions
including `rows_before` and `rows_after` — without logging raw private rows or
secrets.

## Why it matters

The demo works because `apps/demo` manually writes a perfect `request_log` row.
That is not true in a real customer app. A rage-click alone only says "the user
is frustrated"; it does **not** prove an RLS/auth bug. The product's core promise
requires a production-grade log contract that turns:

`200 OK + []`

into:

`orders.orders_select saw 3 rows before RLS and 0 after RLS for this session`.

Without this ticket, Hush can capture sessions but cannot safely diagnose or
ship fixes in production.

## Acceptance criteria

- [ ] Define the canonical `request_log` / `rls_decisions` schema for production:
      `workspace_id`, `site_id`, `backend_connection_id`, `session_id`, route,
      method, status, returned row count, policy/table names, `rows_before`,
      `rows_after`, redacted auth-claim shape, timestamps, and trace id.
- [ ] Provide an install path for customers to emit the schema: InsForge edge
      middleware / SDK helper / route wrapper, with examples for the common
      Next.js API-route and edge-function cases.
- [ ] Propagate `x-hush-session-id` from the capture SDK ([[0050]]) through
      customer requests and into the backend log; missing session ids must be
      visible as an install-health warning, not silently ignored.
- [ ] Produce `rows_before` / `rows_after` without selecting or storing full row
      payloads. Store counts and policy metadata only; redact raw claims,
      Authorization/Cookie headers, and query params marked sensitive.
- [ ] Install verifier: dashboard check creates a synthetic request and confirms
      Hush receives a correlated frontend event + backend log pair.
- [ ] Failure mode: if a backend can only provide route/status/row-count but not
      policy-level RLS evidence, the run is capped to `issue` or `draft_pr`, never
      auto-PR.
- [ ] Tests cover: missing session id, multiple failing routes, no RLS evidence,
      stale claim shape, and redaction of credentials/PII.

## Likely files / surfaces touched

- `infra/insforge.toml` (`request_log`, `rls_decisions`, install-health tables)
- `functions/correlate.ts`, `functions/ingest.ts`
- `packages/backend-instrumentation/` or `packages/capture-sdk/`
- `apps/dashboard/` (install verifier + health state)
- `docs/` (backend instrumentation guide)

## Notes

- This is the production counterpart to the demo's hand-written
  `apps/demo/app/api/orders/route.ts` request log.
- Keep the contract count-based. The fork/replay step can fetch what it needs
  under the customer's scoped backend credential; the log should not become a
  data lake of customer rows.

## Outcome
<!-- Fill in when moving to done/. 2-3 lines max. -->
<!-- - What shipped: -->
<!-- - What was cut and why: -->
<!-- - How to verify it: -->
