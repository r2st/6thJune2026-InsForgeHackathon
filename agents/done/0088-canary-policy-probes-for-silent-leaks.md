---
id: 0088
title: Canary policy probes for silent leaks and over-permissive RLS
role: architect
priority: P1
owner: claude-opus-4-8 (loop)
started: 2026-06-07
status: in-progress
depends_on: [0051, 0062, 0086]
demo_path: no — product (post-hackathon)
phase: production
epic: hardening
---

## Goal

Detect silent **leak** bugs that may not create user frustration by running
tenant-scoped canary probes against production and forked backends, then routing
confirmed policy regressions through the same confidence-tiered workflow.

## Why it matters

The current trigger is user frustration. That catches vanished rows well: a user
expects data and sees nothing. Leaks are different. A user who briefly sees
someone else's row may not rage-click, may not notice, or may quietly export it.
If Hush claims it catches "leaked tenants" and over-permissive RLS, it needs a
proactive detection path in addition to behavioral capture.

## Acceptance criteria

- [ ] Per backend connection, configure canary tenants/users/claims with minimal
      synthetic data or customer-approved safe fixtures.
- [ ] Scheduled probes cover: neighbor tenant reads, count endpoints, join paths,
      object/receipt URLs, and policy routes listed in `insforge.toml`.
- [ ] A leak candidate requires cross-tenant evidence: a canary principal can see
      rows or objects it should not, or a policy change increases visibility
      beyond the baseline.
- [ ] Reuse the differential replay suite ([[0033]]) and generalized taxonomy
      ([[0062]]) so fixes are tested on prod vs. fork before any PR/draft.
- [ ] Dispatch is conservative by default: over-permissive fixes route to draft
      PR or human review unless the policy blast radius is demonstrably tiny.
- [ ] Dashboard separates "user-reported vanished data" from "canary-detected
      leak risk" so the evidence and severity are clear.
- [ ] Probes obey privacy and cost limits: no raw customer rows stored, bounded
      frequency, and opt-in per workspace.

## Likely files / surfaces touched

- `functions/canaryProbes.ts` (new scheduled function)
- `functions/replay.ts`, `functions/safety.ts`, `functions/score.ts`
- `infra/insforge.toml` (canary config, probe results)
- `apps/dashboard/` (probe config + leak-risk findings)

## Notes

- This complements [[0087]] rather than replacing it: behavioral signals find
  user-visible vanished data; canaries find quiet security regressions.

## Outcome

Shipped the **pure leak-detection core** in `functions/canaryProbes.ts` (+ 17
tests, `functions/canaryProbes.test.ts`, tsc clean):

- **Cross-tenant evidence gate** — `evaluateProbe(spec, obs)` flags a leak only
  when a canary principal observes an id it does not own (or a count endpoint
  exposes more rows than the canary owns). A 4xx denial is the policy working,
  not a leak. Takes ids/counts only — never raw customer rows (privacy).
- **Severity** — `leakSeverity(n, blast, kind)` scales with leaked volume,
  weights `object_url`/`join` up (a single leaked receipt URL is already serious),
  and bumps a notch for a wide policy blast.
- **Differential confirm + conservative dispatch** — `confirmLeakFix(prod, fork)`
  mirrors the 0033 replay suite: a fix must reproduce on prod, be gone on the
  fork, and **never expose more on the fork** (widening = hard block).
  `leakDispatchTier` auto-PRs only a confirmed-closed, non-widening, tiny-blast,
  low-severity leak; everything wider/severe routes to draft PR or human review.

**Seam (deferred):** the scheduled `canaryProbes` edge function that actually runs
probes against a connected backend, canary fixture provisioning + opt-in/frequency
limits in `infra/insforge.toml`, and the dashboard leak-risk view separating
"user-reported vanished data" from "canary-detected leak risk". These depend on
the customer-backend connector [[0051]] and request-log instrumentation [[0086]] —
external, stay open there. The differential confirm reuses the [[0033]] suite shape.

How to verify: `pnpm -F @hush/functions test canaryProbes.test.ts`.
