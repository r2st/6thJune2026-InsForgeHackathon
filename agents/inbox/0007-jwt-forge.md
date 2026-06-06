---
id: 0007
title: Forge a JWT signed by the fork's key with captured claims
role: architect
priority: P0
owner:
started:
status: inbox
depends_on: [0004, 0005]
demo_path: yes — without a valid JWT, the replay 401s and the verdict is wrong
---

## Goal

`hush/forgeJwt.ts` exports `forgeForkJwt(branchId, originalClaims)
-> string`. Reads the fork's signing secret (we control it, since we
provisioned the branch), re-signs the captured claims for the fork's
audience, and returns a Bearer-ready token.

## Why it matters for the demo

The captured prod JWT is signed by prod's key — it won't validate
against the fork. The whole point of the fork is to test the *policy*
against the same claims the user actually had. We need the claims
intact and the signature valid for the fork.

## Acceptance criteria

- [ ] Claims preserved verbatim (sub, tenant fields, exp +5min from now)
- [ ] Audience/issuer rewritten to the fork's values
- [ ] Signature verifies against the fork's published JWKS
- [ ] Refuses to forge if exp would be in the past
- [ ] Works for both the buggy claim shape (`tenant`) and the new shape
      (`tenant_ids[]`) — that's the whole reason this bug exists

## Likely files / surfaces touched

- `hush/forgeJwt.ts`
- `.hush/pool.json` (reads per-fork signing secret)

## Notes

This is *not* a security risk in the hackathon context — we control
both ends of the fork. In production deployment, the security model is
different and should be revisited in a follow-up ADR.

## Outcome
