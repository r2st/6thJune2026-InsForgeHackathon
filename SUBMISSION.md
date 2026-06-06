# Hush — the bug-fixer for the bugs that don't crash

> Hush watches for the bugs your error tracker can't see, traces each one from
> the frustrated user all the way to the backend policy that caused it, and
> ships the fix as a reviewable pull request — before the user finishes writing
> the support ticket.

---

## 🔗 Live links (for judges)

| | Link | What you'll see |
|---|---|---|
| ▶ Start here — Demo (no backend, can't flake) | https://w369egnp.insforge.site/r/demo?demo=1 | The full five-step arc — capture → correlate → diagnose → fork-test → ship — streamed live on the receipt page. |
| 🖥 Pitch deck | https://w369egnp.insforge.site/pitch.html | 10-slide presentation. Arrow-keys / click to advance, `F` for fullscreen. |
| 🐛 The bug (victim app) | https://hush-acme-store.vercel.app/orders?user=migrated | "Acme Store / My Orders" renders empty for a migrated user — the silent RLS bug. Drop `?user=migrated` to see the 3 orders that were always there. |
| ✅ The fix (real PR) | https://github.com/r2st/hush-victim-acme/pull/1 | A real, open pull request: a 4-line `insforge.toml` diff that fixes the policy. |
| 📡 Receipt page (live status) | https://w369egnp.insforge.site/ | The judge-facing live status surface. |
| ⚙️ Backend (InsForge `hush`) | https://w369egnp.us-east.insforge.app/api/health | Live API host with the seeded demo bug. |
| 💻 Source (GitHub) | https://github.com/r2st/6thJune2026-InsForgeHackathon | Full source — edge functions, apps, infra, 263 passing tests. |

> 90-second click-path: [the bug](https://hush-acme-store.vercel.app/orders?user=migrated) → [the demo](https://w369egnp.insforge.site/r/demo?demo=1) → [the fix PR](https://github.com/r2st/hush-victim-acme/pull/1).

---

## What it does

When a user gets stuck (rage-clicks, a dead click, an abandoned form), Hush runs
a five-step loop:

1. Watch — captures the session with rrweb and fires on the frustration signal.
2. Correlate — links that frontend symptom to the exact backend request that
   failed, by matching the session against the request log. This is the move that
   turns "the page is empty" into "the `orders_select` RLS policy returned 0 rows."
3. Diagnose — InsForge AI reads the failing request + the relevant
   `insforge.toml` slice and explains, in plain English, which policy or JWT claim
   misfired and how to fix it.
4. Test on a fork — Hush forks the entire backend (an InsForge branch project),
   applies the proposed `insforge.toml` patch, and replays the failing request
   against both prod and the fork. Prod still returns 0 rows; the fork returns the
   3 that were always there. That's falsifiable proof the fix works — not a guess.
5. Ship — opens a PR with the diagnosis, the before/after policy trace, and the
   session clip, routed by a confidence score: high → PR with the fix, medium →
   draft PR with the failing test, low → an issue. A deterministic safety rail
   blocks any patch that widens access, so a fix can never become a leak.

## Why it can only be built on InsForge

Most agentic dev tools are platform-agnostic. Hush is not. To safely propose a
policy patch you must (a) run it against prod-shaped data and (b) compare
deterministically — which means forking the whole backend (schema + auth + RLS)
and replaying. That's InsForge branch projects. And the fix itself is a diff
against the declarative `insforge.toml` — small, reviewable, reversible, and
within an agent's one-shot range. Supabase has RLS but no branch projects; Neon
has branches but no auth layer; neither composes. Hush exists because InsForge
exposes a forkable backend with declarative auth.

## It learns

Every resolved fix is recorded in Memoir ("git for AI memory"). A past merged
fix raises confidence on similar bugs; a rejected one lowers it — so Hush gets
quieter and sharper for each team over time. Lim.run boots a real cloud
instance on the fork to give judges a clickable "see the fix live" link, and
Replicas / Devin are wired as the background coding agents that can land the
patch.

## Stack

InsForge (Postgres + pgvector + RLS + branch projects + Realtime + AI + edge
functions) · rrweb · Memoir · Lim.run · Replicas · Devin · Vercel · Next.js.

## Live

The receipt page streams every step in real time; a real fix PR (a 4-line
`insforge.toml` diff) is already open on the demo victim repo. The diagnosis step
runs on a real LLM (Gemini by default, provider-switchable to Anthropic via one
env flip) and produces the exact policy fix end-to-end on the deployed backend.
