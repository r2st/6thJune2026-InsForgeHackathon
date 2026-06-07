---
id: 0090
title: Config drift detection & reconciliation (repo insforge.toml vs. applied)
role: architect
priority: P1
owner:
started:
status: inbox
depends_on: [0019, 0049, 0051]
demo_path: no — product (post-hackathon)
phase: production
epic: fix-quality
---

## Goal

Hush always diagnoses against, and patches, the *applied* backend policy — and
detects when the repo's `insforge.toml` has drifted from what's actually live —
so a fix PR is never against a stale baseline.

## Why it matters

The repo `insforge.toml` and the live policy can diverge (dashboard edits,
hotfixes). A patch against the repo then conflicts or doesn't match reality (ADR
0003, Risk 5). Ticket 0019 already flags "read the applied TOML, not git" — this
makes it a guarantee with reconciliation.

## Acceptance criteria

- [ ] Diagnose + grounding read the **applied** config from the InsForge API
      (per backend connection [[0051]]), not the repo snapshot (closes the 0019
      deferral that used the embedded repo TOML).
- [ ] On a run, **diff applied vs. repo** `insforge.toml`; if drifted, surface it
      and base the patch on applied state.
- [ ] The PR ([[0049]]) is generated against the repo head and flags the drift in
      its body so reviewers reconcile (or Hush opens a "sync your insforge.toml"
      housekeeping PR).
- [ ] Rebase/refresh on base-branch movement ([[0067]]) re-reads applied state.
- [ ] Detect *manual* policy changes as a class of silent bug source (a dashboard
      hotfix that broke a claim path is exactly Hush's wheelhouse).

## Likely files / surfaces touched

- `functions/toml.ts` (applied-from-API loader), `diagnose.ts`, `ship.ts`/`openPr.ts`

## Outcome
