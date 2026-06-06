# Architecture

> Living doc. Update as the design firms up. Keep it skimmable. Ticket
> numbers reference `agents/inbox/`.

## What Hush does

A user gets frustrated in an InsForge-hosted app. Hush sees it. It pulls
the matching backend log, asks InsForge AI which RLS policy or JWT claim
caused the empty page, and writes a small `insforge.toml` patch. It forks
the backend, applies the patch, and replays the failing request against
both prod and fork. If the fork returns the right rows and the patch
doesn't widen access, Hush opens a GitHub PR with the clip, the trace,
and a confidence score.

Target on stage: under 45 seconds, end to end.

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

The receipt page subscribes to one channel (`receipt`) and
renders five step rows in real time — this is the demo's narrator.

### The money shot (ticket 0003)

**Judge watches the receipt page.** A customer's "My Orders" is empty
(prod). The status feed lights up — captured, log tapped, diagnosed —
then the screen shows two counts side by side: **prod `0`, fork `3`.**
The judge realizes Hush didn't just flag the bug; it forked the backend,
applied the policy patch, replayed the same session, and *proved the fix*
— then opened a PR with 90% confidence. **Sees:** the same request return
0 rows on prod and 3 on the fork. **Realizes:** this is a fix you can
trust, not a guess, and it only works because the backend is forkable.

End-to-end flow to that artifact: frustrated click → rrweb buffer +
`x-hush-session-id` → `/capture` edge fn → `request_log` correlation →
`diagnose` (TOML diff) → safety + TOML-validation rails → branch project
fork + `applyDiff` + forged JWT → parallel replay → `Verdict {prod, fork}`
→ confidence tier → PR. The receipt page renders the verdict pair
(`VerdictPair.tsx`) as the climax frame.

## Stage-by-stage detail

### Stage 1 — Capture

**Job:** when a user gets frustrated, send a small safe bundle for the
next stages to use.

| Layer | Source | Why |
|---|---|---|
| DOM trail | rrweb 30s ring buffer | Replay on the receipt page; evidence in the PR. |
| Signal | Client detector (rage / dead / abandoned / report) | Decides when to call `/capture`. |
| Backend log slice | `request_log` table, ±10s around `session_id` | Links the symptom to the policy that caused it. |
| Auth context | `auth.uid()` + `tenant_id` (set server-side) | Needed for RLS-scoped queries. |
| App context | url, route, viewport, build SHA | Minimum the diagnose stage needs. |

**Frustration signals — priority order**

1. **Rage-click** — ≥3 clicks within 1s on the same target (or 30px).
   *Easy to fire. This is the on-stage trigger.*
2. **Dead-click** — click with no DOM change and no network call within
   400ms. *Fits the RLS-misfire bug: the click does nothing because the
   policy silently filters.*
3. **Abandoned-form** — typed in a field, then left without submitting.
   *Safe backup demo.*
4. **Explicit report** — user taps a "report a bug" button. *Manual override.*

**Buffer, transport, storage**

- Buffer: rrweb in `record` mode, last 30s held in memory.
- Transport: one `POST /capture` with `{ session_id, signal, events, ctx }`.
- Storage: `tenants/{tenant_id}/sessions/{session_id}.json.gz` in InsForge
  Storage. Signed URL, expires well after the pitch.
- Metadata: one row in `sessions` (see Data model).

**Privacy**

- rrweb masks all inputs by default. `data-hush="mask"` hard-masks anything else.
- The edge fn strips `Authorization`, `Cookie`, and `Set-Cookie` before writing.
- Storage objects and `sessions` rows are scoped to the tenant via RLS.

**Sampling**

- Capture only when a frustration signal fires.
- Happy paths: no DB writes, no Storage writes, nothing streamed.

### Stage 2 — Correlate

**Job:** find the one failing request that caused the symptom.

1. The toy-app fetch wrapper sets `x-hush-session-id` on every InsForge
   call. Every edge fn logs the request to `request_log` with
   `session_id`, RLS decisions, and returned row count. (Ticket 0014.)
2. After capture lands, copy the ±10s window of `request_log` rows for
   that session into `sessions.request_log_window`. (Ticket 0014.)
3. `correlateSessionToRequest(...)` picks the failing request: the last
   one before `frustration_at` that returned an empty array or a 4xx.
   If there's no clear winner, drop to issue. (Ticket 0005.)

Output: a `ReplayPayload` — `{ method, path, headers, body, query, ts }`.
Headers include the user's JWT, which Stage 4 needs for forge.

### Stage 3 — Diagnose

