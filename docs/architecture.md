# Architecture

> Living doc. Update as the design firms up. Keep it skimmable. Ticket
> numbers reference `agents/inbox/`.

## One-paragraph elevator

Hush watches a user's session in an InsForge-hosted SaaS, detects
frustration (rage / dead / abandoned), pulls the matching backend request
log, asks InsForge AI which RLS policy or JWT claim caused the symptom,
spins up a branch project, applies the proposed `insforge.toml` diff,
replays the failing request against prod **and** fork in parallel, and
— if the fork returns the expected rows and the diff doesn't widen
access — opens a GitHub PR with the clip, the trace, and a confidence
badge. End-to-end target on stage: ≤45 seconds.

## End-to-end pipeline

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Hush, end to end                          │
└──────────────────────────────────────────────────────────────────────┘

  user (toy app)
        │                                            tickets
        │ rrweb 30s ring buffer ─────────────────── (0023)
        │ frustration detector ─────────────────── (0024)
        │
        ▼
  ┌─ Stage 1 · CAPTURE ─────────────────────────┐
  │  POST /capture (InsForge edge fn)           │ (0013)
  │   • gzip clip → Storage                     │
  │   • insert sessions row                     │
  │   • Realtime: hush:session:<id> "captured"│
  └─────────────────┬───────────────────────────┘
                    │
                    ▼
  ┌─ Stage 2 · CORRELATE ───────────────────────┐
  │  window query → request_log_window          │ (0014)
  │   ↳ pick the one failing request            │ (0005)
  │     → ReplayPayload {method,path,hdr,body}  │
  │  Realtime: "log-tapped"                     │
  └─────────────────┬───────────────────────────┘
                    │
                    ▼
  ┌─ Stage 3 · DIAGNOSE ────────────────────────┐
  │  context: extract orders.* TOML slice       │ (0019)
  │  prompt:  InsForge AI w/ structured output  │ (0018)
  │   → Diagnosis { summary, failing_policy,    │
  │                 toml_diff, widens_access,   │
  │                 confidence_inputs }         │
  │  Realtime: "diagnosed" (renders card)       │ (0022)
  └─────────────────┬───────────────────────────┘
                    │
                    ▼
  ┌─ Stage 4 · BRANCH TEST ─────────────────────┐
  │  branch from pre-warm pool (size 2)         │ (0004)
  │  seed deterministic fixture                 │ (0010, 0016)
  │  apply TOML diff                            │ (0006)
  │  forge fork-signed JWT w/ captured claims   │ (0007)
  │  parallel replay: prod vs fork              │ (0008)
  │   → Verdict { prod_rows, fork_rows, ok }    │
  │  Realtime: "branch-green" / "branch-red"    │
  │  Fallback: trace-only static eval           │ (0012)
  └─────────────────┬───────────────────────────┘
                    │
                    ▼
  ┌─ Stage 5 · SHIP ────────────────────────────┐
  │  diff safety rail (deterministic widening   │ (0021)
  │    check trumps LLM self-report)            │
  │  confidence score → tier (PR/draft/issue)   │ (0020)
  │  GitHub PR w/ clip + trace + branch URL     │ (0011)
  │  Realtime: "shipped"                        │
  └─────────────────────────────────────────────┘
                    │
                    ▼
              [ slide 7 — money shot ]
