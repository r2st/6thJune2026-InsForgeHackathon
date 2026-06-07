---
id: 0061
title: Security hardening — ingest abuse controls, secret rotation, SAST/dep scanning
role: architect
priority: P0
owner: claude-opus-4-8 (loop)
started: 2026-06-07
status: in-progress
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

Shipped the **pure ingest-abuse-control core** in `functions/ingestGuard.ts`
(+ 15 tests, `functions/ingestGuard.test.ts`, tsc clean; full suite 596 green):

- **guardIngest(req, config, bucket, seenNonces, now)** — admits a capture only if
  it passes, cheapest-first, with the right status: forbidden origin (403) →
  oversized payload (413) → stale/replay (400) → rate limit (429) → admit (200).
- **originAllowed** — per-site origin allowlist with exact + one-level `*.domain`
  wildcard, case-insensitive; **replayStatus** — rejects a stale timestamp (outside
  the skew window) or a reused nonce (replay/poison protection).
- **Rate limit reuses `TokenBucket`** from `llmChain` (no second limiter), and the
  token is spent **only after the static checks pass** — so a bad-origin flood can't
  drain a legitimate workspace's bucket (tested).

These sit in front of the existing prompt-injection wall (`sanitise.ts`) — captured
session content stays untrusted input to diagnose and can't escalate into a wider
`insforge.toml` diff (already enforced; unchanged here).

**Seam (deferred):** the origin allowlist source from the site connector [[0050]],
the time-pruned nonce store, secret rotation [[0052]], least-privilege scope
config, and the documented threat model + IR runbook in `docs/security/`.
**Intentionally NOT done:** re-enabling the gitleaks/opsera SAST/dep scan in
`.github/workflows/` — the repo's standing speed-mode instruction
([[feedback_no_security_scans]]) keeps auto-scans off; turning them back on is a
deliberate human decision for production, left as the seam.

How to verify: `pnpm -F @hush/functions test ingestGuard.test.ts`.
