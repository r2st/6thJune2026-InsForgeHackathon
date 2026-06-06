---
id: 0017
title: PII masking + sampling hardening for capture
role: builder
priority: P2
owner:
started:
status: inbox
depends_on: [0023, 0013]
demo_path: no — covers the obvious judge Q&A objection
---

## Goal

Make the capture loop defensibly safe for a Q&A judge who asks "what about
PII?" or "what about cost?". Demo doesn't change; the answer changes.

## Why it matters for the demo

Q&A is scored. "What about PII / GDPR?" is a near-guaranteed question for
any session-replay product. We need a one-sentence answer backed by code.

## Acceptance criteria

- [ ] rrweb config: `maskAllInputs: true`, `maskTextSelector: '[data-hush="mask"]'`
- [ ] One toy-app field demonstrably masked in the recorded clip (e.g.
      the credit-card input on checkout)
- [ ] Edge fn strips `Authorization`, `Cookie`, `Set-Cookie` from anything
      embedded in the bundle (regex-fail on present in stored object)
- [ ] Sampling: only frustration-signal sessions hit `/capture`. Verified
      by recording a happy-path session and confirming zero `sessions` rows
      and zero Storage writes
- [ ] One bullet in `demo/pitch-script.md` Q&A prep covers the answer

## Likely files / surfaces touched

- `src/hush/capture.ts`
- `edge-functions/capture.ts`
- `demo/pitch-script.md` (Q&A section)
- `tests/hush/pii.test.ts`

## Notes

Don't gold-plate masking. The goal is "we have an answer," not "we have
a SOC2-compliant capture pipeline."
