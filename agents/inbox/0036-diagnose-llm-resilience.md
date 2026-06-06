---
id: 0036
title: diagnose() LLM-call resilience — timeout, retry, graceful degrade
role: architect
priority: P1
owner:
started:
status: inbox
depends_on: [0018, 0012, 0030]
demo_path: yes — a slow/rate-limited Claude call must not freeze the receipt mid-pitch
---

## Goal

Make the Anthropic call in `functions/diagnose.ts` survive the failure modes
that happen live: a slow response, a `429` rate-limit, a `529` overload, a
`500`, or a dropped connection. Today the call has no timeout and no retry —
it can hang indefinitely, and the orchestrator's top-level `catch` only fires
on a *throw*, not on a hang.

## Why it matters for the demo

Diagnose sits on the critical path with a ~6s budget (ADR 0001). If Claude is
slow or briefly overloaded the moment we demo, the receipt page stalls on
"diagnosing…" and the "under a minute" claim dies on stage. We need a hard
ceiling and a clean degrade, not a spinner.

## Acceptance criteria

- [ ] `diagnose()` enforces a wall-clock timeout (default ~12s, configurable)
      via `AbortSignal`; on timeout it rejects with a typed, identifiable error
      (not a generic `Error`).
- [ ] Transient API errors (`429`, `500`, `529`, network) retry with bounded
      exponential backoff (e.g. 2 retries) inside the timeout budget. `400`/
      `401` (bad request / bad key) do **not** retry — fail fast.
- [ ] On exhaustion, `diagnose()` surfaces a discriminable failure the
      orchestrator can route on — diagnosis impossible ⇒ `step:'failed'` with a
      human reason, OR (preferred) a signal `fix-trigger.ts` maps to the
      trace-only / issue path (0012) rather than a hard `failed`.
- [ ] `fix-trigger.ts` handles that signal: a diagnose failure degrades the run
      visibly (receipt shows why) instead of hanging or dying.
- [ ] `max_tokens` truncation guard: if `stop_reason === 'max_tokens'` the tool
      args may be partial — treat as a diagnose failure, don't validate-then-throw.
- [ ] Tests: timeout path, retry-then-succeed, retry-exhausted → degrade. Mock
      the SDK; no live call in the suite.

## Likely files / surfaces touched

- `functions/diagnose.ts` (timeout + retry wrapper around `messages.create`)
- `functions/fix-trigger.ts` (route the new failure signal)
- `functions/diagnose.test.ts` (mock-SDK resilience cases)

## Notes

- The SDK retries `429`/`5xx` itself (`maxRetries`, default 2) — decide whether
  to lean on that and just add the timeout, or wrap explicitly for the degrade
  semantics. Either way the **timeout + graceful degrade** is the load-bearing
  part; bare SDK retry doesn't give us the routing.
- Keep the timeout budget under the demo perf table (ADR 0001 §perf budget) so
  a degrade still fits in the 45s envelope.

## Outcome
<!-- Fill in when moving to done/. 2-3 lines max. -->
