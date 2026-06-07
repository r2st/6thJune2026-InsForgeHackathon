---
id: 0061
title: Security hardening — ingest abuse controls, secret rotation, SAST/dep scanning
role: architect
priority: P0
owner:
started:
status: inbox
depends_on: [0048, 0052]
demo_path: no — product (post-hackathon)
phase: production
epic: hardening
---

## Goal

Close the attack surface a multi-tenant product opens: the `ingest` endpoint
can't be abused, customer credentials rotate and are scanned-for, and code +
dependencies are continuously checked for vulnerabilities and leaked secrets.

## Why it matters

Hush accepts untrusted session data from the public internet, holds other
people's GitHub/InsForge credentials, and runs an LLM that proposes code changes.
Each is a real attack vector. The opsera security scan was disabled for hackathon
speed — production turns it back on.

## Acceptance criteria

- [ ] **Ingest abuse controls:** per-site origin allowlist (from
      [[0050-site-connector-capture-install]]), rate limiting + payload size caps,
      and bot/replay protection — a hostile site can't flood or poison runs.
- [ ] **Prompt-injection containment:** the captured session is untrusted input to
      diagnose; keep it walled (the existing sanitise/guardrail layer) and never
      let captured content escalate into a wider `insforge.toml` diff. Adversarial
      tests for injection in session content.
- [ ] **Secret rotation + scanning:** rotation API ([[0052-secrets-vault]]),
      pre-commit + CI secret scanning (gitleaks), dependency/SAST scanning
      (the opsera scan, re-enabled) gating merges on critical/high.
- [ ] **Least privilege everywhere:** GitHub App scopes minimal, InsForge backend
      access scoped to branch/read, fork JWTs short-lived.
- [ ] A documented **threat model** + an incident-response runbook.

## Likely files / surfaces touched

- `functions/ingest.ts` (rate limit, origin check), `functions/sanitise.ts`
- `.github/workflows/` (gitleaks, opsera scan), `docs/security/`

## Notes

- Re-enables the security scanning the hackathon turned off
  ([[feedback_no_security_scans]] was a speed decision, not a product stance).

## Outcome
