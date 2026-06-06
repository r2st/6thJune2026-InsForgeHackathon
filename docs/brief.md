# Hackathon brief

> Living doc. Update if event details land that contradict this. Everything
> downstream (tasks, architecture, pitch) keys off it.

## Event

- **Name:** InsForge Hackathon
- **Date / duration:** 2026-06-06, 9-hour single-day build
- **Location / format:** In-person · San Francisco (EF venue, per [`ideas/guidelines.html`](../ideas/guidelines.html)). `assumed — confirm at check-in`
- **Submission deadline (absolute):** 2026-06-06, **18:00 PT** (America/Los_Angeles) — end of the 9-hour build window. `assumed — confirm with host at kickoff`
- **Pitch slot length:** 3 min pitch + 2 min Q&A (or a 60-second pitch → judge tables; format is host's call — see `demo/pitch-script.md`)
- **Submission platform:** Direct link (repo + live preview URL) `assumed — Devpost if the host requires it; confirm at check-in`

## The brief in one paragraph

InsForge wants demonstrations of agentic dev tools that lean structurally on
its primitives — branch projects, declarative `insforge.toml`, RLS, edge
functions, pgvector, Realtime, Storage, the AI gateway. The sponsor stack
(InsForge / Vercel / Cognition / Replicas / Limrun) points at execution-layer
infra: judges reward agents that **do something visible, on real infra, that
another engineer would want to install**. See [`ideas/guidelines.html`](../ideas/guidelines.html)
for the operating playbook.

## Prizes (confirmed — see [`ideas/guidelines.html`](../ideas/guidelines.html))

| Place | Reward |
|---|---|
| **1st** | Mac mini or $800 cash · **+ $1,000 Limrun credits** · YC P26 founder dinner |
| **2nd** | Mac mini or $800 · + $750 InsForge · + $500 Limrun |
| **3rd** | Mac mini or $800 · + $250 InsForge · + $200 Limrun |

The founder dinner is arguably the real prize; the Mac is the prop. Sponsor
credit pools: Limrun $200–$1,000 (largest), InsForge $250–$750.

## Tracks & sponsors

| Track / sponsor | Required tech | Notes |
|---|---|---|
| **InsForge (primary)** | `@insforge/sdk` + `insforge` CLI (branches, migrations) — must be load-bearing | Branch projects + `insforge.toml` are the moat (see [`docs/the-hard-part.html`](the-hard-part.html)). Killer move: branch project for prod-data testing. |
| **Vercel** | `vercel deploy`; Next.js App Router + Fluid Compute | Two apps: `apps/demo` storefront and `apps/receipt` live status page. Killer move: preview URL = the demo link. |
| **Cognition (Devin)** | API token (sponsor table at check-in); session → poll → consume PR | Wired in `functions/fix-trigger.ts` / `functions/openPr.ts`. Pre-staged PR is our fallback. |
| **Limrun** | REST: create sandbox → exec → fetch logs → destroy | Used for prod/fork parallel replay verification. Biggest credit pool. |
| **Replicas** | Plug-in capture only | rrweb is the primary; Replicas wired only if the sponsor surfaces a working API demo-day. See [`ideas/FINAL-analysis.md` §2.4](../ideas/FINAL-analysis.md). |

## Judging rubric

No published rubric. The day-of-operating playbook ([`ideas/guidelines.html`](../ideas/guidelines.html))
reverse-engineers a four-axis rubric from the sponsor mix and the room
composition (dev-tools founders + YC P26 partners). Anchor on that until
the host announces otherwise.

| Criterion (inferred) | Weight | What "great" looks like for us |
|---|---|---|
| **Real infra, working end-to-end** | high | Live 60-second loop: rage-click → captured → diagnosed → branch fork passes, prod fails → PR opens. Not a slide reel. |
| **Sponsor primitive is load-bearing** | high | Branch projects + `insforge.toml` are structurally necessary. The product collapses without InsForge — see [`docs/the-hard-part.html`](the-hard-part.html). |
| **Visible artifact a judge can click** | medium | The GitHub PR — 4-line TOML diff with signed clip URL embedded and the RLS trace attached. |
| **Honest engineering discipline** | medium | Confidence tiers, safety rail, two-signal verdicts — Q&A defense lives here. See [`docs/the-hardest-part.html`](the-hardest-part.html). |

## Judges

*(Names to fill in on the day. Background read:
[`research/winning-tips.md`](../research/winning-tips.md) → "reverse-engineer
the judges.")*

| Judge | Background | What they'll likely value |
|---|---|---|
| *(TBC)* | dev-tools founder | The "would I install this?" gut check. Lead with the PR. |
| *(TBC)* | YC P26 partner | Defensibility. The moat sentence in [`docs/the-hard-part.html`](the-hard-part.html). |
| *(TBC)* | InsForge engineer | That the InsForge dependency is structural, not cosmetic. Branch projects + `insforge.toml` are where they look. |

## Our angle

- **One-line pitch:** *Hush — the bug-fixer for the bugs that don't crash.*
- **Real customer name:** *(TBC — ideally an InsForge customer running multi-tenant SaaS. Until confirmed, we frame as "any multi-tenant SaaS on InsForge.")*
- **The pain in one sentence:** Silent RLS misfires — a user's orders page is empty because a policy reads the wrong JWT claim shape; Sentry/Datadog stay green; the customer just leaves.
- **Sponsor APIs we'll showcase:**
  - **InsForge:** branch projects (the moat), `insforge.toml` (the unit of fix), pgvector (dedup + similarity), RLS (the bug surface), Realtime (the receipt page), Storage (signed clip URLs), AI gateway (the diagnosis call).
  - **Vercel:** hosts the toy storefront and the receipt page.
  - **Devin (Cognition):** opens the PR with the TOML diff embedded.
  - **Limrun:** runs the parallel prod/fork replay.
  - **rrweb:** the capture path (we ship this end-to-end, not the sponsor's).
- **What we're explicitly NOT building:** see [`docs/architecture.html` §07](architecture.html) for the full list. Headline: no production-grade session-capture SDK (rrweb stub is the demo), no general code-fix agent (we patch `insforge.toml`, period), no multi-tenant billing or admin UI, no learning-from-rejections loop on stage (architecture supports it; on stage we wire the write and defer the read).

## Hard constraints

- **InsForge must be load-bearing**, not just a database. The whole pitch argument is that branch projects + `insforge.toml` make Hush possible.
- **The fix must be a `insforge.toml` diff**, not arbitrary application code. Patching React/TS at the demo scope is not credible in a 60-second window; patching TOML is.
- **The PR must be clickable on stage** — branch protection on the victim repo is disabled for the demo.
- **The replay must produce two independent signals** (prod fails AND fork passes). Single-signal verdicts drop a confidence tier — see [`docs/the-hardest-part.html`](the-hardest-part.html).
- **No unverifiable stats in the pitch.** The "70% of bugs don't crash" line is dropped (see [`ideas/FINAL-analysis.md` §2.3](../ideas/FINAL-analysis.md)); the demo carries the weight.
