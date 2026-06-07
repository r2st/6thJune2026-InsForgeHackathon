---
id: 0087
title: Signal triage, deduplication, and production noise budget
role: architect
priority: P0
owner: claude-opus-4-8 (loop)
started: 2026-06-07
status: in-progress
depends_on: [0050, 0057, 0086]
demo_path: no — product (post-hackathon)
phase: production
epic: hardening
---

## Goal

Turn raw production frustration signals into a small, high-quality queue of
candidate backend bugs by requiring backend evidence, deduplicating repeated
events, and enforcing per-workspace cost/noise budgets before LLM or fork work
runs.

## Why it matters

Rage-clicks are useful smoke, not proof. Real production sites have rage-clicks
from slow networks, confusing UI, impatient users, disabled buttons, browser
extensions, and real frontend bugs. If every signal starts an LLM diagnosis and
fork replay, Hush becomes noisy, expensive, and untrusted.

The product should open a run only when the behavioral signal and backend log
agree that something silent and policy-shaped happened.

## Acceptance criteria

- [ ] Add a `candidate_events` stage before `bug_runs`: capture signal +
      request-log evidence are stored, scored, and deduped before diagnose/fork.
- [ ] Gate candidates by evidence: same session id, one clear failing route,
      `200 OK + empty/wrong rows` or 4xx, and policy-level evidence from [[0086]]
      when auto-fix is possible.
- [ ] Build a stable fingerprint for dedup: workspace, site, route, policy,
      auth-claim shape, row delta, release/build SHA, and normalized query shape.
- [ ] Per-workspace budgets: max LLM diagnoses, max fork replays, and max PR/draft
      outputs per day; overflow becomes dashboard-only evidence, not dropped data.
- [ ] Cluster repeated events into one run with a count and examples instead of
      opening duplicate PRs/issues.
- [ ] Confidence scoring includes signal quality and cohort size; a single weak
      rage-click cannot auto-PR without strong fork proof and safety rails.
- [ ] Dashboard shows "ignored / clustered / diagnosed / shipped" so customers
      understand why Hush did or did not act.

## Likely files / surfaces touched

- `functions/ingest.ts`, `functions/correlate.ts`, `functions/score.ts`
- `infra/insforge.toml` (`candidate_events`, fingerprints, budgets)
- `apps/dashboard/` (triage queue + reason display)
- `functions/fixtures/` (noisy signal fixtures)

## Notes

- This is where the product becomes quiet enough to run in production.
- The default posture should be conservative: collect evidence freely, spend
  forks/LLM calls sparingly, and auto-PR only on repeated or very strong proof.

## Outcome

Shipped the **pure triage core** in `functions/triage.ts` (+ 17 tests,
`functions/triage.test.ts`, tsc clean):

- **Evidence gate** — `gateCandidate(ev)` requires backend agreement: a 200-OK
  silent row drop (`rowsBefore > rowsAfter`), a 4xx refusal, or a 200-with-zero-
  rows. No backend evidence ⇒ smoke ⇒ ignored. `hasPolicyEvidence` (named
  `failingPolicy` on a silent drop) is the precondition an auto-fix needs.
- **Fingerprint + cluster** — `fingerprint(ev)` is a stable dedup key over
  workspace/site/route/policy/auth-claim/row-delta-bucket/release-SHA/query-shape;
  cosmetic diffs (slash, query, case, whitespace) and near-identical drops (5→0,
  7→0 via the delta bucket) collapse to one key. `triageEvent` clusters a recurring
  bug onto its open run instead of opening a duplicate PR.
- **Noise budget** — `NoiseBudget` caps per-workspace daily diagnoses / fork
  replays / outputs; over-budget candidates become `budget_deferred` (dashboard-
  only evidence, **never dropped**). `triageEvent` consults but doesn't spend the
  budget (kept pure — caller spends iff it acts on `diagnosed`).

**Seam (deferred):** persisting `candidate_events` + budgets in `infra/insforge.toml`,
wiring `triageEvent` into `ingest.ts`/`correlate.ts` before `bug_runs`, and the
dashboard "ignored/clustered/diagnosed/shipped" triage view. The `rowsBefore`
policy evidence depends on [[0086]] request-log RLS instrumentation; usage/budget
persistence ties to [[0057]] observability — both external, stay open there.

How to verify: `pnpm -F @hush/functions test triage.test.ts`.
