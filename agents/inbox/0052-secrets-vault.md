---
id: 0052
title: Per-workspace encrypted secrets vault
role: architect
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

Every customer credential (GitHub App private key + installation refs, InsForge
backend tokens, optional BYO LLM keys) is stored **encrypted at rest, scoped to
the workspace**, decryptable only by the edge functions that need it at run time —
never in `.env`, never in logs, never readable cross-workspace.

## Why it matters

The demo bakes secrets in `.env` / shared InsForge secrets. A multi-customer
product holds *other people's* keys — a breach is existential. This is the
security backbone for GitHub (0049), backends (0051), and BYO-LLM (0055).

## Acceptance criteria

- [ ] `secrets` table: `(workspace_id, key, ciphertext, kms_key_id, created_at,
      rotated_at)`, RLS-scoped, with the plaintext never selectable.
- [ ] Envelope encryption: a per-workspace data key wrapped by a master key (KMS
      or InsForge-managed); functions decrypt just-in-time, in memory only.
- [ ] A typed accessor `getSecret(workspaceId, key)` used by ship/applyDiff/
      diagnose — the only path to a plaintext credential.
- [ ] Rotation + revocation API; audit log of every secret read (who/when/which
      run) for [[0057-observability-ops]].
- [ ] Redaction guarantee: secrets can never reach `console`/receipt/PR bodies —
      extend the existing PII scrubber to cover credential shapes.
- [ ] Migration: move the demo's `.env`/InsForge-secret usage behind this vault.

## Likely files / surfaces touched

- `functions/lib/vault.ts` (new), `functions/lib/insforgeClient.ts`
- `infra/insforge.toml` (`secrets`, `secret_access_log`)
- All credential consumers: `ship.ts`, `applyDiff.ts`, `forgeJwt.ts`, `llm.ts`

## Notes

- Pairs tightly with [[0049-github-app-connect-repos]] (the App private key is the
  highest-value secret) and [[0051-customer-backend-connector]].

## Outcome
