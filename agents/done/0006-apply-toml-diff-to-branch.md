---
id: 0006
title: Apply a proposed insforge.toml diff to a branch project
role: architect
priority: P0
owner: claude-opus-4-8
started: 2026-06-06
status: done
depends_on: [0004]
demo_path: yes — slide 6 requires the fork to actually have the new policy
---

## Goal

`hush/applyDiff.ts` exports `applyTomlDiff(branchId, diff: TomlPatch)
-> {ok: true, version} | {ok: false, lintError}`. Internally runs
`insforge config apply --env <branchId>` against the patched config,
returns the new config version or a structured lint error.

## Why it matters for the demo

On slide 6, the branch terminal needs to show "policy `orders_select` ·
patched" — that's the visible evidence the fix was applied. If apply
fails silently or hangs, the green column never lights up and the
verdict line lies.

## Acceptance criteria

- [ ] Accepts a structured `TomlPatch` (list of `{path, op:
      replace|add|remove, value}`) rather than a raw string
- [ ] Idempotent re-apply: applying the same patch twice succeeds
- [ ] Lint errors surface with file:line and a one-line human reason
- [ ] On success, returns the version id so the PR description can link
      to the exact branch config
- [ ] Time budget: <3s wall-clock for the demo diff

## Likely files / surfaces touched

- `hush/applyDiff.ts`
- `hush/tomlPatch.ts` (parse/serialize)
- `infra/insforge.toml` (the file we patch — committed in buggy state)

## Notes

If the InsForge CLI doesn't expose `config apply` against a branch by
id, fall back to writing the patched file into a checkout of the branch
and pushing via the API. Confirm via `insforge-cli` skill before
starting.

## Outcome

- `functions/tomlPatch.ts` — pure `applyPatch(toml, {path,before,after})`:
  dotted-path scalar swap, idempotent re-apply (changed=false), refuses to
  clobber on a value mismatch with file:line.
- `functions/applyDiff.ts` — `applyTomlDiff(branchId, diff, deps?)` patches the
  canonical TOML then `insforge config apply --env <branchId>`; returns the new
  version or a structured lint error. CLI exec injectable; 3s timeout.
- Note: honors the canonical `TomlPatch` (`{path,before,after}`) from types.ts,
  not the older list-of-ops shape in this ticket's first draft.
- 10 hermetic tests across tomlPatch.test.ts + applyDiff.test.ts.
