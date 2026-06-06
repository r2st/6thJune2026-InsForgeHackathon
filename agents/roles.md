# Roles

The 4-role split that winning hackathon teams converge on (see
[research/winning-tips.md](../research/winning-tips.md)). Map agents or
humans to roles at kickoff. Solo? Wear all four — but schedule the slot
for *Storyteller* deliberately, or it will get starved.

## Architect

Owns: system design, core logic, data model, integration with sponsor APIs.
Picks the stack and writes the ADRs. Says no to scope creep.

Default folders: `docs/architecture.md`, `docs/decisions/`, backend code.

## Builder

Owns: the actual UI the judges will click on. Fast iteration over perfection.
Defaults to a polished component library — does not design from scratch.

Default folders: frontend code, `assets/design/` (consuming, not producing).

## Designer

Owns: the visual layer. Brand, color, typography, the one screenshot in
the deck. Job is "looks shipped in <2 hours," not Dribbble-tier.

Default folders: `assets/brand/`, `assets/design/`, deck templates.

## Storyteller

Owns: the pitch. Starts hour 1, not hour 23. Drafts the script, writes the
demo walkthrough, runs dry-runs, prepares Q&A answers. **This role is the
most commonly underweighted and the most decisive at judging.**

Default folders: `demo/`, `docs/brief.md` (keeps "Our angle" sharp).

## Cross-role rituals

- **Hour 1:** Storyteller drafts a 3-min pitch from `docs/brief.md`. Yes,
  before anything is built. The pitch tells the other roles what to build.
- **Every ~4h:** 10-min sync. Each role: what shipped, what's blocked, one
  ask. Update `agents/tasks/` files, not a separate log.
- **T-2h to deadline:** stop new work. Storyteller drives dry-runs. Builder
  fixes only demo-path bugs. Architect prepares fallbacks. Designer freezes.
