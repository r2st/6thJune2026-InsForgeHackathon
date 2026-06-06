# Implementation map

Where the code lives. Pick your ticket, find your folder, ship.

## Top-level layout

```
hush/
├── infra/              # canonical InsForge config — insforge.toml lives here
│   ├── insforge.toml   # schema · RLS · storage · realtime · edge-fn manifest
│   └── seed/           # demo data fixtures
├── functions/          # InsForge edge functions (TypeScript, Deno-style)
│   ├── ingest.ts       # webhook entrypoint from the toy app
│   ├── fix-trigger.ts  # orchestrates diagnose → test → ship
│   ├── correlate.ts    # session → backend-log slice
│   ├── capture.ts      # pull the failing request from logs
│   ├── diagnose.ts     # InsForge AI prompt — generates the TOML diff
│   ├── toml.ts         # extract current TOML slice for grounding
│   ├── tomlPatch.ts    # parse/serialize TOML patches
│   ├── applyDiff.ts    # apply a patch to a branch project
│   ├── forgeJwt.ts     # re-sign captured claims for the fork
│   ├── replay.ts       # parallel replay prod + fork → verdict
│   ├── safety.ts       # post-LLM access-widening check
│   ├── score.ts        # confidence + tier routing
│   ├── types.ts        # shared types — read this first
│   ├── schemas/        # JSON Schemas (e.g. diagnose() output contract)
│   ├── prompts/        # versioned LLM prompts
│   └── fixtures/       # snapshot inputs for tests + smoke checks
├── apps/
│   ├── demo/           # toy storefront — Next.js + rrweb (the "victim app")
│   └── receipt/        # live status page — Next.js + InsForge Realtime
├── scripts/
│   ├── prewarm.sh      # spin up the branch-project pool
│   └── preflight.sh    # pre-pitch sanity checks
└── package.json        # pnpm workspaces root
```

## Ticket → folder crosswalk

| Ticket | Lives in | Notes |
|---|---|---|
| [0004 prewarm branch pool](agents/inbox/0004-prewarm-branch-pool.md) | `scripts/prewarm.sh` · `.hush/pool.json` | Pool state file is gitignored |
| [0005 capture failing request](agents/inbox/0005-capture-failing-request.md) | `functions/capture.ts` | Returns `ReplayPayload` (see `functions/types.ts`) |
| [0006 apply TOML diff to branch](agents/inbox/0006-apply-toml-diff-to-branch.md) | `functions/applyDiff.ts` · `functions/tomlPatch.ts` · `infra/insforge.toml` | The TOML file we patch is committed in **buggy** state |
| [0007 JWT forge](agents/inbox/0007-jwt-forge.md) | `functions/forgeJwt.ts` | Reads pool secret from `.hush/pool.json` |
| [0008 parallel replay + verdict](agents/inbox/0008-parallel-replay-and-verdict.md) | `functions/replay.ts` | Returns `Verdict` (see `functions/types.ts`) |
| [0014 backend log correlation](agents/inbox/0014-backend-log-correlation.md) | `apps/demo/lib/hush/insforge-client.ts` · `functions/correlate.ts` · `infra/insforge.toml` (`request_log` table) | Toy-app wrapper injects `x-hush-session-id` |
| [0015 receipt realtime wiring](agents/inbox/0015-receipt-page-realtime-wiring.md) | `apps/receipt/lib/realtime.ts` · `apps/receipt/app/r/[runId]/page.tsx` | Subscribes to channel `receipt` |
| [0018 diagnose output schema + prompt v1](agents/inbox/0018-diagnose-output-schema-and-prompt.md) | `functions/schemas/diagnosis.schema.json` · `functions/prompts/diagnose.v1.md` · `functions/diagnose.ts` | Schema is the contract |
| [0019 TOML context extractor](agents/inbox/0019-toml-context-extractor.md) | `functions/toml.ts` | Reads applied TOML, not disk |
| [0020 confidence scorer + tier routing](agents/inbox/0020-confidence-scorer-and-tier-routing.md) | `functions/score.ts` · `functions/fix-trigger.ts` (call site) | Replay verdict is the strongest signal |
| [0021 diff safety rail](agents/inbox/0021-diff-safety-rail.md) | `functions/safety.ts` | Deterministic post-LLM check |
| [0022 diagnosis card on receipt](agents/inbox/0022-diagnosis-card-on-receipt-page.md) | `apps/receipt/components/DiagnosisCard.tsx` | Brand-aligned styling per `assets/brand/brand-guide.md` |

## First time? Run

```bash
pnpm install                      # workspace install — pulls deps for all apps and functions
cp .env.example .env              # then fill in values per docs/deployment.md §2
pnpm -F demo dev                  # toy storefront on :3000
pnpm -F receipt dev               # receipt page on :3001
insforge config apply             # apply infra/insforge.toml to your linked project
```

The deployment doc ([docs/deployment.md](docs/deployment.md)) is the source of truth for env vars and the bring-up order. Follow it.

## House rules

- **No new top-level folders without an ADR.** If your ticket needs one, write the ADR in `docs/decisions/` first.
- **Cross-file types live in [functions/types.ts](functions/types.ts).** Don't redefine `Verdict` or `Diagnosis` per file.
- **The JSON Schema in [functions/schemas/diagnosis.schema.json](functions/schemas/diagnosis.schema.json) is a contract.** Edit it and you've changed the API for three downstream tickets. Coordinate before you touch it.
- **Don't commit `.hush/`.** Pool state, signing secrets, branch IDs — local-only.
- **Don't ship without [the safety rail](functions/safety.ts).** A passing replay isn't proof; a passing replay plus a non-widening diff is.
