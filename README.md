# Hush — InsForge Hackathon, 6 June 2026

The bug-fixer for the bugs that don't crash. Catches silent backend
RLS / auth / policy misfires by correlating a user's frontend
frustration with the matching request log, patches `insforge.toml` on
a forked InsForge branch project, and ships the PR before the user
finishes writing the support ticket.

## Quick links

- **Canonical pitch** — [ideas/FINAL.html](ideas/FINAL.html)
- **Day-of playbook** — [ideas/guidelines.html](ideas/guidelines.html)
- **Hackathon brief & rubric** — [docs/brief.md](docs/brief.md)
- **Architecture** — [docs/architecture.md](docs/architecture.md)
- **Pitch script & slides** — [demo/pitch-script.md](demo/pitch-script.md) · [demo/slides/](demo/slides/)
- **What to work on next** — [agents/inbox/](agents/inbox/)
- **Winning playbook** — [research/winning-tips.md](research/winning-tips.md)

See [CLAUDE.md](CLAUDE.md) for the full map of where everything lives
and how parallel agents coordinate.

## First-time setup

1. Read `docs/brief.md` for the hackathon brief, sponsors, prizes,
   judging criteria. Everything downstream keys off this.
2. Skim `agents/roles.md` and assign humans/agents to the four roles.
3. Pull the next task from `agents/inbox/` (lowest unclaimed `0NNN-`).
4. Read `demo/checklist.md` so the pre-pitch flow is in your head from hour 1.