```

The receipt page subscribes to one channel (`hush:session:<id>`) and
renders five step rows in real time — this is the demo's narrator.

## Stage-by-stage detail

### Stage 1 — Capture

**Job:** when a user shows a frustration signal, ship a small, replayable,
PII-safe bundle.

| Layer | Source | Why |
|---|---|---|
| DOM trail | rrweb ring buffer (30s) | Receipt-page replay + evidence for PR. |
| Signal | Client detector (rage / dead / abandoned / report) | Triggers `/capture`. |
| Backend log slice | `request_log` table, ±10s window keyed by `session_id` | The pivot — links symptom to policy. |
| Auth context | `auth.uid()` + `tenant_id` (set server-side) | RLS-aware correlation. |
| App context | url, route, viewport, build SHA | Diagnose needs the minimum. |

**Frustration signals — priority order**

1. **Rage-click** — ≥3 clicks within 1s on the same target (or within 30px).
   *Easiest signal, highest demo value. This is what fires on stage.*
2. **Dead-click** — click with no DOM mutation **and** no network request
   within 400ms. *Best for the RLS-misfire bug class — the click does
   nothing because the policy silently filters.*
3. **Abandoned-form** — `input` events ≥1, then route change or tab close
   without `submit`. *Safe second demo.*
4. **Explicit report** — tap on a "report a bug" affordance. *Manual override.*

**Buffering / transport / storage**

- Buffer: rrweb `record` mode, 30s rolling ring in memory.
- Transport: one `POST /capture` JSON body `{ session_id, signal, events, ctx }`.
- Storage: `tenants/{tenant_id}/sessions/{session_id}.json.gz` in InsForge
  Storage. Signed URL, TTL well past pitch slot.
- Metadata: `sessions` table (see Data model).

**Privacy**

- rrweb `maskAllInputs: true`; `data-hush="mask"` hard-masks.
- Edge fn strips `Authorization`, `Cookie`, `Set-Cookie` before write.
- Storage objects + `sessions` row are tenant-scoped via RLS.

**Sampling**

- 100% capture of frustration-signal sessions only.
- 0% of happy paths. No background streaming. No DB writes for happy paths.

### Stage 2 — Correlate

**Job:** turn the captured session into one ReplayPayload — the single
failing HTTP request that downstream stages reason about.

1. Toy-app fetch wrapper sets `x-hush-session-id` on every InsForge
   call. Every edge fn logs `{ ts, route, session_id, user_id, tenant_id,
   rls_decisions, returned_rows }` to `request_log`. (Ticket 0014.)
2. After capture lands, populate `sessions.request_log_window` (JSONB)
   with rows where `session_id = ? AND ts ∈ [captured_at − 10s,
   captured_at]`. (Ticket 0014.)
3. `correlateSessionToRequest(...)` picks the single failing request
   from the window: *latest request before frustration_at whose
   response was empty array or 4xx for this tenant.* Ambiguous → drop
   to issue. (Ticket 0005.)

Output: `ReplayPayload = { method, path, headers, body, query, ts }` —
headers include the user's verbatim JWT, needed for forge in stage 4.

### Stage 3 — Diagnose

**Job:** produce a structured `Diagnosis` from `(ReplayPayload + TOML
context)`. This is the receipt page's plain-English line and the seed
for the PR body.

- Extract the relevant `insforge.toml` slice for the target table
  (ticket 0019) — gives the model exactly the policies it can edit.
- Call InsForge AI with a versioned prompt + JSON-Schema-forced
  structured output (ticket 0018).
- `Diagnosis.summary` *is* the receipt-page copy. The model treats it as
  user-facing.
- `Diagnosis.widens_access` is the model's intent — the deterministic
  safety rail in stage 5 trumps it.

### Stage 4 — Branch test

See [ADR 0001 — Test on a fork](decisions/0001-test-on-a-fork.md) for
mechanics. Summary:

- Two forks pre-warmed at demo start, 1h TTL each (ticket 0004).
- Single canonical seed applied at both prod and fork bootstrap
  (tickets 0010 + 0016, **see Critical analysis §C**).
- Apply diff with `insforge config apply --env <branch-id>` (ticket 0006).
- Forge fork-signed JWT with captured claims (ticket 0007).
- Parallel replay prod vs fork; diff response (ticket 0008).
- Verdict: `prod_rows < fork_rows` → bug confirmed, fix verified.
- Fallback if branch pool is empty: trace-only static policy eval
  (ticket 0012). Loses InsForge "wow" but keeps the demo honest.

### Stage 5 — Ship

- **Safety rail** (ticket 0021): deterministic widening check on the
  diff. Overrides `Diagnosis.widens_access` if the model under-reported.
- **Confidence score** (ticket 0020): 0–100 from
  (diff_size × policy_blast × past-merged similarity × verdict). Tier
  routes:
  - `≥85` → open PR
  - `60–84` → draft PR with the failing trace
  - `<60` → GitHub issue, no diff
- **PR** (ticket 0011): GitHub App opens an idempotent PR. Body
  embeds the diff, the signed clip URL, the before/after RLS trace,
  the branch-project URL (judge can poke at it live), and the confidence
  breakdown. CI status checks: `branch-project replay`, `existing tests`,
  `no policy blast`.

## Components

| # | Component | Owner role | Tech | Tickets |
|---|---|---|---|---|
| 1 | Toy app shell | Builder | Vite + React | *(no ticket — see Critical analysis §F)* |
| 2 | Capture SDK | Builder | rrweb + TS | 0023 |
| 3 | Frustration detector | Builder | TS, in-app | 0024 |
| 4 | `/capture` edge fn | Architect | InsForge edge fn | 0013 |
| 5 | `sessions` + `request_log` + RLS | Architect | InsForge Postgres | 0013, 0014 |
| 6 | Session→request correlator | Architect | TS | 0005, 0014 |
| 7 | TOML context extractor | Architect | TS | 0019 |
| 8 | `diagnose()` (AI + schema) | Architect | InsForge AI | 0018 |
| 9 | Branch pool pre-warmer | Architect | shell + insforge CLI | 0004 |
| 10 | Demo seed fixture | Architect | SQL | 0010, 0016 |
| 11 | TOML diff applier | Architect | insforge CLI wrapper | 0006 |
| 12 | JWT forger | Architect | jose / TS | 0007 |
| 13 | Parallel replay | Builder | TS, fetch ×2 | 0008 |
| 14 | Trace-only fallback | Architect | TS | 0012 |
| 15 | Diff safety rail | Architect | TS | 0021 |
| 16 | Confidence scorer | Architect | TS | 0020 |
| 17 | PR opener | Builder | GitHub App | 0011 |
| 18 | Receipt page | Builder | React + InsForge Realtime SDK | 0015, 0022, 0009 |

## External APIs / sponsors

| Provider | Used for | Auth | Fallback if it dies |
|---|---|---|---|
| InsForge | DB, auth/RLS, edge fns, Storage, Realtime, branch projects, AI | Project keys | Pre-recorded screencast (`demo/recordings/latest.mp4`). |
| GitHub | PR open, status checks | GitHub App | Pre-rendered PR screenshot embedded in slide 7. |

**Devin and pgvector are referenced in the pitch but are not in the build
plan — see Critical analysis §D.**

## Data model

```
sessions
  id                  uuid pk
  tenant_id           uuid          -- RLS scope
  user_id             uuid
  signal              text          -- rage_click | dead_click | abandoned_form | report
  url                 text
  build_sha           text
  clip_url            text          -- signed URL into Storage
  request_log_window  jsonb         -- ±10s slice of request_log
  captured_at         timestamptz
  status              text          -- captured | correlated | diagnosed | tested | shipped | closed_not_bug

