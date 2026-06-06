---
id: 0042
title: Lim.run cloud-browser re-verification of the fix on the fork (+ live preview URL)
role: builder
priority: P1
owner: claude
started: 2026-06-06
status: done
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

- [x] `functions/limReverify.ts` exports `reverifyOnFork({ branchId, forkBaseUrl,
      forkJwt, expectedRows }) -> { rendered: boolean, previewUrl: string | null,
      shotUrl?: string }`.
- [x] (port isolated) Boots a Lim.run browser instance via their TS SDK, navigates to the toy
      app pointed at the **fork** (inject `forkJwt` as the session), drives the
      same interaction that failed, and asserts the rows-shown count matches
      `expectedRows`.
- [x] Returns the Lim.run **live-preview URL** (TTL'd past the pitch slot) so the
      receipt page and PR body can embed "open the fix, live."
- [x] `Verdict` (or a sibling field) gains an optional `reverify?: { rendered,
      previewUrl }` — additive, never changes `bugConfirmed`/`fixVerified`.
- [x] The confidence scorer is **not** gated on this — at most it's surfaced as a
      receipt line. Do not add a new hard signal that could fail the run.
- [x] Env `LIMRUN_API_KEY` in `.env.example` + `functions.fix-trigger` secrets in
      `infra/insforge.toml`.
- [x] Fallback: if Lim.run is unavailable, `reverifyOnFork` returns
      `{ rendered:false, previewUrl:null }` and the pipeline continues unchanged.
- [~] `docs/architecture.md` §sponsors: Lim.run → "Test on a fork (visual
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

- **What shipped:** `functions/limReverify.ts` — `reverifyOnFork()` behind a
  `LimSdk` port, timeout-bounded, **always resolves** (unavailable/mismatch/
  timeout/error → benign `{rendered:false, previewUrl:null}`). `Verdict.reverify?`
  + `Reverification` type added (additive). fix-trigger calls it in the fork
  branch as `reverifyFork` dep (default no-ops instantly without LIMRUN_API_KEY);
  attaches to the verdict, emits a `testing` event with the previewUrl. openPr's
  `verdictLine` appends a "See it live on the fork" link when present. 6 tests.
- **Honesty rail held:** corroboration only — never touches bugConfirmed/
  fixVerified, never gates the score, can't fail the run. The policy replay (0008)
  remains the falsifiable verdict.
- **What was NOT done:** the real Lim.run SDK is **not wired** (the `LimSdk` port
  is the seam; confirm the API at docs.limrun.com first). Until wired, reverify is
  honestly `unavailable`. Don't check the Lim.run sponsor box until a real adapter
  renders a fork in a demoable run. architecture.md sponsor-map note deferred —
  that file has parallel-agent edits in flight.
- **LIVE-TESTED 2026-06-06 (key provided):** Lim.run is **mobile infra**, not a
  cloud browser — but it fits. Real SDK is `@limrun/api` v0.30.0. Verified against
  the live API: `androidInstances.create({ wait:true, spec:{ sandbox:{
  playwrightAndroid:{ enabled:true } } } })` reaches state `ready` and returns a
  `signedStreamUrl` (the clickable live preview ✓) plus a Playwright `wss://`
  endpoint (✓). Teardown via `delete(id)` works. Auth via the org key works.
- **Real adapter shipped:** `functions/lib/limSdk.ts` (`createLimSdk`) wires the
  `LimSdk` port to `@limrun/api`. fix-trigger's default `reverifyFork` now uses it
  when `LIMRUN_API_KEY` is set. Ran `reverifyOnFork` end-to-end through the live
  adapter: provisioned → got a real `signedStreamUrl` → `preview_only` → torn down.
- **`preview_only` state added:** the instance + clickable preview are real; the
  automated row-count needs a `countRows` Playwright driver (injectable seam in
  limSdk.ts) which can only be verified once the toy app is deployed against a
  live fork. Until then reverify honestly returns `preview_only` — judge gets a
  live fork link, we claim no automated pass. Corroboration rail intact.

- **Verify:** `pnpm --filter @hush/functions test` (238) · demo (15) · both typecheck clean.

