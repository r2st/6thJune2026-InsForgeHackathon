# Hush — InsForge Hackathon, 6 June 2026

The bug-fixer for the bugs that don't crash. Catches silent backend
RLS / auth / policy misfires by correlating a user's frontend
frustration with the matching request log, patches `insforge.toml` on
a forked InsForge branch project, and ships the PR before the user
finishes writing the support ticket.

> **👩‍⚖️ Judges:** see [SUBMISSION.md](SUBMISSION.md) for the full write-up and live links.
> **Try it now:** [▶ Demo](https://w369egnp.insforge.site/r/demo?demo=1) ·
> [🖥 Deck](https://w369egnp.insforge.site/pitch.html) ·
> [🐛 The bug](https://hush-acme-store.vercel.app/orders?user=migrated) ·
> [✅ The fix PR](https://github.com/r2st/hush-victim-acme/pull/1)

## What problem does it solve?

**Most bugs don't crash — and the silent ones are the ones that lose customers.**

Error trackers like Sentry only catch bugs that throw an exception. But the
most damaging bugs in modern SaaS are silent: a logged-in customer opens "My
Orders" and sees an empty page even though their orders exist. A row-level-
security policy quietly filters everyone whose JWT migrated to a new claim
shape. The server returns `200 OK`. Nothing throws. Sentry sees nothing. The
dev sees nothing. The customer just leaves — and the only signal is a support
ticket days later that no one can reproduce.

These silent backend bugs — RLS misfires, stale auth claims, policy
regressions, leaked or vanished records — are invisible to every tool built
around stack traces. **Hush is the bug-fixer for the bugs that don't crash.**

## Project description

**Hush** watches for the bugs your error tracker can't see, traces each one
from the frustrated user all the way to the backend policy that caused it, and
ships the fix as a reviewable pull request — before the user finishes writing
the support ticket.

When a user gets stuck (rage-clicks, a dead click, an abandoned form), Hush
runs a five-step loop:

1. **Watch** — captures the session with rrweb and fires on the frustration signal.
2. **Correlate** — links that frontend symptom to the exact backend request that
   failed, by matching the session against the request log. This turns "the page
   is empty" into "the `orders_select` RLS policy returned 0 rows."
3. **Diagnose** — InsForge AI reads the failing request + the relevant
   `insforge.toml` slice and explains, in plain English, which policy or JWT
   claim misfired and how to fix it.
4. **Test on a fork** — Hush forks the entire backend (an **InsForge branch
   project**), applies the proposed `insforge.toml` patch, and replays the
   failing request against **both** prod and the fork. Prod still returns 0 rows;
   the fork returns the 3 that were always there — falsifiable proof, not a guess.
5. **Ship** — opens a PR with the diagnosis, the before/after policy trace, and
   the session clip, routed by a confidence score: high → PR with the fix,
   medium → draft PR with the failing test, low → an issue. A deterministic
   safety rail blocks any patch that *widens* access, so a fix can never become
   a leak.

**Why it can only be built on InsForge.** To safely propose a policy patch you
must run it against prod-shaped data and compare deterministically — which means
forking the whole backend (schema + auth + RLS) and replaying. That's InsForge
**branch projects**. And the fix itself is a diff against the declarative
**`insforge.toml`** — small, reviewable, reversible, within an agent's one-shot
range. Supabase has RLS but no branch projects; Neon has branches but no auth
layer; neither composes. Hush exists *because* InsForge exposes a forkable
backend with declarative auth.

**It learns.** Every resolved fix is recorded in **Memoir** ("git for AI
memory"): a past *merged* fix raises confidence on similar bugs, a *rejected*
one lowers it — so Hush gets quieter and sharper per team over time. **Lim.run**
boots a real cloud instance on the fork for a clickable "see the fix live" link,
and **Replicas** / **Devin** are the background coding agents that can land the
patch.

**Stack:** InsForge (Postgres · pgvector · RLS · branch projects · Realtime · AI
· edge functions) · rrweb · Memoir · Lim.run · Replicas · Devin · Vercel ·
Next.js.

## Live demo

**Pitch deck:** [https://w369egnp.insforge.site/pitch.html](https://w369egnp.insforge.site/pitch.html) — 10 slides, arrow-keys / click to advance, `F` for fullscreen.

**Click-path (the 90-second pitch):**
[1) Acme Store — empty orders](https://hush-acme-store.vercel.app/orders?user=migrated) →
[2) Receipt demo-mode — capture→ship](https://w369egnp.insforge.site/r/demo?demo=1) →
[3) The fix PR](https://github.com/r2st/hush-victim-acme/pull/1)

| Surface | URL | State |
|---|---|---|
| **Pitch deck** (the 10-slide presentation) | https://w369egnp.insforge.site/pitch.html | ✅ deployed |
| **Receipt page** (judge-facing live status) | https://w369egnp.insforge.site/ | ✅ deployed |
| **Receipt — demo mode** (full arc, no backend needed) | https://w369egnp.insforge.site/r/demo?demo=1 | ✅ deployed · **start here** |
| **Backend** (InsForge project `hush`, seeded demo bug) | https://w369egnp.us-east.insforge.app/api/health | ✅ live — API host; bare `/` returns `Cannot GET /` by design, check `/api/health` |
| **Victim app** (`apps/demo` — "Acme Store / My Orders") | https://hush-acme-store.vercel.app/orders | ✅ deployed (Vercel) · migrated user → empty page; legacy → 3 orders |
| **PR target** (`hush-victim-acme` — where Hush opens the fix PR) | https://github.com/r2st/hush-victim-acme/pull/1 | ✅ live PR (4-line `insforge.toml` diff) |

> The **demo-mode receipt** (`/r/demo?demo=1`) rehearses the whole five-step
> arc — capture → correlate → diagnose → fork-test → ship — with no backend,
> so it can't flake on stage. The victim app is the left-screen "Acme Store"
> where a migrated user opens **My Orders** and sees an empty page; toggling
> to the legacy user shows the 3 orders that were always there. That contrast
> is the 0:00 beat of the pitch.

> **Demo-day note — drive the loop from the receipt demo-mode, not a live
> rage-click.** A rage-click on the live storefront posts to the `ingest` edge
> fn, but ingest requires a JWT carrying a `tenant` claim and the storefront has
> no login flow (the `tenant`/`tenant_ids` claim is modeled in the fixture and
> proven at the SQL/fork level, not wired into real InsForge auth tokens) — so
> the capture currently 401s ("no tenant in token") and the receipt won't light
> up from a live click. Use the storefront for the visible empty-page beat, then
> `/r/demo?demo=1` to narrate capture→ship. Closing the gap = a demo login that
> mints a tenant-claimed token (future ticket).

## Quick links

- **Canonical pitch** — [ideas/FINAL.html](ideas/FINAL.html)
- **Day-of playbook** — [ideas/guidelines.html](ideas/guidelines.html)
- **Hackathon brief & rubric** — [docs/brief.md](docs/brief.md)
- **Architecture** — [docs/architecture.md](docs/architecture.md) · visual: [docs/architecture.html](docs/architecture.html)
- **Pitch script & slides** — [demo/pitch-script.md](demo/pitch-script.md) · [demo/slides/](demo/slides/)
- **What to work on next** — [agents/inbox/](agents/inbox/)
- **Code map** — [IMPLEMENTATION.md](IMPLEMENTATION.md)
- **Winning playbook** — [research/winning-tips.md](research/winning-tips.md)

### Analysis trio (canonical thinking — read before drifting)

- **[ideas/FINAL-analysis.md](ideas/FINAL-analysis.md)** — pivot brief. Why we rebuilt Hush around backend RLS instead of frontend session replay; what to keep, change, cut.
- **[docs/the-hard-part.html](docs/the-hard-part.html)** — positioning. Capture, Diagnose, Ship are commodities. Test-on-a-fork is the moat. Branch projects + `insforge.toml` are why InsForge is structural, not cosmetic.
- **[docs/the-hardest-part.html](docs/the-hardest-part.html)** — engineering. Six failure modes where Hush could lie to itself, and the deterministic defense for each. The two-signal principle.

See [CLAUDE.md](CLAUDE.md) for the full map of where everything lives
and how parallel agents coordinate.

## First-time setup

1. Read `docs/brief.md` for the hackathon brief, sponsors, prizes,
   judging criteria. Everything downstream keys off this.
2. Skim `agents/roles.md` and assign humans/agents to the four roles.
3. Pull the next task from `agents/inbox/` (lowest unclaimed `0NNN-`).
4. Read `demo/checklist.md` so the pre-pitch flow is in your head from hour 1.