request_log                          -- one row per backend request the toy app makes
  id                  bigserial pk
  ts                  timestamptz
  session_id          uuid          -- from x-hush-session-id header
  user_id             uuid
  tenant_id           uuid
  route               text
  method              text
  status_code         int
  returned_rows       int
  rls_decisions       jsonb         -- [{policy, rows_before, rows_after}]

diagnoses
  session_id          uuid pk → sessions.id
  prompt_version      text
  summary             text          -- user-facing copy on receipt page
  failing_policy      text          -- "<table>.<policy>"
  failing_jwt_claim   text
  toml_diff           jsonb         -- {path, before, after}
  widens_access       bool          -- LLM self-report; overridden by safety rail
  confidence_inputs   jsonb
  created_at          timestamptz

branch_tests
  session_id          uuid pk → sessions.id
  branch_id           text          -- from pre-warm pool
  branch_url          text          -- judge-clickable
  prod_rows           int
  fork_rows           int
  verdict             text          -- ok | not_a_bug | malformed | error
  replayed_at         timestamptz

patches
  session_id          uuid pk → sessions.id
  pr_url              text
  tier                text          -- pr | draft | issue
  confidence          int           -- 0-100
  shipped_at          timestamptz

-- demo store (the bug lives here)
orders(id, tenant_id, total, created_at)
```

## Realtime channel

**One channel per session:** `hush:session:<session_id>`. The receipt
page subscribes on mount and renders five step rows as messages arrive:

```
captured → log-tapped → diagnosed → branch-green → shipped
```

Each stage publishes one message; the row updates from spinner to ✓.
Ticket 0015 wires capture; ticket 0009 wires stages 2–5; ticket 0022
renders the diagnosis card body when `diagnosed` arrives.

A tenant-scoped channel (`bug_stream:<tenant_id>`) is a post-hackathon
idea for an "incident inbox" view — **not built**, do not subscribe.

## Demo-time perf budget

See [ADR 0001](decisions/0001-test-on-a-fork.md) for the full table.
Total target: ≤22s programmatic, ≤45s on stage. Anything that breaks
this budget breaks the "in under a minute" claim in the pitch.

## What we are NOT building

- General-purpose session replay (we ship 30s windows on signal only).
- Mobile, native, iframe, cross-origin capture.
- Cross-tab session stitching.
- A learn-from-rejections pgvector loop *during the hackathon* (Q&A
  answer only — see Critical analysis §D).
- A Devin integration *during the hackathon* (Q&A roadmap only — §D).
- Auto-merge. Hush only opens PRs; humans merge.
- Customer-facing billing, multi-tenant admin, or settings UI.

## Open questions

- [ ] rrweb v2 vs v1 — Builder, by T+1h.
- [ ] Does the on-stage trigger fire `rage_click` or `dead_click`? — see
      §B below — Architect + Storyteller, by T+2h.
- [ ] Branch projects inherit parent `insforge.toml` at spin-up or empty?
      — Architect, by T+1h.
- [ ] Branch-project minimum TTL — do we need a renewer? — Architect, by T+1h.
- [ ] Realtime survives across branch projects, or do we bridge prod → fork
      events? — Architect, by T+1h.
- [ ] Storage per-write cost at demo scale — Architect, by T+1h.

---

## Critical analysis (6 Jun)

> Cross-cutting issues that span tickets and docs. Read this before
> claiming a P0 ticket — most of these need a one-person decision, not
> a meeting. Each item names the owner role.

### A — Realtime channel was inconsistent across tickets

The capture ticket I authored proposed `bug_stream:<tenant_id>`; downstream
ticket 0009 uses `hush:session:<id>`. Two channels, one receipt page →
broken. **Resolution above:** session-scoped is canonical. Capture ticket
0013 must publish to `hush:session:<id>`, not `bug_stream`. Tenant
channel is a post-hackathon "inbox" idea, not built.

*Action:* update ticket 0013 acceptance criteria to `hush:session:<id>`
when claimed.

### B — Pitch says "rage-click," architecture says "dead-click is best for RLS-misfire"

The bug class (RLS returns 0 rows → empty page) naturally produces a
**dead-click** (or no click at all), not a rage-click. The pitch script
gets rage-click by having the user mash a Reload button — a scripted
theatrical move, not the natural user behavior.

This is fine, but the script and the architecture should agree explicitly:

- **On stage:** trigger is rage-click on the Reload button. Script it.
- **In the product story:** primary signal is dead-click on a list row,
  with rage-click on Reload as a secondary corroborator. Q&A answer.

*Action:* Storyteller + Architect — pick one phrasing and align ticket
0024's acceptance criteria with the demo's scripted action. Right now
ticket 0024 implements all three signals, so no code change is needed —
this is a doc + script alignment.

### C — Two seed specs overlap (tickets 0010 and 0016)

- Ticket 0010: two tenants (`acme`, `globex`), three orders for `acme`.
- Ticket 0016: two seed users — one legacy JWT claim shape, one migrated.

These describe the same fixture from different angles, and they will
drift if maintained separately. **The demo bug needs both:** the tenant
split is what RLS scopes on; the JWT-shape split is what causes the
filter to misfire. One file, one seed.

*Action:* Architect — fold ticket 0016's acceptance criteria into ticket
0010's `infra/seed/demo.sql`. Ticket 0016 becomes "wire the policy that
*reads* the wrong claim shape" — the bug itself, not the seed.

### D — Pitch promises Devin + pgvector, neither is built

- The pitch close says: *"Built on InsForge — branch projects, RLS,
  realtime, pgvector, AI — plus rrweb for capture and Devin to drive the
  patch."*
- No ticket touches Devin. Diagnose (ticket 0018) calls InsForge AI.
- No ticket touches pgvector. The "learn from rejections" loop is a Q&A
  planted seed (already correctly footnoted in `pitch-script.md`).

A judge who reads the pitch and the repo will notice. Two clean choices:

1. **Drop both names from the close** and let the planted seed carry the
   learn-loop. (Recommended — honest, no scope creep.)
2. **Add a fake-but-honest "Devin would generate the diff" step** —
   prompt InsForge AI as if it were Devin, surface the call in logs.
   (Too cute. Skip.)

*Action:* Storyteller — update `demo/pitch-script.md` close per option 1.
*I've applied the smallest defensible edit (footnote both as roadmap) in
this pass; reverse it if you'd rather drop the names entirely.*

### E — Brand consistency (resolved)

Earlier in the build, parts of the codebase still carried the old
working name in headlines, asset metadata, and ADR signoffs. That
sweep is now complete: the active brand everywhere — pitch, slides,
brand kit (`assets/brand/`), `ideas/FINAL.html`, ADR 0001, glossary,
agent inbox — is **Hush**. The only references that remain are
intentionally frozen inside `ideas/archive/` as prior-event history.

*Action:* none. Section retained so the numbering downstream stays
stable; safe to delete on next pass.

### F — No ticket for the toy app shell

Tickets 0023 (embed rrweb) and 0024 (frustration detector) reference
"the toy app" as if it exists. Tickets 0013 (`/capture` edge fn),
0010 (seed), 0016 (RLS bug) reference an `orders` table and "My Orders"
page also as if they exist.

Either the toy app is hour-zero infra everyone assumes, or it's a
missing P0 ticket. **Recommended:** add ticket — "Toy app shell —
Vite/React skeleton with Orders page, login fixture, InsForge client
wired" — Builder, P0, no dependencies, before 0023 / 0024 / 0016 can
ship.

*Action:* Builder or Architect — drop the ticket at the next free ID.
I didn't write it because it sits outside the Capture brainstorm scope.

### G — The "70% of bugs don't crash" stat is uncitable

`demo/pitch-script.md` line: *"70% of user-reported bugs never throw an
error."* Already flagged in `ideas/FINAL-analysis.md §2.3`. A technical
judge will ask the source and we won't have one.

Two safe rewrites:
- *"Most user-reported bugs never reach your error tracker."*
- *"Sentry caught 0% of the last 5 bugs reported by a real customer of
   ours."* (only if true and we can name them)

*Action:* Storyteller — pick one. *I've applied the directional rewrite
in this pass.*

### H — Capture edge-fn latency isn't budgeted

ADR 0001 budgets stage 4 (branch test) tightly. Stage 1 (`/capture`)
does five things — gzip, Storage write, DB insert, log query, Realtime
publish — and isn't on the perf budget. A cold edge fn can blow 2–3s,
which eats the receipt-page-lights-up moment.

*Action:* Architect (on ticket 0013) — add p95 ≤500ms target; warm the
edge fn at demo start the same way we pre-warm branches.

### I — Confidence formula assumes a "past-merged" corpus we don't have

Ticket 0020 mixes (diff_size × policy_blast × past-merged similarity ×
verdict). At hour 9 we have zero merged history. Similarity collapses
to 0 and the score is fiction. The pitch shows `92% = diff(95) ×
blast(98) × similarity(89)` — that 89 is made up.

*Action:* Architect (on ticket 0020) — either seed a small corpus of
synthetic "past PRs" (5–10 hand-written) so similarity is non-zero, or
remove the similarity factor and rebalance. Demo-honest answer is the
former.

### J — Trace-only fallback (ticket 0012) collapses the InsForge moat

If the branch pool is empty, ticket 0012 evaluates the policy locally
against the captured request. Works, but the pitch's slide 6
*"prod (red) and branch (green)"* split-screen is gone. Q&A: *"so when
the fork is down, you're just a SQL linter?"*

*Action:* Architect — explicitly mark the fallback path **degraded** in
the receipt-page UI (e.g. amber banner: "branch unavailable — verifying
against captured request"). Look honest beats looking like the fork was
vapor.

### K — `request_log` is the new load-bearing primitive and isn't called out anywhere

Stages 2–4 all read from `request_log`. Without it, correlation is
guesswork. The table needs to exist before *any* downstream stage works
(the toy app needs to log; the edge fns need to log). Hour-zero infra
with no ticket.

*Action:* Architect — fold the `request_log` schema and the auto-logging
middleware into ticket 0013 (capture edge fn) as a prerequisite, or
split it out as a new ticket.

---

*Drafted 2026-06-06. Resolutions in bold. Anything unresolved here will
surface as a bug on stage.*
