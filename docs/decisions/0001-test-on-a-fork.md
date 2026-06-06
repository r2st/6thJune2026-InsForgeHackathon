# 0001 — Test on a fork

- **Date:** 2026-06-06
- **Status:** proposed
- **Decider(s):** Hush team

## Context

Step 04 of the Hush loop — *Test on a fork* — is the technical claim the
whole pitch rests on. The slide-6 money shot is two terminals side by side:
**prod (red)** still reproduces the bug, **branch (green)** is fixed. If
that visual doesn't land, the deck collapses to "we open speculative PRs."

The pivot in `ideas/FINAL-analysis.md` made one critical move: **replay the
policy, not the page.** We are *not* booting a clean browser sandbox and
re-driving the user's session deterministically — that is the hardest
problem in session-replay testing, and we will lose on it in 9 hours. We
are replaying the *failing HTTP request* against a forked backend with a
patched `insforge.toml`, then comparing the response to prod.

This ADR locks in the mechanics of that fork-and-replay.

## Decision

A *fork test* is the sequence:

1. **Capture** the failing request from the InsForge edge-fn request log
   (method, path, headers including the user's JWT, body, query string).
2. **Spin up** an InsForge branch project — pre-warmed from a pool so we
   pay 0–2s instead of 8–15s at demo time.
3. **Seed** the fork with a deterministic fixture (the demo store has 3
   orders for the demo tenant; in prod, the fork inherits schema and is
   seeded from a snapshot of the affected rows only — not full prod data).
4. **Apply** the candidate `insforge.toml` diff with `insforge config
   apply --env <branch-id>`.
5. **Forge** a fresh JWT signed by the fork's key with the captured
   claims (we control the fork's auth config, so this is one-step).
6. **Replay** the captured request twice in parallel — once against prod's
   read-only API, once against the fork — and diff the responses.
7. **Verdict:**
   - prod returns N rows, fork returns M rows, M > N → **bug confirmed,
     fix verified.** Confidence input.
   - prod and fork agree → **not a bug, or not a fix.** Drop to issue.
   - fork errors → **patch is malformed.** Surface lint error on receipt.
8. **Cleanup** — the fork carries a 1h TTL and is destroyed on PR merge
   or close.

## Alternatives considered

- **Replay the full session in a sandboxed browser (Limrun / Playwright
  against the fork).** Rejected for the demo path: requires same auth
  state, same A/B variant, same third-party SDKs, same server time. Most
  fixable bugs would fail to reproduce. Keep as a *post-pivot extension*
  for the cases where a frontend rerun adds signal.
- **Run the policy SQL locally with a stubbed JWT, skip the branch
  project.** Faster, but loses the InsForge structural moat. Kept as the
  **fallback path** if branch-project spin-up fails mid-demo (see
  ticket 0012). Never the primary path.
- **Fork from a full prod snapshot.** Privacy nightmare, and slow. We
  fork *schema and policy*, seed only the rows the failing request
  touches.
- **One persistent test backend, no per-bug fork.** Race conditions
  between concurrent Hush loops, no parallel confidence checks,
  no PR-to-branch traceability. Pass.

## Consequences

**What this makes easy**

- The InsForge "why us" answer becomes structural: *Supabase can't safely
  test a policy diff against real schema. We can.*
- Confidence scoring has real signal — the replay row-count delta *is*
  the test result.
- The PR carries reproducible proof (branch URL judge can click).

**What this makes hard**

- Demo timing budget is tight (target: 45s end-to-end from rage-click to
  PR). Pre-warming the branch pool is non-optional.
- JWT forge needs the fork's signing key on hand. We control fork keys,
  so this is solvable but must be wired before demo.
- We need a deterministic demo fixture (3 orders, 2 tenants) seeded into
  every pre-warmed fork.

**What we'll regret if it's wrong**

- If branch-project spin-up is consistently >15s, the receipt page stalls
  on screen and the pitch's "in under a minute" claim breaks. **Mitigation:**
  pre-warm 2 forks at demo start (ticket 0004) and a trace-only fallback
  (ticket 0012).
- If the replay returns the same result on prod and fork because of a
  cache or read-replica lag, the verdict is wrong. **Mitigation:** force
  fork API to bypass cache; assert response timestamps.

## Demo-time perf budget

| Step                                   | Budget | Owner ticket |
|----------------------------------------|--------|--------------|
| Capture failing request (edge-fn log)  | 1s     | 0005         |
| Diagnose (InsForge AI)                 | 6s     | (existing)   |
| Branch project ready (from pool)       | 2s     | 0004         |
| Apply TOML diff                        | 3s     | 0006         |
| JWT forge                              | <1s    | 0007         |
| Parallel replay (prod + fork)          | 4s     | 0008         |
| Verdict + receipt update               | 1s     | 0009         |
| PR open                                | 4s     | 0010         |
| **Total**                              | **~22s** | — sticker target ≤45s on stage |

## Open questions

- [ ] Do branch projects inherit the parent project's `insforge.toml` at
      spin-up, or empty? Need to verify in the InsForge skill before
      ticket 0006 lands.
- [ ] What's the published TTL minimum? If <1h, we may need a renewer.
- [ ] Realtime channel — does it survive across branch projects, or do we
      need to bridge prod → fork events?
