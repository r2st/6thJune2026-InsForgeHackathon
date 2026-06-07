---
id: 0056
title: Privacy — PII scrubbing at scale, data retention, consent
role: architect
priority: P1
owner:
started:
status: inbox
depends_on: [0048, 0050, 0051]
demo_path: no — product (post-hackathon)
phase: production
epic: self-serve-product
---

## Goal

Hush handles real user sessions and forks of real backends without leaking PII:
captures are masked + scrubbed, forks are seeded from the minimum necessary rows,
data has a retention policy and deletion path, and customers control consent.

## Why it matters

Session capture + backend forking is inherently sensitive. A product can't ship
without a defensible data-handling story — it's a sales blocker and a legal one.
The pieces exist (rrweb masking, `scrubPii`, the PII guardrail tests); this makes
them a policy, not a feature.

## Acceptance criteria

- [ ] **Capture privacy:** default-mask all inputs (rrweb), per-site masking
      rules, server-side strip of `Authorization`/`Cookie`/`Set-Cookie`
      (already in `ingest`) — formalized + tested per site.
- [ ] **Fork minimization:** forks seed only the rows the failing request touched,
      never a full prod copy ([[0051-customer-backend-connector]]); a documented
      data-flow boundary.
- [ ] **Retention:** configurable TTL on sessions/clips/runs; automatic purge job;
      forks destroyed on TTL/merge/close.
- [ ] **Deletion / DSAR:** a workspace (and an end-user, via the customer) can
      request deletion of sessions tied to a user id; cascade across Storage + DB.
- [ ] **Consent surface:** snippet supports a consent gate / DNT honoring; a
      data-processing summary for the customer to show their users.
- [ ] Redaction never lets credentials/PII reach receipt/PR/logs (extends
      [[0052-secrets-vault]] redaction).

## Likely files / surfaces touched

- `functions/lib/scrubPii.ts`, `functions/ingest.ts`, `packages/capture-sdk/`
- `infra/insforge.toml` (retention TTLs, purge schedule)
- `docs/` (data-handling / DPA boilerplate)

## Notes

- The "we only fork the affected rows, never your prod data" line is both the
  privacy posture and a trust-selling point.

## Outcome
