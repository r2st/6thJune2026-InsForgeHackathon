---
id: 0063
title: Notifications & integrations (Slack / email / webhook on PR, draft, issue)
role: builder
priority: P1
owner:
started:
status: inbox
depends_on: [0048, 0054]
demo_path: no — product (post-hackathon)
phase: production
epic: hardening
---

## Goal

When Hush ships something — a PR, a draft PR, or an issue — the right humans hear
about it where they already work (Slack, email, a webhook), with enough context
to act in one click.

## Why it matters

A fix PR no one sees is a fix that doesn't ship. The whole value prop ("before
the user finishes the support ticket") depends on the team being notified the
moment Hush acts.

## Acceptance criteria

- [ ] **Channels:** Slack (per-workspace install), email, and a generic outbound
      webhook; per-workspace routing rules (which tier → which channel).
- [ ] **Payload:** the diagnosis summary, confidence + tier + veto reason, the
      prod/fork verdict, and a deep link to the run + the PR/issue.
- [ ] Tier-aware: `pr` → "review this fix", `draft_pr` → "needs a human", `issue`
      → "we found something we can't auto-fix" — distinct, actionable messages.
- [ ] **Digest mode** so a noisy workspace gets a rollup, not a firehose
      (complements the confidence-tier "don't spam the PR queue" thesis).
- [ ] Delivery is best-effort + retried, and a delivery failure never affects the
      run outcome.

## Likely files / surfaces touched

- `functions/notify.ts` (new), called from `ship` dispatch
- `infra/insforge.toml` (`notification_channels`, routing rules)
- `apps/dashboard/` (channel setup + routing UI)

## Notes

- Reuses the InsForge email path that already exists; Slack is the headline add.

## Outcome
