---
id: 0074
title: Compliance program — SOC 2 / GDPR DPA / data residency / subprocessors
role: architect
priority: P2
owner:
started:
status: inbox
depends_on: [0056, 0057, 0061, 0073]
demo_path: no — product (post-hackathon)
phase: production
epic: operate-trust-grow
---

## Goal

Hush can be bought by a security-conscious company: a DPA, a subprocessor list, a
documented data-handling and retention posture, audit logs sufficient for SOC 2,
and a path to data residency.

## Why it matters

Hush touches user sessions and customer source/infra — exactly what a vendor
security review scrutinizes. Without this, enterprise deals stall at procurement
regardless of how good the product is.

## Acceptance criteria

- [ ] Published DPA + subprocessor list (InsForge, GitHub, LLM providers, Vercel,
      Lim.run, Replicas, Memoir) and a data-flow diagram.
- [ ] Audit logging ([[0057]]) + secret-access logs ([[0052]]) meet SOC 2 trust
      criteria (access, change, availability); a controls matrix.
- [ ] Data residency story: per-region data + fork locality where required
      (EU-only option).
- [ ] Retention/deletion/DSAR ([[0056]]) formalized into policy with proof.
- [ ] A trust/security page + a SOC 2 readiness roadmap (Type I → II).

## Likely files / surfaces touched

- `docs/compliance/` (DPA, subprocessors, controls, data-flow)
- Audit/retention infra from [[0057]] / [[0056]]

## Outcome
