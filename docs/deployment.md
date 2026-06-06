# Hush — deployment

> Living doc. Update as services come up. Order matters; sections are in deploy order, not in "tour" order.

## 0. Scope

This doc covers what it takes to stand up Hush end-to-end for the demo: backend on InsForge, two Vercel apps (demo store + receipt page), the GitHub PR loop, and the demo-day fallback. It does **not** cover ongoing ops, scaling, or customer onboarding — out of scope for the 9-hour build.

## 1. Service map

```
                  ┌─────────────────────────────────────────────────┐
                  │                 InsForge (prod)                 │
                  │  schema · RLS · pgvector · Storage · Realtime   │
                  │             AI gateway · Edge fns               │
                  └──────────────────────────┬──────────────────────┘
                                             │
                       ┌─────────────────────┼─────────────────────┐
                       │                     │                     │
              ┌────────▼─────────┐  ┌────────▼─────────┐  ┌────────▼────────┐
              │  Vercel: demo    │  │ Vercel: receipt  │  │  InsForge       │
              │   toy storefront │  │  realtime status │  │  branch project │
              │  rrweb capture   │  │   click-through  │  │  (fix sandbox)  │
              └────────┬─────────┘  └────────▲─────────┘  └────────┬────────┘
                       │                     │                     │
                       └──── session ────────┤                     │
                              capture        │                     │
                                             │             ┌───────▼──────┐
                                  ┌──────────┴───────┐     │   Devin      │
                                  │ Edge fn: ingest  │────►│  fix loop    │
                                  │  embed · dedup   │     └───────┬──────┘
                                  └──────────────────┘             │
                                                                   ▼
                                                          ┌────────────────┐
                                                          │  GitHub repo   │
                                                          │  PR + clip URL │
                                                          └────────────────┘
```

Six surfaces. Bring them up in this order: **InsForge → branch project → edge fns → Vercel demo → Vercel receipt → Devin webhook → GitHub PR loop**.

## 1a. Live deployment status

> Verified 2026-06-06. This table is the source of truth for "what can a judge click right now." Keep it honest — a ⏳ that says ✅ is worse than no table.

| Surface | URL | Status |
|---|---|---|
| Backend API (InsForge `hush`) | `https://w369egnp.us-east.insforge.app` | ✅ live — **health: `/api/health`** → `{"status":"ok","version":"2.2.0"}`. Bare `/` returns `Cannot GET /` by design (API host, no homepage); that is **not** an outage. |
| Receipt page | `https://w369egnp.insforge.site/` | ✅ live — renders "nothing captured yet"; opens individual runs at `/r/<runId>`. |
| Receipt — demo mode | `https://w369egnp.insforge.site/r/demo?demo=1` | ✅ live — rehearses the full five-step arc with **no backend**. The safe stage path. |
| Victim app (`apps/demo`) | _not deployed_ | ⏳ builds + runs locally (`pnpm --filter demo dev` → `http://localhost:3000/orders`). Deploy with `cd apps/demo && vercel --prod` (§6). |

**Gotchas that read as "broken" but aren't:**

- **Bare backend host 404** — `https://w369egnp.us-east.insforge.app/` → `Cannot GET /`. Expected. Test liveness with `/api/health`, not `/`.
- **`/orders` 404 on the receipt host** — the receipt host serves `apps/receipt`, not `apps/demo`. The victim app is a separate deploy that hasn't shipped; `/orders` only exists on `localhost:3000` today.
- **Not** `https://z739c3mi.insforge.site/` — that subdomain is **Authmatic**, an unrelated prior project. Not a Hush surface.

## 2. Prerequisites

### Accounts (sign in before the clock starts)

