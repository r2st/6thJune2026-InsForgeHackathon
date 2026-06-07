---
id: 0073
title: DR, backups & business continuity
role: architect
priority: P1
owner:
started:
status: inbox
depends_on: [0048]
demo_path: no — product (post-hackathon)
phase: production
epic: operate-trust-grow
---

## Goal

Hush survives data loss and outages: regular backups of all customer data, tested
restore procedures, defined RPO/RTO, and a continuity plan for each external
dependency (InsForge, GitHub, LLM providers).

## Why it matters

Hush stores customer sessions, run history, connections, and credentials. Losing
that — or a multi-hour outage — is a trust-ending event. Backups you haven't
tested restoring are not backups.

## Acceptance criteria

- [ ] Automated backups of DB (per [[0048]] tenancy) + Storage (clips), with
      defined retention and encryption.
- [ ] **Tested** restore runbook (a periodic restore drill, not just config).
- [ ] Documented RPO/RTO targets; a status/health surface ([[0075]]).
- [ ] Per-dependency continuity: LLM provider chain ([[0055]]) covers LLM outage;
      define GitHub-outage and InsForge-outage degradations (queue + resume).
- [ ] Secrets vault ([[0052]]) backup/restore handled without exposing plaintext.

## Likely files / surfaces touched

- `scripts/backup/`, `docs/runbooks/restore.md`, InsForge backup config

## Outcome
