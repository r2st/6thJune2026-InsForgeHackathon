---
id: 0067
title: PR lifecycle management — track, respond to review, merge/close/rebase, clean up stale
role: builder
priority: P0
owner:
started:
status: inbox
depends_on: [0049]
demo_path: no — product (post-hackathon)
phase: production
epic: operate-trust-grow
---

## Goal

Hush doesn't just *open* PRs — it owns them through their lifecycle: tracks
review state, answers "what is this?" review comments with the diagnosis/trace,
rebases on conflict, and closes/reopens as the bug or repo changes.

## Why it matters

An opened-and-abandoned PR rots. For Hush to be trusted, its PRs must behave like
a good teammate's: stay current, explain themselves, and clean up after
themselves. This is also where the merged/rejected signal for billing (0058) and
Memoir (0043) is captured.

## Acceptance criteria

- [ ] Subscribe to GitHub PR webhooks (review requested/submitted, comment,
      merged, closed, head/base changes) per installation.
- [ ] Auto-reply to review comments with the relevant diagnosis section, the
      prod/fork verdict, and the confidence breakdown (no hand-waving).
- [ ] Rebase/refresh when the base branch moves or the policy changes; re-run the
      fork verdict and update the PR if the fix still holds, close it if the bug
      is gone.
- [ ] Stale-PR policy: auto-close + file an issue if a Hush PR sits unreviewed
      past a workspace-configured TTL.
- [ ] On merge/close, record the outcome → Memoir ([[0043]]) + billing ([[0058]]).
- [ ] Idempotent: webhook replays never double-act ([[0064]]).

## Likely files / surfaces touched

- `functions/prLifecycle.ts` (new), `functions/ship.ts`, GitHub webhook handler
- `infra/insforge.toml` (`pull_requests` tracking table)

## Outcome
