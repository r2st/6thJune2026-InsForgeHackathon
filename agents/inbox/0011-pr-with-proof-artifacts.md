---
id: 0011
title: Open a GitHub PR with the TOML diff, clip, RLS trace, and confidence
role: builder
priority: P0
owner:
started:
status: inbox
depends_on: [0006, 0008]
demo_path: yes — slide 7 is this PR
---

## Goal

`witness/openPr.ts` takes the patch, verdict, session id, and a
confidence score, and opens a GitHub PR via the GitHub App with a
templated body. The body embeds:

- The `insforge.toml` diff (4 lines for the demo case)
- A signed-URL link to the rrweb session clip in InsForge Storage
- The before/after RLS trace as a fenced code block
- A link to the branch project the judge can open and poke at
- The confidence breakdown (`92% = diff(95) × blast(98) × similarity(89)`)

## Why it matters for the demo

Slide 7 is the close. The PR card and the 92% badge are the artifact
the judge keeps. The body must be readable in 5 seconds — leave one
breath after each section.

## Acceptance criteria

- [ ] PR title: `policy(<table>): <one-line summary>`
- [ ] Body sections in fixed order; section headers as bold one-liners,
      not h2s
- [ ] All embedded URLs are signed/short and dereferenceable
- [ ] CI checks attached: `branch-project replay`, `existing tests`,
      `no policy blast` — each posted via GitHub's commit-status API
      from the verdict
- [ ] Confidence badge color: green ≥85, amber 60–84, purple <60
- [ ] Idempotent — re-running on the same session edits the existing PR
      instead of opening a duplicate

## Likely files / surfaces touched

- `witness/openPr.ts`
- `witness/prTemplate.md` (the body template)
- `infra/github-app/` (auth)

## Notes

Match the visual treatment to slide 7 in
[demo/slides/index.html](../../demo/slides/index.html). The clip URL
must be signed with an expiry well after the pitch slot.

## Outcome
