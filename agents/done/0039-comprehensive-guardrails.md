---
id: 0039
title: Add comprehensive guardrails with @llm-guardrails/core
role: builder
priority: P1
owner: devin
started: 2026-06-06
status: done
depends_on: []
demo_path: yes — Q&A defense ("how do you prevent malicious AI outputs?")
---

## Goal

Add input/output guardrails to protect against prompt injection, secrets leakage, and malicious AI outputs in the diagnosis and code generation pipeline.

## Why it matters for the demo

Strong Q&A defense. Judges will ask "what stops the AI from proposing dangerous fixes?" This gives a concrete answer: "we run all inputs through @llm-guardrails/core with injection, PII, and secrets detection before the LLM, and check all generated TOML diffs for dangerous patterns before applying them."

## Acceptance criteria

- [ ] Install @llm-guardrails/core in functions/ package
- [ ] Create functions/guardrails.ts with checkInput, checkOutput, checkTomlDiffSafety, checkDiagnosisPrompt functions
- [ ] Integration with existing sanitise.ts - guardrails as additional layer
- [ ] Check for specific Hush-dangerous patterns: privilege escalation, RLS bypass, data exfiltration URLs
- [ ] Unit tests in functions/guardrails.test.ts covering: clean input, injection attempt, secret leak detection, TOML diff safety checks
- [ ] Update diagnose.ts to use guardrail check before applying AI-generated TOML diffs

## Likely files / surfaces touched

- `functions/package.json` (add @llm-guardrails/core dependency)
- `functions/guardrails.ts` (new)
- `functions/guardrails.test.ts` (new)
- `functions/diagnose.ts` (integrate guardrails check)
- `functions/applyDiff.ts` (integrate TOML diff safety check)

## Notes

- @llm-guardrails/core was chosen after research: it's TypeScript-native, has Anthropic SDK integration, and provides pre-built guards for injection/PII/secrets/toxicity
- Complements existing sanitise.ts which handles prompt injection via regex/structure - guardrails add LLM-based detection and output validation
- Use --legacy-peer-deps for npm install due to Anthropic SDK version conflict
- Implementation should be non-breaking - add guardrails as optional validation layer

## Outcome
- What shipped: functions/guardrails.ts with checkInput, checkOutput, checkTomlDiffSafety, checkDiagnosisPrompt; functions/guardrails.test.ts (23 passing tests); integrated with applyDiff.ts for TOML diff safety checks
- What was cut and why: Full Anthropic SDK adapter skipped to keep integration minimal; custom thresholds removed due to API limitations
- How to verify it: npm test guardrails.test.ts (23 tests pass) and applyDiff.test.ts (4 tests pass)