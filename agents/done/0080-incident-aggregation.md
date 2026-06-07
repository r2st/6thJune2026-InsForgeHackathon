---
id: 0080
title: Bug grouping / incident aggregation — one bug, many sessions, one PR
role: architect
priority: P0
owner: claude-opus-4-8 (loop)
started: 2026-06-06
status: done
depends_on: [0079]
demo_path: no — product (post-hackathon)
phase: production
epic: fix-quality
---

## Goal

When one broken policy frustrates many users, Hush treats it as a single
*incident* — one diagnosis, one fork-test, one PR — with the session count as a
severity signal, instead of a thousand duplicate runs and PRs.

## Why it matters

A single bad RLS policy affects every matching user. Diagnosing/forking/PRing each
session is wasteful, spammy, and erodes trust instantly (ADR 0003, Risk 3). Dedup
exists at the embedding level; this makes it a first-class incident model.

## Acceptance criteria

- [ ] A `bug_incidents` model: sessions/runs grouped by (failing policy, route,
      diff shape) via pgvector similarity + structural keys.
- [ ] First session opens the diagnose→fork→PR flow; subsequent matching sessions
      **attach** to the incident (raising severity, adding evidence), not a new PR.
- [ ] Severity = affected-user/session count + frequency; drives tier and routing
      (a 1,000-user incident is not a draft).
- [ ] When the fix merges, the incident closes and all attached sessions resolve;
      outcome measurement ([[0071]]) reports users-affected averted.
- [ ] Re-open if the signal returns post-merge ([[0069]]).
- [ ] Cost control: an incident pays for *one* diagnose+fork, not N ([[0065]]).

## Likely files / surfaces touched

- `functions/incident.ts` (new), `fix-trigger.ts` (attach-vs-new gate), `memory.ts`
- `infra/insforge.toml` (`bug_incidents`, session→incident link)

## Outcome

- **Shipped (verified core):** `functions/incident.ts` (`incidentKey`,
  `matchIncident`, `classifyArrival`, `severityScore`, `tierFloorFor`) + 11
  tests. Typecheck clean; tests green. Groups runs by a structural signature
  (failing policy + route + normalized fix shape) so the same bug across many
  sessions is one incident: the first session opens the diagnose→fork→PR, the
  rest **attach** (bump the count + lastSeen), no duplicate PRs. Severity scales
  log-wise with affected sessions (1→low, 10→high, 100+→critical) and raises the
  dispatch floor — a high/critical incident is never a draft. Normalization makes
  cosmetic route/policy/diff differences group correctly.
- **Deferred (seam):** the `bug_incidents` table + the attach-vs-new gate in
  `fix-trigger.ts` (and the pgvector similarity fallback for fuzzy grouping) —
  needs the live store; this is the grouping/severity logic it consumes. Cost
  win: an incident pays for one diagnose+fork, not N.
