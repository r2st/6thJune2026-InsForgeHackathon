---
id: 0044
title: Fix the patch shape — `::uuid[]` direct-cast on jsonb is invalid Postgres
role: architect
priority: P0
owner:
started:
status: inbox
depends_on: [0018, 0006]
demo_path: yes — if Hush emits this on stage, applying it to the real fork dies
---

## Goal

The canonical fix Hush proposes everywhere is:

```
tenant_id = (auth.jwt() ->> 'tenant')::uuid
  OR tenant_id = ANY((auth.jwt() -> 'tenant_ids')::uuid[])   -- ← INVALID
```

`(jsonb)::uuid[]` is **not a valid Postgres cast**. Applying it to a real
branch project fails:

```
ERROR: cannot cast type jsonb to uuid[]  (code INTERNAL_ERROR)
```

The correct form (verified working on the live `hush-fix-sandbox` fork —
see docs/TESTING.md "Real fork verdict"):

```
tenant_id = (auth.jwt() ->> 'tenant')::uuid
  OR tenant_id = ANY(array(select jsonb_array_elements_text(auth.jwt() -> 'tenant_ids'))::uuid[])
```

## Why it matters for the demo

The real-fork money shot (slide 06) applies the patch to a branch project,
then replays. With the invalid cast, `applyDiff` (0006) errors and the fork
never goes green — the demo's strongest moment dies on stage.

**Why no test caught it:** every unit test treats the patch as a *string*
(safety does widening analysis; traceReplay evaluates `ANY(...)` in
JavaScript, not SQL). None of them execute the cast. The live fork is the
only thing that runs real SQL — which is exactly the point of the fork path
and `docs/the-hardest-part.md` (a trace verdict is weaker than a fork verdict).

## Done in this ticket's opening pass (runtime-critical)

These three are the source the LLM learns from / the demo emits — fixed
already (they break no test; `diagnose.test.ts` uses placeholder patch text):

- [x] `functions/prompts/diagnose.v1.md` — example `after`
- [x] `functions/prompts/diagnose.v2.md` — example `after`
- [x] `functions/fixtures/diagnose-input-rls-empty.json` — `after`

## Remaining (coordinated pass — re-run each suite)

These carry the broken cast as a hardcoded test/demo constant. They pass
today (no SQL executed), so they're not blocking — but they should move to
the correct form for consistency, and a couple are demo-facing:

- [ ] `demo/slides/index.html` — the PR-diff money-shot panel (DEMO-FACING; fix before stage)
- [ ] `infra/insforge.toml` — the patch comment, if present
- [ ] `functions/safety.test.ts` (mine) · `functions/e2e-trace.test.ts` (mine)
- [ ] `functions/tomlValidate.test.ts` · `functions/tomlPatch.test.ts`
- [ ] `functions/fingerprint.test.ts` · `functions/score.test.ts`
- [ ] `functions/fix-trigger.test.ts` · `functions/openPr.test.ts`
- [ ] `functions/traceReplay.test.ts` · `functions/applyDiff.test.ts`

> Grep: `grep -rln "tenant_ids')::uuid\[\]" --include='*.ts' --include='*.html' --include='*.toml' .`

## Acceptance criteria

- [ ] No occurrence of the direct `(... -> 'tenant_ids')::uuid[]` cast remains
      in any patch-`after` string (prompts, fixtures, tests, slides, toml).
- [ ] `applyDiff` against a live branch project applies the corrected patch
      without a cast error and the fork returns 3 for the migrated JWT (the
      manual proof in docs/TESTING.md, automated).
- [ ] `traceReplay`'s JS evaluator still parses the corrected branch (it keys
      on `ANY(` + the `-> 'tenant_ids'` accessor — confirm with a test).
- [ ] Full suite green after the coordinated pass.

## Notes

- Consider a tiny `tomlValidate` (0032) rule that rejects `(jsonb)::uuid[]`
  / `(jsonb)::<type>[]` direct casts outright, so a future bad patch is caught
  deterministically pre-apply instead of at apply-time. Strictly stronger than
  fixing the strings — it stops the class of bug.
- Evidence + the live two-backends proof: docs/TESTING.md.

## Outcome
<!-- Fill in when moving to done/. -->
