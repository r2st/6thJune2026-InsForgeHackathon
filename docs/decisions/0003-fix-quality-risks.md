# 0003 — Critical analysis: can Hush actually fix production bugs reliably?

- **Date:** 2026-06-06
- **Status:** accepted (complements the roadmap detection epic; adds validation tickets 0089–0093)
- **Decider(s):** Hush team

## Context

Tickets 0048–0077 make Hush *deployable, multi-tenant, and operable*. None of
them answer the harder question: **at production scale, does the bug-fixing
itself stay correct?** The hackathon proved the loop on **one** seeded bug with a
**known** answer (expected rows = 3, one failing request, one tenant). Production
removes every one of those gifts. This ADR red-teams the strategy and names the
strategic risks that, left unaddressed, turn Hush from "magic" into "a
false-positive firehose nobody trusts."

## The load-bearing assumptions — and why each breaks in production

### Risk 1 — The expectation oracle is missing (the existential one)

Hush's whole premise is "the user *should* have seen 3 orders but saw 0." In the
demo that `3` is hard-coded. **In production, how does Hush know an empty result
is a bug and not simply correct?** A user with no orders, an empty cart, zero
notifications — all return 0 rows with `200 OK`, identical to the bug. Without a
reliable "what should have happened" oracle, Hush cannot separate a silent bug
from a correct-but-empty response, and **detection precision collapses**. This is
the single most important unsolved problem. → *the request-log-instrumentation + signal-triage + generalize-bug-surface tickets (the detection epic); the policy-counterfactual technique below is the sharp version.*

### Risk 2 — Correlation is ambiguous at scale

A real session fires *dozens* of backend requests; several may return 0 rows
legitimately. The current heuristic ("pick the latest empty/4xx request") will
mis-correlate constantly, and a wrong correlation → wrong diagnosis → confidently
wrong fix. → *the signal-triage / dedup ticket (detection epic).*

### Risk 3 — One broken policy = thousands of identical "bugs"

A single bad RLS policy frustrates every affected user. Hush would capture 1,000
sessions and try to diagnose/fork/PR each. pgvector dedup + Memoir blunt this, but
the real need is **incident aggregation**: one *bug*, many sessions → one PR, with
the session count as a severity signal — not 1,000 PRs. → *the signal-triage / noise-budget ticket (detection epic).*

### Risk 4 — Privacy-minimized forks weaken validation fidelity

To protect customer data (0051/0056) the fork is seeded from only the *affected
rows*. But a fix validated against a 3-row fork can pass while being wrong on the
full data distribution (e.g. a policy that's correct for the captured user but
leaks for another shape). **Privacy (narrow fork) and validation fidelity
(representative fork) are in direct tension** and neither ticket resolves it.
→ **[[0089]]**

### Risk 5 — Repo `insforge.toml` drifts from the *applied* policy

Hush patches the repo's `insforge.toml` and opens a PR — but the live backend's
policy may have been changed out-of-band (dashboard, hotfix). The fix is then
against a stale baseline: a merge conflict at best, a fix that doesn't match
production reality at worst. → **[[0090]]**

### Risk 6 — The confidence number is uncalibrated

"90%" is a weighted heuristic. Is a 90%-confidence fix actually merged ~90% of
the time? Unknown. An *uncalibrated* confidence score is worse than none — it
manufactures false trust. Confidence must be measured against real merge/reject
outcomes and recalibrated. → **[[0091]]**

### Risk 7 — The learning loop can be poisoned

Memoir learns from merge/reject. A careless team, or an attacker who can trigger
captures, can train Hush toward wrong fixes or suppress real ones. Feedback
integrity (provenance, outlier resistance, decay) is unaddressed. → **[[0092]]**

### Risk 8 — Single-request replay can't see stateful bugs

The model assumes *one failing request = the bug*. Many silent bugs are
*stateful*: a sequence where step 3 fails because of state set in step 1.
Single-request replay structurally cannot reproduce these. Hush must **detect and
honestly decline** them, not silently mis-fix. → **[[0093]]**

## Decision

This ADR complements the roadmap's "what still breaks in production" analysis,
which owns the **detection / evidence / triage / leak** risks (Risks 1–3 here —
the request-log-instrumentation, signal-triage, and canary-probe tickets). On top
of detection, this ADR adds the **validation, calibration & integrity** layer as
tickets **0089–0093**, treating these as first-class engineering problems, not
edge cases. Cross-cutting principle, extending the hackathon's two-signal
discipline:

> **Precision before recall, and abstention before a wrong fix.** It is far
> better for Hush to say "I'm not sure this is a bug / I can't safely fix this"
> than to open a confident wrong PR. Every risk above resolves toward *abstain
> when the oracle/correlation/fidelity is weak* — the confidence floor and the
> self-escalation-to-issue paths already model this; Phase 4 generalizes it.

## Consequences

- **Makes Hush trustworthy at scale** instead of merely demoable. A
  low-precision auto-fixer is uninstalled within a week; this is what prevents that.
- **Hardest tickets in the whole program.** The expectation oracle (detection
  epic) is genuinely research-flavored; ship a conservative version
  (high-precision, low-recall) first.
- **Reinforces the InsForge moat:** the oracle and fidelity work both lean on
  forking + replaying *real* schema/policy — still only possible on InsForge.
  The **policy-counterfactual oracle** (relax the RLS predicate on the fork; if
  rows appear, the data exists and the policy hid it → it's a bug) is uniquely
  cheap on InsForge and is the sharp version of Risk 1's detection.
- **What we'll regret if wrong:** shipping autonomy (auto-PR) before precision is
  proven. Gate autonomy (0070) on the calibration evidence ([[0091]]).
