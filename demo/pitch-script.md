# Pitch script — Hush.

**Slot:** 3 min pitch + 2 min Q&A
**Team:** Julie Oh · Subhendu Das
**Deck:** [demo/slides/index.html](slides/index.html) · open fullscreen (press `F`), arrow-keys to advance.

Read aloud with a timer. If you're over by 10s, cut a sentence. Cuts are at the bottom of this file.

---

## 0:00 – 0:25 — Problem (slide 1 → 2)

> "A customer of an InsForge-hosted SaaS opens their orders page. It's empty.
> They refresh — still empty. They rage-click *Reload*, then close the tab and
> email support."
>
> "Sentry sees no error. Datadog is all green. PagerDuty is silent.
> The customer just leaves."

**What the judge feels:** *they have shipped this bug. Their team has missed it.*

## 0:25 – 0:40 — The gap (slide 3)

> "Most user-reported bugs never reach your error tracker. They don't
> crash — they just *frustrate*. Your monitoring is built for stack
> traces. Most of your bugs don't have one."

<!-- v5 used "70% of user-reported bugs never throw an error." The stat
     had no defensible citation (see ideas/FINAL-analysis.md §2.3 and
     docs/architecture.md Critical analysis §G). The directional claim
     survives any judge cross-examination; the demo carries the weight. -->


## 0:40 – 0:55 — Solution one-liner (slide 4)

> "We built **Hush.** — the bug-fixer for the bugs that don't crash.
> Hush watches the session, replays it on a forked InsForge backend,
> patches `insforge.toml`, and ships the PR. In under a minute."

## 0:55 – 2:15 — Live demo (slides 5 → 7)

Happy path. Pre-loaded data. No login. Three beats.

| Time   | Slide | What happens on screen                                                | What you say                                                                 |
|--------|-------|-----------------------------------------------------------------------|------------------------------------------------------------------------------|
| 0:55   | 5     | Customer rage-clicks. Receipt panel lights up. Session captured · backend log tapped · anomaly. | "Hush saw the rage-click and pulled the matching backend log." |
| 1:20   | 6     | Diagnosis: RLS policy `orders_select` reads `auth.jwt() ->> 'tenant'`. JWT migrated to `tenant_ids[]` last week. Branch project spawns; prod (red) and branch (green) replay side-by-side. | "It traced the empty page to one RLS policy. Then it forked the backend and *proved* the fix on the fork, against the same session." |
| 1:50   | 7     | GitHub PR opens. Four-line `insforge.toml` diff. Confidence 90%. CI green. Session clip + before/after RLS trace attached. | *"And here's the proof — a four-line TOML patch, with the session clip and the RLS trace embedded. From rage-click to PR in under a minute."* |

**Fallback:** if anything live breaks, switch to `demo/recordings/latest.mp4` and narrate over it. Don't apologize — keep going. The receipt page (slide 5) and the branch replay (slide 6) are the two beats that *must* land; the PR shot is the closer.

## 2:15 – 2:40 — Confidence tiers + why InsForge (slides 8 → 9)

> "Hush doesn't spam your PR queue. Every finding is scored —
> high-confidence small diffs open a PR, mediums open a draft, lows file
> an issue with the clip and the log diff."

> "And this only works on InsForge. Branch projects let us test the fix
> against your real schema before opening the PR. `insforge.toml` makes
> the fix a four-line diff instead of a refactor. Supabase has neither.
> Convex has neither. **InsForge is the engine, not the substrate.**"

## 2:40 – 3:00 — Close (slide 10)

> "Sentry catches the bugs that crash your server. Hush catches the
> bugs that quietly break your customers. Built on InsForge — branch
> projects, RLS, realtime, AI — plus rrweb for capture."

<!-- v5 close also name-dropped "pgvector" (learn-from-rejections loop)
     and "Devin" (the patch driver). Neither is in the build plan: the
     diagnose step calls InsForge AI directly (ticket 0018) and the
     learn-loop is a Q&A planted seed, not code. Naming them in the
     close invites a judge follow-up we can't honor. Both survive as
     roadmap in the planted-seed answer below. See architecture.md
     Critical analysis §D for the full thread. -->

>
> "Next we wire the learn-from-rejections loop: every closed PR becomes a
> negative training shape, so Hush gets quieter over time, not noisier."

---

## Planted seed (pick one — judge will ask)

- **Learn-from-rejections loop** (default — strongest answer): "Every closed-as-not-a-bug PR embeds back into pgvector as a negative shape. Hush's false-positive rate drops with use, not up."
- **What about non-RLS bugs?** "Today, RLS + auth policy. The same loop generalizes to any declarative config — feature flags, edge-fn routing. We start where the fix is small and the blast radius is bounded."
- **Multi-tenant deploy story:** "Hush runs as an InsForge edge function plus a GitHub App. Customers install both, point us at a repo, done. Half-day of work to ship."

## Q&A prep

| Likely question | Our answer |
|-----------------|------------|
| "Won't this open garbage PRs?" | Confidence tiers. Anything under 85% is a draft or an issue. The 90% in the demo is what an *open* PR looks like — small diff (replay 100, diff-size 100, blast 100), with pgvector similarity at the neutral 50 because there's no merge-history corpus on day one. |
| "How do you replay a session deterministically?" | We don't replay the *page*. We replay the *policy*. The rrweb clip is evidence, not the test. The test is the failing request against the branch project. That's tractable in 9 hours; deterministic page-replay is not, and we'd be lying if we claimed it. |
| "Why not Supabase?" | Supabase has RLS but no branch projects. No safe place to test a policy diff against real schema without risking prod. `insforge.toml` makes the fix declarative — Supabase's RLS lives in migrations, which is one more thing to roll back. |
| "Why not just have Sentry add this?" | Sentry has no backend fork primitive. They could add session replay (they have), but they can't ship the fix because they can't safely test it. We can. |
| "How does Hush handle false positives?" | The branch-project replay *is* the false-positive filter. If the fix doesn't make the session green on the fork, no PR. That's the whole point of the engine. |
| "What's the business model?" | Per-confirmed-fix pricing — you pay when an open PR gets merged. Aligns incentives. We skipped pricing UI for the hackathon. |
| "What about non-Postgres / non-RLS bugs?" | Out of scope today. The first wedge is multi-tenant SaaS on InsForge, where RLS misfires are the silent-bug category that lands in security postmortems. |
| "What about PII / GDPR — and cost?" | rrweb masks every input by default (`maskAllInputs`), the capture edge fn strips `Authorization`/`Cookie`/`Set-Cookie` before anything is stored, and we only capture sessions that *frustrate* — a happy path never hits `/capture`, so there are no rows and no Storage writes for it. Masking and sampling are code, not a promise. |

## Cut list (if running long, drop top first)

1. The Datadog / PagerDuty line in the problem ("silent" lands without it).
2. The restated-as-70% framing — go straight from problem to solution.
3. The third bullet on confidence tiers (low / issue) — leave PR + draft.
4. The "next we wire learn-from-rejections" line — save it for Q&A as the planted seed.

## Operator (keyboard driver) notes

- Open `demo/slides/index.html` fullscreen. Press `F` to toggle.
- Advance: `→` / space / click. Back: `←`. Jump: `1`–`9` / `0`.
- Step through 1 → 10 in order; the script timing assumes one slide per beat.
- Keep slide 7 (the PR) on screen during Q&A — it's the money shot.
