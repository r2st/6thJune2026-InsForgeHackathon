# Hush — InsForge Hackathon, 6 June 2026

The bug-fixer for the bugs that don't crash. Catches silent backend
RLS / auth / policy misfires by correlating a user's frontend
frustration with the matching request log, patches `insforge.toml` on
a forked InsForge branch project, and ships the PR before the user
finishes writing the support ticket.

## Live demo

| Surface | URL | State |
|---|---|---|
| **Receipt page** (judge-facing live status) | https://w369egnp.insforge.site/ | ✅ deployed |
| **Receipt — demo mode** (full arc, no backend needed) | https://w369egnp.insforge.site/r/demo?demo=1 | ✅ deployed · **start here** |
| **Backend** (InsForge project `hush`, seeded demo bug) | https://w369egnp.us-east.insforge.app/api/health | ✅ live — API host; bare `/` returns `Cannot GET /` by design, check `/api/health` |
| **Victim app** (`apps/demo` — "Acme Store / My Orders") | https://demo-seven-omega-26.vercel.app/orders | ✅ deployed (Vercel) · migrated user → empty page; legacy → 3 orders |
| **PR target** (`hush-victim-acme` — where Hush opens the fix PR) | https://github.com/r2st/hush-victim-acme/pull/1 | ✅ live PR (4-line `insforge.toml` diff) |

> The **demo-mode receipt** (`/r/demo?demo=1`) rehearses the whole five-step
> arc — capture → correlate → diagnose → fork-test → ship — with no backend,
> so it can't flake on stage. The victim app is the left-screen "Acme Store"
> where a migrated user opens **My Orders** and sees an empty page; toggling
> to the legacy user shows the 3 orders that were always there. That contrast
> is the 0:00 beat of the pitch.

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
