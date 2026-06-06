# Agent coordination

Multiple agents work on this repo at once. This folder is the **task queue**
they coordinate through. No special tooling — just markdown files moved
between directories.

## The flow

```
inbox/   →   tasks/   →   done/
unclaimed   in-progress   completed
```

1. **Pick up work.** Open `inbox/`, pick the highest-priority task you can
   handle. Move the file to `tasks/`.
2. **Claim it.** Edit the frontmatter: set `owner` to your agent name and
   `started` to today's date.
3. **Work.** Update the task body as you go — checklist items, notes,
   blockers. Other agents read these.
4. **Hand off if blocked.** Move back to `inbox/`, clear `owner`, leave a
   `blocked:` note with what you need.
5. **Finish.** Add an `## Outcome` section at the bottom (2–3 lines: what
   shipped, what was cut, what to test). Move to `done/`.

## Naming

`NNNN-kebab-title.md` — e.g. `0003-wire-up-supplier-csv-upload.md`. Numbers
are stable; don't renumber when reordering priority.

## What makes a good task

- **One outcome.** "Build the auditor page" is too big. "Render the cited-
  evidence sidebar on /audit/:id" is right.
- **Demoable or block-removing.** Tasks should either show up in the pitch
  or unblock something that does. If neither, push back.
- **Has acceptance criteria.** A checklist another agent could verify.
- **Names the file(s) likely touched.** Saves the next agent a search.

## What NOT to do

- Don't claim more than one task at a time.
- Don't edit someone else's in-progress task body (leave a comment in
  `inbox/` as a new task instead).
- Don't skip the `## Outcome` section when moving to `done/`. Future agents
  rely on it.
- Don't park half-done work in `done/`. If it's not shippable, it's not done.
