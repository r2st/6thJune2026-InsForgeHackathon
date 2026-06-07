---
id: 0063
title: Notifications & integrations (Slack / email / webhook on PR, draft, issue)
role: builder
priority: P1
owner: claude-opus-4-8 (loop)
started: 2026-06-07
status: in-progress
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

Shipped the **pure notification core** in `functions/notify.ts` (+ 13 tests,
`functions/notify.test.ts`, tsc clean):

- **buildMessage(notice)** — tier-aware, distinct, actionable: `pr` → "review this
  fix", `draft_pr` → "needs a human", `issue` → "can't auto-fix". Body carries the
  diagnosis summary, confidence (+ veto reason when a weak signal limited the tier),
  and the prod/fork verdict; CTA deep-links the PR/issue (falls back to the run).
- **routeChannels(tier, rules)** — resolves the per-workspace tier→channel rules
  (slack/email/webhook), deduped; an unrouted tier routes nowhere (silence is valid
  config, not an error).
- **deliveryMode(tier, policy)** — digest vs immediate: a `pr` is always immediate
  (the "before the support ticket" promise) even with digest on; routine tiers roll
  up so a noisy workspace gets a summary, not a firehose.
- **planDelivery(notice, rules, policy)** — the full plan (one task per channel +
  mode + message), `silent` when nothing is routed. The caller dispatches each task
  best-effort with retry (`reliability.retryDecision`) and never lets a delivery
  failure change the run outcome.

**Seam (deferred):** the actual Slack (per-workspace install) / email (reuses the
existing InsForge email path) / webhook transports, the `notification_channels` +
routing rules in `infra/insforge.toml`, and the channel-setup UI in
`apps/dashboard/`. External integrations/UI — stay open there.

How to verify: `pnpm -F @hush/functions test notify.test.ts`.