**Job:** given the failing request and the current policy, produce a
`Diagnosis` — what broke and the patch that fixes it.

- Pull the relevant slice of `insforge.toml` for the target table
  (ticket 0019). The model sees only the policies it can edit.
- Call InsForge AI with a versioned prompt and a JSON-Schema-forced
  output (ticket 0018).
- `Diagnosis.summary` shows up on the receipt page. Write the prompt so
  the model treats it as user-facing copy.
- `Diagnosis.widens_access` is what the model claims. Stage 5's safety
  rail checks the patch deterministically and overrides if needed.

### Stage 4 — Branch test

Full mechanics in [ADR 0001](decisions/0001-test-on-a-fork.md). In short:

- Two forks pre-warmed at demo start, 1h TTL each (ticket 0004).
- Same seed in prod and every fork (tickets 0010 and 0016 — **see
  Critical analysis §C**).
- Apply the patch with `insforge config apply --env <branch-id>` (ticket 0006).
- Sign a new JWT with the fork's key, carrying the user's claims (ticket 0007).
- Replay the same request against prod and fork in parallel (ticket 0008).
- Verdict: `prod_rows < fork_rows` means bug confirmed and fix verified.
- If the fork pool is empty, fall back to a local policy check
  (ticket 0012). Less impressive, still honest.

### Stage 5 — Ship

- **Safety rail** (ticket 0021). A deterministic check: does the patch
  widen access? If yes, override the model's self-report.
- **Confidence score** (ticket 0020). 0–100, mixing diff size, policy
  blast radius, similarity to past merged fixes, and the replay verdict.
  Routes:
  - `≥85` — open a PR
  - `60–84` — open a draft PR with the failing trace
  - `<60` — open a GitHub issue, no diff
- **PR** (ticket 0011). The GitHub App opens (or updates) one PR per
  session. The body has the patch, a signed link to the clip, the
  before/after RLS trace, a link to the fork the judge can click, and
  the confidence breakdown. CI checks: branch-replay, existing tests,
  no policy blast.

## Defense in depth (two-signal per stage)

The principle in [`docs/the-hardest-part.html`](the-hardest-part.html)
says *every load-bearing claim is backed by two independent signals.*
That principle applies **within** each stage, not just across the
pipeline. The brainstorm in
[`docs/the-hardest-part-deeper.md`](the-hardest-part-deeper.md) maps
each stage to its primary signal AND its verification signal:

| Stage | Primary signal | Verification signal | Owner ticket |
|---|---|---|---|
| Capture | rrweb frustration event | matching backend log slot exists in `request_log` | 0024 + 0014 |
| Correlate | one candidate request matches the heuristic | tenant_id at frustration matches tenant_id on candidate | extension inside 0014 |
| Sanitise | prompt template uses `<user-data>` blocks | deterministic injection pre-filter passes | **0031** |
| Diagnose | LLM emits a valid `Diagnosis` against the schema | post-LLM AST + identifier + path validation passes | **0032** |
| Apply | `insforge config apply` returns ok | post-apply fingerprint matches intended patch | **0034** (extends 0006) |
| Replay | failing payload passes on fork, fails on prod | neighboring tenant + count + join probes all pass | **0033** |
| Verdict | suite's bug-confirmed + fix-verified flags both green | pre-run prod fingerprint matches re-fingerprint at verdict time | **0034** |
| Score | composite ≥ tier threshold | every signal ≥ tier floor (no veto fired) | **0035** |
| Ship | confidence tier dispatches | safety rail did not flag widening | 0021 |

The five new tickets (0031–0035) implement the verification signals the
earlier design didn't have. The receipt page renders the full stack as
each row clears — the "honesty stack" pattern. Each row a judge sees
turn green is a deterministic check the system passed, not a model's
self-report.

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
| **InsForge** (sponsor) | DB, auth/RLS, edge fns, Storage, Realtime, branch projects, AI — the structural core | Project keys | Pre-recorded screencast (`demo/recordings/latest.mp4`). |
| **Replicas** (sponsor) | "Watch" — production session capture feeding `ingest` (ticket 0041) | `REPLICAS_API_KEY` | rrweb capture in the toy app (built-in fallback). |
| **Lim.run** (sponsor) | "Test on a fork" — cloud browser re-verifies the fix on the fork + live preview URL (ticket 0042) | org key → per-instance token | Policy replay verdict stands alone; preview link omitted. |
| **Memoir** (sponsor) | Learning loop — versioned memory of fix outcomes; real similarity neighbour for the scorer (ticket 0043) | `MEMOIR_API_KEY` | Scorer uses neutral pgvector 50; no recall. |
| GitHub | PR open, status checks | GitHub App | Pre-rendered PR screenshot embedded in slide 7. |
| Anthropic (Claude) | Diagnosis step (`functions/diagnose.ts`, `claude-opus-4-8`) | `ANTHROPIC_API_KEY` | Cached diagnosis fixture for the demo bug. |
| OpenRouter | Embeddings via the InsForge AI gateway | `OPENROUTER_API_KEY` | Precomputed embeddings. |
| Vercel | Hosts the demo storefront + receipt page | CLI / CI token | `vercel dev` on the demo laptop. |