- [ ] InsForge (prod project + a branch project under it)
- [ ] Vercel (one team, two projects: `hush-demo`, `hush-receipt`)
- [ ] GitHub (the [target repo](https://github.com/r2st/6thJune2026-InsForgeHackathon); a separate "victim app" repo for the demo PR to land in)
- [ ] Devin (workspace pointed at the victim repo)
- [ ] Domain (optional — `hush.<sponsor>.dev` if event has subdomains)

### CLIs

```bash
# already-installed check
command -v insforge && insforge --version
command -v vercel   && vercel --version
command -v gh       && gh auth status
command -v node     && node --version    # ≥20
command -v pnpm     && pnpm --version    # ≥9
```

If any are missing, install before T+0h. Install during the hackathon costs ~15 min you don't have.

### Secrets we will need

Collect these *before* you start coding. A single shared 1Password / vault note works. Never paste into chat or commit.

| Name | Where it lives | Who needs it |
|---|---|---|
| `INSFORGE_PROJECT_ID` | InsForge dashboard | demo, receipt, edge fns |
| `INSFORGE_SERVICE_KEY` | InsForge dashboard → API keys | edge fns only |
| `INSFORGE_ANON_KEY` | InsForge dashboard → API keys | demo, receipt |
| `INSFORGE_BRANCH_PROJECT_ID` | After §4 below | edge fns |
| `ANTHROPIC_API_KEY` | Anthropic console → API keys | **diagnosis** (`diagnose()` — direct Anthropic call, ticket 0018) |
| `OPENROUTER_API_KEY` (or InsForge AI key) | InsForge AI Gateway / OpenRouter | ingest **embeddings** (`bug_runs.embedding`) |
| `DEVIN_API_KEY` | Devin → settings → API | edge fns |
| `GITHUB_TOKEN` | `gh auth token` (a fine-grained PAT scoped to the victim repo) | edge fns |
| `VERCEL_TOKEN` | Vercel → account → tokens | CI only |

### GitHub Actions deploy secrets

The repo has a manual deploy workflow at `.github/workflows/ci.yml`. It always
runs lint/typecheck/test/build on PRs and pushes to `main`; it deploys only when
started with `workflow_dispatch` and `deploy=true`.

Set these repository **secrets** before using the deploy job:

| GitHub secret | Notes |
|---|---|
| `INSFORGE_ACCESS_TOKEN` | InsForge CLI auth token for CI. |
| `INSFORGE_PROJECT_ID` | Linked prod project ID. |
| `INSFORGE_URL` | `https://w369egnp.us-east.insforge.app`. |
| `INSFORGE_ANON_KEY` | Used as `NEXT_PUBLIC_INSFORGE_ANON_KEY` during validation/deploy. |
| `INSFORGE_SERVICE_KEY` | Server-only; syncs to InsForge function secrets and Vercel demo runtime env. |
| `INSFORGE_BRANCH_PROJECT_ID` | Fork used by `fix-trigger`. |
| `ANTHROPIC_API_KEY` | Diagnosis model call. |
| `OPENROUTER_API_KEY` | Ingest embeddings. |
| `DEVIN_API_KEY` | PR/fix agent. |
| `HUSH_GITHUB_TOKEN` | Fine-grained PAT for the victim repo. Do **not** name this `GITHUB_TOKEN`; Actions reserves that name. The workflow syncs it into InsForge as runtime secret `GITHUB_TOKEN`. |
| `VERCEL_TOKEN` | Vercel deploy token. |
| `VERCEL_ORG_ID` | Vercel team/user ID. |
| `VERCEL_DEMO_PROJECT_ID` | Vercel project ID for `apps/demo`. |
| `VERCEL_RECEIPT_PROJECT_ID` | Vercel project ID for `apps/receipt`. |

Set these repository **variables** unless you prefer to store them as secrets:

| GitHub variable | Notes |
|---|---|
| `NEXT_PUBLIC_INSFORGE_URL` | Public base URL. PR validation has a Hush fallback; production deploy requires this or secret `INSFORGE_URL`. |
| `NEXT_PUBLIC_INGEST_URL` | Public ingest function URL. Production deploy requires this. |
| `NEXT_PUBLIC_RECEIPT_URL` | Deployed receipt app URL once known. Production deploy requires this. |
| `DEVIN_TARGET_REPO` | Victim repo in `owner/repo` form. Can be a secret instead. The workflow syncs this into InsForge as runtime secret `GITHUB_REPO`. |

## 3. InsForge backend (T+0h to T+1h)

### Declarative config

Hush leans on `insforge.toml` as the single source of truth. The skill bundled in this session — `insforge-cli` — applies it.

Minimum surface for the demo:

- `tables.orders` (with RLS) — the table whose policy we'll patch in the demo
- `tables.bug_runs` — every Hush run; embeddings live here
- `tables.bug_decisions` — close-PR feedback for the learning loop
- `tables.tenants` — for RLS scoping
- `storage.buckets.clips` — session video clips with signed URLs
- `realtime.channels.receipt` — broadcast bus for the receipt page
- `functions.ingest` — rrweb webhook (primary capture path; Replicas only if the sponsor surfaces a working API)
- `functions.fix-trigger` — kicks Devin, opens the PR
- `auth.policies.*` — JWT claim → RLS bridge

### Bring-up

```bash
# from repo root
insforge login
insforge link <project-id>        # link this repo to the prod project
insforge config apply             # applies insforge.toml — schema, RLS, storage, realtime
```

### Smoke check before moving on

```bash
insforge db query "select count(*) from orders"   # expect 0 — schema reachable
insforge functions list                            # expect ingest, fix-trigger
insforge storage ls clips                          # expect bucket exists
```

If any of those fail, **stop and fix.** Everything else assumes this is green.

## 4. InsForge branch project (T+1h)

The branch project is what makes the fix safe. We replay the patched RLS against a forked backend; if it goes wrong, only the fork burns.

```bash
insforge branch create hush-fix-sandbox --from prod
insforge branch list                       # capture the branch project ID
# export the branch ID for the edge fns
export INSFORGE_BRANCH_PROJECT_ID=<id>
```

Seed two demo tenants in the branch project so the policy-leak case is visible:

```bash
insforge db seed --branch hush-fix-sandbox \
  --file demo/seed/two-tenants.sql
```

(File doesn't exist yet — write it in §10's checklist when you do the demo bug.)

## 5. Edge functions (T+1h to T+3h)

Two functions, both deployed via `insforge functions deploy`.

### `ingest`

Path: `functions/ingest.ts` (in this repo).

Receives the session payload from rrweb. (Replicas remains a plug-in capture option — wire only if the sponsor's API materialises demo-day. See [`ideas/FINAL-analysis.md` §2.4](../ideas/FINAL-analysis.md).) Does:

1. Pulls the backend request-log window matching the session timestamp.
2. Embeds (session shape + request log + RLS decision) via InsForge AI.
3. pgvector dedup vs `bug_runs.embedding` — skip if similar to a past dismissed run.
4. Inserts a new row in `bug_runs`, status = `captured`.
5. Broadcasts `{step: 'captured'}` on Realtime channel `receipt`.
6. Calls `fix-trigger` synchronously.

Env: `INSFORGE_SERVICE_KEY`, `OPENROUTER_API_KEY` (ingest embeddings).

### `fix-trigger`

Path: `functions/fix-trigger.ts`.

1. Spins up the branch project (already created in §4 — just confirms it's reachable).
2. Generates the candidate TOML diff via a direct Anthropic call (`ANTHROPIC_API_KEY`, ticket 0018 — forced tool, schema-validated).
3. Applies the diff on the branch via `insforge config apply --branch …`.
4. Runs a Limrun playback against the branch to confirm the bug is gone.
5. Scores confidence (diff size × past-merge similarity).
6. Calls Devin to open the PR (high) / draft PR (medium) / GitHub issue (low).
7. Broadcasts the result on the Realtime channel.

Env: all of them.

### Deploy

```bash
insforge functions deploy ingest
insforge functions deploy fix-trigger
```

Smoke check: hit each with a fixture payload.

```bash
curl -X POST $(insforge functions url ingest) \
  -H "content-type: application/json" \
  --data @demo/fixtures/session.json
# expect 200, expect a row in bug_runs, expect a realtime event in receipt
```

## 6. Vercel — demo storefront (T+3h)

The "victim app." Toy e-commerce, broken RLS policy on `orders`, rrweb embedded.

```bash
cd apps/demo
vercel link                            # project: hush-demo
vercel env add INSFORGE_PROJECT_ID
vercel env add INSFORGE_ANON_KEY
vercel env add NEXT_PUBLIC_INGEST_URL  # the ingest fn URL from §5
vercel --prod
```

Verify: open the deployed URL, sign in as `demo-user-a`, navigate to `/orders` — should render empty (the bug).

## 7. Vercel — receipt page (T+5h)

The judge-facing live status page. Subscribes to the Realtime channel.

```bash
cd apps/receipt
vercel link                            # project: hush-receipt
vercel env add INSFORGE_PROJECT_ID
vercel env add INSFORGE_ANON_KEY
vercel --prod
```

Verify: open `/receipt/<run-id>` after triggering an ingest call from §5's smoke test — status lines should stream.

## 8. GitHub PR loop (T+6h)

The "victim app" repo (separate from this one) is where Hush will land PRs.

```bash
gh repo create <victim-repo> --private --clone
# in the victim repo, drop an insforge.toml that mirrors the demo backend
gh secret set INSFORGE_TOKEN     # for branch-project replay in CI
gh secret set INSFORGE_PROJECT_ID
```

The edge function uses a fine-grained PAT — **do not** reuse the user's `gh` CLI token. Mint a fresh one scoped to:
- `contents: read+write`
- `pull-requests: read+write`
- `issues: read+write`

Set it as `GITHUB_TOKEN` in the InsForge function env.

Branch protection on `main` in the victim repo: **disabled** for the demo. If it's on, Devin's auto-PR will require approval and the demo dies on stage.

## 9. Devin webhook (T+6h)

Devin needs:
- The victim repo URL
- The `GITHUB_TOKEN`
- The "fix prompt" template (lives in `agents/_template.md` for the human-facing version; the runtime version lives in `functions/fix-trigger.ts` as a constant)

Devin returns a PR URL. The edge function writes it to `bug_runs.pr_url` and broadcasts the final status.

## 10. Smoke test — the demo path

Single end-to-end pass that mirrors the 60-second demo:

1. Open `apps/demo/orders` as `demo-user-a` in a fresh browser session.
2. Rage-click "Reload" five times within three seconds.
3. rrweb fires → `ingest` runs.
4. Receipt page lights up: `captured ✓ → diagnosing → fixing → shipped`.
5. PR appears on the victim repo. CI green on the branch project.
6. Click the PR — it should embed the session clip via a signed Storage URL.

If the full path runs in <90 s on your machine, you're demo-ready.

## 11. Demo-day runbook

### Pre-demo (T-20 min)

- [ ] Both Vercel projects on a green prod deploy
- [ ] `insforge config status` clean (no drift between toml and prod)
- [ ] Branch project healthy: `insforge branch status hush-fix-sandbox`
- [ ] Pre-recorded demo video on the laptop **and** uploaded to YouTube unlisted (one is the fallback for the other)
- [ ] `demo/recordings/hush-final-v?.mp4` open in QuickTime, ready to fullscreen
- [ ] Wifi tethered to phone hotspot as a second network
- [ ] Browser cache cleared, demo-user-a logged in fresh
- [ ] Receipt page on a second tab, font scaled up for the projector

### If something breaks on stage

| Symptom | Action |
|---|---|
| Ingest fn 5xxs | Switch to the pre-recorded video without acknowledging the failure. |
| Devin times out | Pre-staged PR exists on the victim repo — open it directly. |
| Realtime channel silent | Receipt page has a `?demo=replay` query that runs a scripted version. |
| Vercel demo 502s | Local-host the demo app (`vercel dev`) on hotspot. |
| InsForge dashboard down | Show the GitHub PR + the session clip from the YouTube fallback. |

### Don't do

- Don't try to debug live. The demo is a story, not a build session.
- Don't switch to dev tools to "show what's really happening." It always looks worse than the demo.
- Don't apologize for fallbacks. Audiences don't notice unless you point.

## 12. Rollback

If post-demo we ship something dumb to `prod`:

```bash
insforge config rollback             # reverts to last applied insforge.toml
vercel rollback                       # in each project dir, reverts to previous prod
```

Branch projects auto-cleanup on TTL — no manual delete needed unless you're paying.

## 13. Cost (demo budget)

Rough envelope — confirm against current pricing.

| Service | Tier needed | Demo cost |
|---|---|---|
| InsForge | Free / hobby + one branch project | $0 |
| Vercel | Hobby × 2 projects | $0 |
| Devin | One workspace, ~10 sessions | within free credits if eligible |
| OpenRouter / InsForge AI | ~50 embeddings + ~10 completions | <$1 |
| GitHub | Free | $0 |

If we blow the free tiers it's because the demo got way more traffic than expected — a good problem.

## 14. Post-demo cleanup

Not for demo day. The day after, before any of this stays running:

- [ ] Revoke the demo `GITHUB_TOKEN`
- [ ] Delete the `hush-fix-sandbox` branch project
- [ ] Rotate `INSFORGE_SERVICE_KEY` if it ever appeared in a Vercel build log
- [ ] Archive both Vercel projects (don't delete — judges may revisit)

---

## Open questions

- [ ] Replicas is treated as a plug-in path only; rrweb is the primary capture. Decision rationale in [`ideas/FINAL-analysis.md` §2.4](../ideas/FINAL-analysis.md). Confirm at T+0h that no sponsor track forces Replicas integration.
- [ ] Does the InsForge AI gateway hit OpenRouter directly, or do we proxy? — affects the OPENROUTER_API_KEY line in §2
- [ ] Branch project warm-boot time — needs measuring at T+1h so the demo-clock budget is honest
