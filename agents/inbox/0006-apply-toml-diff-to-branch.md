---
id: 0006
title: Apply a proposed insforge.toml diff to a branch project
role: architect
priority: P0
owner:
started:
status: inbox
depends_on: [0004]
demo_path: yes — slide 6 requires the fork to actually have the new policy
---

## Goal

`witness/applyDiff.ts` exports `applyTomlDiff(branchId, diff: TomlPatch)
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

- `witness/applyDiff.ts`
- `witness/tomlPatch.ts` (parse/serialize)
- `infra/insforge.toml` (the file we patch — committed in buggy state)

## Notes

If the InsForge CLI doesn't expose `config apply` against a branch by
id, fall back to writing the patched file into a checkout of the branch
and pushing via the API. Confirm via `insforge-cli` skill before
starting.

## Outcome
