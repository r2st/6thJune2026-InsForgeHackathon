---
id: 0042
title: Lim.run cloud-browser re-verification of the fix on the fork (+ live preview URL)
role: builder
priority: P1
owner:
started:
status: inbox
depends_on: [0006, 0008]
demo_path: yes — turns slide 06 from terminals into a clickable before/after the judge opens
sponsor: Lim.run
---

## Goal

After the policy replay ([[0008-parallel-replay-and-verdict]]) proves the fix on
the branch project, boot a **Lim.run** cloud browser pointed at the **forked**
backend, replay the user's interaction, and capture that the page now renders the
rows it should. Lim.run's shareable live-preview URL becomes a clickable
before/after embedded in the receipt page and the PR: prod (empty) vs fork
(populated), in a real browser the judge can open.

## Why it matters for the demo

The slide-06 money shot today is two terminals (row counts). Lim.run upgrades it
to *"open this link and watch the orders page go from empty to populated on the
forked backend."* That's the strongest possible visual proof, and it's the
Lim.run sponsor integration.

## The honesty distinction (read this first)

Deterministic page-replay was cut from v1 because replaying a **prod** session is
intractable (auth state, A/B variants, third-party SDKs, server time — none
transfer). **This ticket runs Lim.run against our own seeded fork, not prod.** We
control the fork's data ([[0010-demo-fixture-seed]]), its JWT
([[0007-jwt-forge]]), and its policy — so the page render IS reproducible. The
fragility we designed around was prod-determinism; the fork removes it.

Therefore Lim.run is **corroboration, never the gate**: the falsifiable verdict
remains the policy replay (0008). If the Lim.run re-verification is inconclusive
or unavailable, the policy verdict still stands and the PR still opens. Lim.run
only ever *adds* visual confidence — it can never block or fabricate a pass.

## Acceptance criteria

- [ ] `functions/limReverify.ts` exports `reverifyOnFork({ branchId, forkBaseUrl,
      forkJwt, expectedRows }) -> { rendered: boolean, previewUrl: string | null,
      shotUrl?: string }`.
- [ ] Boots a Lim.run browser instance via their TS SDK, navigates to the toy
      app pointed at the **fork** (inject `forkJwt` as the session), drives the
      same interaction that failed, and asserts the rows-shown count matches
      `expectedRows`.
- [ ] Returns the Lim.run **live-preview URL** (TTL'd past the pitch slot) so the
      receipt page and PR body can embed "open the fix, live."
- [ ] `Verdict` (or a sibling field) gains an optional `reverify?: { rendered,
      previewUrl }` — additive, never changes `bugConfirmed`/`fixVerified`.
- [ ] The confidence scorer is **not** gated on this — at most it's surfaced as a
      receipt line. Do not add a new hard signal that could fail the run.
- [ ] Env `LIMRUN_API_KEY` in `.env.example` + `functions.fix-trigger` secrets in
      `infra/insforge.toml`.
- [ ] Fallback: if Lim.run is unavailable, `reverifyOnFork` returns
      `{ rendered:false, previewUrl:null }` and the pipeline continues unchanged.
- [ ] `docs/architecture.md` §sponsors: Lim.run → "Test on a fork (visual
      re-verification)".

## Likely files / surfaces touched

- `functions/limReverify.ts` (new)
- `functions/fix-trigger.ts` (call after replay verdict; thread `previewUrl`)
- `functions/types.ts` (`Verdict.reverify?` or a `Reverification` type)
- `apps/receipt/components/*` (embed/iframe the preview URL), `functions/ship.ts`
  (PR body link)
- `infra/insforge.toml`, `.env.example`, `docs/architecture.md`

## Notes

- Lim.run docs: https://docs.limrun.com/docs — control plane (org key) mints a
  per-instance token; use the TS SDK. Confirm browser-instance support vs the
  iOS/Android simulator focus; if only simulators are available, a mobile-web
  render of the fork still works and is still a strong artifact.
- Keep the boot off the critical latency path of the demo — fire it in parallel
  with `ship` so the PR isn't waiting on a browser cold start.

## Outcome
<!-- Fill in when moving to done/. 2-3 lines max. -->
