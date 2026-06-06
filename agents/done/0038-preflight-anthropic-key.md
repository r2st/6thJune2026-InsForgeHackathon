---
id: 0038
title: Preflight must check ANTHROPIC_API_KEY (diagnosis moved off OpenRouter)
role: architect
priority: P1
owner: claude-opus-4-8
started: 2026-06-06
status: done
depends_on: [0018, 0029]
demo_path: yes — a missing diagnosis key should fail loudly at setup, not on stage
---

## Goal

`scripts/preflight.sh` still gates on `OPENROUTER_API_KEY` for the diagnosis
path, but ticket 0018 moved `diagnose()` to a direct Anthropic call. The key
the demo now depends on (`ANTHROPIC_API_KEY`) is **not** checked, so a missing
or unset key sails through preflight and only blows up when `fix-trigger`
actually calls Claude — mid-demo.

## Why it matters for the demo

Preflight exists precisely so we discover misconfiguration at setup, not on
stage. After the 0018 swap, the one key the money-shot depends on is exactly
the one preflight no longer verifies.

## Acceptance criteria

- [ ] `scripts/preflight.sh` checks `ANTHROPIC_API_KEY` is set and non-empty.
- [ ] Keep `OPENROUTER_API_KEY` in the check **only if** ingest embeddings
      still need it (they do today) — make the comment say which key serves
      which path so the next swap is obvious.
- [ ] Optional but cheap: a live 1-token Anthropic ping (or `models.retrieve`)
      to catch a *present-but-invalid* key, behind a `--deep` flag so the fast
      path stays fast.
- [ ] `docs/deployment.md` §2 secret matrix updated: diagnosis → `ANTHROPIC_API_KEY`.

## Likely files / surfaces touched

- `scripts/preflight.sh`
- `docs/deployment.md` (§2 secrets table)

## Notes

- `infra/insforge.toml` is already correct (fix-trigger secret is
  `ANTHROPIC_API_KEY`; ingest keeps `OPENROUTER_API_KEY`) — this ticket only
  brings the preflight + docs in line with that.
- Small ticket; bundle into 0029's owner's next pass if they're still active.

## Outcome

- `scripts/preflight.sh` now checks `ANTHROPIC_API_KEY` (diagnosis) alongside
  `OPENROUTER_API_KEY` (ingest embeddings), with a comment mapping each key to
  its path. Added `--deep` flag: a live `GET /v1/models` ping that fails on a
  present-but-invalid key (401/403); fast path unchanged.
- `docs/deployment.md` §2 secret matrix + the fix-trigger/ingest notes updated:
  diagnosis → ANTHROPIC_API_KEY, embeddings → OPENROUTER_API_KEY.