**Sponsor integrations must be real, not checkboxes.** Each row ships behind a
vendor-agnostic seam with a working fallback, so the demo never hard-depends on
a network API — but a sponsor box is only checked once that provider is the live
default path in a run we can demo (tickets 0041–0043). The earlier note that
"Devin and pgvector are referenced but not built" still holds for **Devin**
(dropped); pgvector is now in `infra/insforge.toml` and feeds the scorer.

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

One channel per session: `hush:session:<session_id>`. The receipt page
subscribes on mount and shows five step rows as messages arrive:

```
captured → log-tapped → diagnosed → branch-green → shipped
```

Each stage publishes one message; the row flips from spinner to ✓.
Ticket 0015 wires Capture; ticket 0009 wires Stages 2–5; ticket 0022
fills in the diagnosis card when `diagnosed` arrives.

A tenant-scoped channel (`bug_stream:<tenant_id>`) is a future "incident
inbox" idea — **not built**, do not subscribe.

## Perf budget

Full table in [ADR 0001](decisions/0001-test-on-a-fork.md). Target: ≤22s
in code, ≤45s on stage. Breaking this breaks the "under a minute" claim
in the pitch.

## What we are NOT building

- General-purpose session replay. We ship 30s windows on signal.
- Mobile, native, iframe, or cross-origin capture.
- Cross-tab session stitching.
- A pgvector "learn from rejections" loop (Q&A only — see §D).
- A Devin integration (Q&A roadmap only — §D).
- Auto-merge. Hush opens PRs; humans merge.
- Customer-facing billing, admin, or settings UI.

## Open questions

- [ ] rrweb v1 vs v2 — Builder, by T+1h.
- [ ] Stage trigger: rage-click or dead-click? See §B — Architect +
      Storyteller, by T+2h.
- [ ] Does a fork inherit `insforge.toml` at spin-up, or start empty?
      Architect, by T+1h.
- [ ] Minimum branch-project TTL — do we need a renewer? Architect, by T+1h.
- [ ] Does Realtime survive across branch projects, or do we bridge?
      Architect, by T+1h.
- [ ] Storage per-write cost at demo scale. Architect, by T+1h.

---

## Critical analysis (6 Jun)

> Issues that cross tickets or docs. Read this before claiming a P0.
> Most are one-person decisions. Each item names the owner.

### A — Two Realtime channels for one receipt page

The capture ticket I first wrote published to `bug_stream:<tenant_id>`.
Ticket 0009 uses `hush:session:<id>`. The receipt page can't subscribe
to both cleanly. **Picked:** session-scoped. Capture publishes to
`hush:session:<id>`. The tenant channel is a post-hackathon "inbox"
idea, not built.

*Action:* update ticket 0013's acceptance criteria when claimed.

### B — Pitch says "rage-click," but the RLS bug naturally produces a dead-click

The bug — RLS returns 0 rows, page is empty — usually makes a user
stare, not click. The pitch script gets the rage-click by having the
user mash a Reload button. That's a scripted move, not a natural one.

Pick one story and stick to it:

- **On stage:** rage-click on Reload. Script it.
- **In the product story:** dead-click is the primary signal; rage-click
  on Reload backs it up. Use this in Q&A.

Ticket 0024 already builds all three signals, so no code change. Just a
doc and script alignment for the Storyteller and Architect.

### C — Two seed specs overlap (tickets 0010 and 0016)

- Ticket 0010: two tenants (`acme`, `globex`), three orders for `acme`.
- Ticket 0016: two seed users — one with the old JWT shape, one with the
  new one.

These are the same fixture from two angles. If kept separate they will
drift. The demo bug needs both halves: the tenant split is what RLS
scopes on; the JWT-shape split is what makes the policy misfire.

*Action:* Architect — fold 0016's seed bits into `infra/seed/demo.sql`
(ticket 0010). 0016 becomes "wire the policy that reads the wrong
claim" — the bug, not the seed.

