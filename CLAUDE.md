# Project guide for agents

This repo is a hackathon project worked on by multiple AI agents in parallel.
Read this file before doing anything. It points to the canonical source for
every kind of context, so you don't have to grep.

## Where things live

| You need…                          | Look in                                  |
|------------------------------------|------------------------------------------|
| The hackathon brief & rubric       | `docs/brief.md`                          |
| Current system design              | `docs/architecture.md`                   |
| Why a decision was made            | `docs/decisions/` (ADRs)                 |
| Domain terms                       | `docs/glossary.md`                       |
| Background research / strategy     | `research/`                              |
| **What to work on next**           | `agents/inbox/` (unclaimed tasks)        |
| Work in progress                   | `agents/tasks/` (claimed tasks)          |
| Completed work                     | `agents/done/`                           |
| Role definitions                   | `agents/roles.md`                        |
| Pitch script & demo plan           | `demo/`                                  |
| Brand, mockups, sample data        | `assets/`                                |
| Dev / build / deploy scripts       | `scripts/`                               |

## Coordination rules (read this)

1. **Claim before you build.** Move the task file from `agents/inbox/` to
   `agents/tasks/` and add your agent name + timestamp to its frontmatter.
   Don't start work on something nobody owns.
2. **One task per agent at a time.** If you find yourself "while I'm here…"
   write a new task file in `agents/inbox/` instead.
3. **Update the task file as you go.** It's the single source of truth for
   what's done and what's blocked. Other agents read it.
4. **When done, move it to `agents/done/`** with a 2–3 line outcome summary
   at the bottom.
5. **Big decisions get an ADR.** Anything another agent might second-guess
   (framework choice, schema shape, sponsor API usage) → `docs/decisions/`.
6. **Don't edit `research/`.** It's frozen context. New findings go to
   `docs/` instead.

## Pitch-first discipline

The pitch is built from day 1 — see `demo/pitch-script.md`. Every feature
exists to serve the demo. If a task doesn't show up in the 3-minute pitch,
question whether it should exist at all. See `research/winning-tips.md` for
the full playbook.

## Tone for human-facing artifacts

- Pitch and demo copy: confident, concrete, names a real customer & real pain.
- ADRs and task files: terse. Bullet points beat paragraphs.
- No emojis unless the human asks for them.