### D — Pitch promises Devin and pgvector, neither is built

The pitch close used to say: *"Built on InsForge — branch projects, RLS,
realtime, pgvector, AI — plus rrweb for capture and Devin to drive the
patch."*

No ticket touches Devin. Diagnose (ticket 0018) calls InsForge AI
directly. No ticket touches pgvector. The "learn from rejections" loop
is a Q&A planted seed, not code.

A judge who reads the pitch and the repo will notice. Two options:

1. **Drop both names from the close.** Let the planted seed carry the
   learn-loop. *Recommended.*
2. Wrap the InsForge AI call as a fake "Devin" step. Too cute, skip.

*Action:* Storyteller — option 1. I've made the edit in
`demo/pitch-script.md`; reverse if you disagree.

### E — Brand consistency (resolved)

The rename to **Hush** is done. Pitch, slides, brand kit (`assets/brand/`),
`ideas/FINAL.html`, ADR 0001, glossary, and the agent inbox all use the
new name. Old "Witness" mentions only live in git history.

*Action:* none. Keep this entry so the letters downstream don't shift;
delete on the next pass.

### F — No ticket for the toy app shell

Tickets 0023 (rrweb), 0024 (signals), 0013 (`/capture`), 0010 (seed),
and 0016 (RLS bug) all assume the toy app and its `orders` page exist.
Nobody owns that build.

Either the team agrees it's hour-zero work everyone shares, or it
needs a ticket: *"Toy app shell — Vite/React skeleton with Orders
page, login fixture, InsForge client wired."* Builder, P0, no deps,
blocks 0023 / 0024 / 0016.

*Action:* Builder or Architect — write the ticket at the next free ID.

### G — The "70% of bugs don't crash" stat is uncitable

`demo/pitch-script.md` used to say *"70% of user-reported bugs never
throw an error."* Already flagged in `ideas/FINAL-analysis.md §2.3`.
No source we can defend.

Two safe rewrites:

- *"Most user-reported bugs never reach your error tracker."*
- *"Sentry caught 0% of the last 5 bugs a real customer reported."*
  (Only if true and named.)

*Action:* I applied the directional rewrite. Storyteller — keep or swap.

### H — `/capture` latency isn't budgeted

ADR 0001 budgets stage 4 carefully. Stage 1 — gzip, Storage write, DB
insert, log query, Realtime publish — isn't on the budget. A cold edge
fn can take 2–3s and eat the receipt-page moment.

*Action:* Architect, on ticket 0013 — target p95 ≤500ms and warm the
edge fn at demo start, same as the fork pool.

### I — Confidence formula and the corpus we don't have (resolved)

Original concern: a multiplicative `diff × blast × similarity × verdict`
formula with a fabricated similarity factor (the old decks showed
`92% = diff(95) × blast(98) × similarity(89)` — that 89 was invented,
and with zero merge history the real similarity is undefined).

How the shipped scorer handles it (`functions/score.ts` `WEIGHTS`): a
weighted **sum**, not a product, with pgvector similarity defaulting to
a **neutral 50** when there's no merge-history corpus — the honest
day-one default, not a fabricated high score. For the demo bug:

```
90 = 0.4·replay(100) + 0.2·diff(100) + 0.2·blast(100) + 0.2·pgvector(50)
```

90 ≥ 85, so the tier is still `pr` — the "→ open PR" pitch line holds.
The badge reads **90** everywhere (deck, script, glossary, live receipt)
because that's what the code computes (ticket 0040). A legitimate 92 is
available only once [[0043-memoir-learn-from-rejections-memory]] feeds a
real prior neighbour at similarity 60 into the kNN lookup — until then,
90 is the honest number and no surface claims otherwise.

### J — The trace-only fallback gives up the InsForge moat

If the fork pool is empty, ticket 0012 checks the policy locally. It
works, but slide 6's "prod red, branch green" split-screen is gone.
Q&A risk: *"so when the fork is down, you're just a SQL linter?"*

*Action:* Architect — mark the fallback **degraded** in the receipt
UI. An amber banner ("branch unavailable — checking against captured
request") looks honest. Silent fallback looks like the fork was vapor.

### K — `request_log` is hour-zero infra with no ticket

Stages 2–4 all read `request_log`. Without it, correlation is guesswork.
The table and the auto-logging middleware need to exist before any
downstream stage works.

*Action:* Architect — either fold the schema and the logging middleware
into ticket 0013, or open a new ticket.

---

*Drafted 2026-06-06. Bold means resolved. Anything still open will
surface as a bug on stage.*
