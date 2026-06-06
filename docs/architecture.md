# Architecture

> Living doc. Update as the design firms up. Keep it skimmable.

## System diagram

```
[ user in toy app ]
       │  (rrweb events buffered in 30s ring)
       │
       ▼
[ frustration detector ] ── rage-click / abandoned-form / dead-click ──┐
                                                                       │
                                                          on signal:   ▼
                                            ┌──────────────────────────────────────┐
                                            │  POST /capture (InsForge edge fn)    │
                                            │  • write rrweb clip → Storage        │
                                            │  • insert sessions row → DB          │
                                            │  • tap edge-fn logs (sess_id window) │
                                            │  • publish Realtime `bug_stream`     │
                                            └─────────────────┬────────────────────┘
                                                              │
                                                              ▼
                                                  [ receipt page lights up ]
                                                       (downstream: Correlate
                                                        → Diagnose → Branch test
                                                        → PR — see Witness pivot)
```

## The Capture subsystem (brainstorm — 6 Jun)

The capture loop's job: when a user shows a frustration signal, ship a
small, replayable, PII-safe bundle that downstream stages (Correlate,
Diagnose, Branch test) can act on. Everything below is scoped to be
shippable in a 9-hour hackathon and demo-honest.

### What we capture

| Layer | Source | Why |
|---|---|---|
| DOM + interaction trail | [rrweb](https://github.com/rrweb-io/rrweb) ring buffer | Lets us replay the last ~30s on the receipt page and in branch-project tests. |
| Frustration signal | Client detector (see below) | The thing that decides we ship a bundle at all. |
| Backend request log slice | InsForge edge-fn logs, queried by `session_id + ±10s window` | This is the pivot's payoff — links the symptom to the policy that fired. |
| Auth context | `auth.uid()` + `tenant_id` claim, attached server-side | Required for RLS-aware correlation. |
| App context | URL, route, viewport, build SHA, feature flags from `window.__WITNESS__` | The minimum context the diagnoser needs. |

### Frustration signals (in priority order)

1. **Rage-click** — ≥3 clicks within 1s on the same target (or within 30px).
   *Easiest signal, highest demo value — this is what fires on stage.*
2. **Abandoned-form** — `input` events on ≥1 field, then route change or
   tab-close without a `submit`. *Strong "real" signal; safest second demo.*
3. **Dead-click** — click with no DOM mutation or network request within
   400ms. *Best for the RLS-misfire demo — the click does nothing because
   the policy silently filters the result.*
4. **Explicit report** — a "report a bug" affordance the user taps. *Cheap
   to wire; useful as a manual override during demo.*

### Buffering, transport, storage

- **Buffer:** rrweb in `record` mode, 30s rolling ring (`events: []` in
  memory, dropped at the head).
- **Transport:** single `POST /capture` to an InsForge edge function. JSON
  body with `{ session_id, signal, events, ctx }`. No streaming — the
  bundle is small (<200 KB typical) and one shot is simpler.
- **Storage:** rrweb JSON clip lands in InsForge Storage bucket `sessions/`
  as `tenants/{tenant_id}/sessions/{session_id}.json.gz`. Signed-URL only;
  receipt page reads via short-lived URL.
- **Metadata row:** `sessions` table — `id, tenant_id, user_id, signal,
  url, build_sha, clip_url, request_log_window, captured_at, status`.

### Backend correlation tap

Every edge-fn request from the toy app carries an `x-witness-session-id`
header. The `/capture` edge fn, on receiving a bundle, range-queries the
edge-fn log table for `session_id = ? AND ts BETWEEN captured_at - 10s
AND captured_at`. The result lands in `sessions.request_log_window` as
JSONB. *This is the link that lets the Diagnose stage say "the RLS policy
on `orders` returned 0 rows for this user."*

### Privacy

- rrweb `maskAllInputs: true` by default.
- Any element with `data-witness="mask"` is hard-masked.
- Cookies, `Authorization` headers, and `Set-Cookie` stripped at the edge fn
  before write.
- Storage objects are tenant-scoped; RLS on `sessions` table mirrors
  `tenant_id` claim.

### Sampling / cost

100% capture *of frustration-signal sessions only*. Everything else stays
in the client ring buffer and is dropped. No background streaming. No DB
writes for happy paths.

### Realtime hook

After the metadata insert, the edge fn publishes a small payload to the
InsForge Realtime `bug_stream:{tenant_id}` channel. The receipt page is
subscribed and updates its status lines in <1s. This is what makes the
demo feel live.

### Out of scope (capture subsystem only)

- Cross-tab session stitching.
- Mobile/native capture (web only).
- iframe + cross-origin capture.
- Long sessions (>5 min): we always ship the last 30s, never more.

## Components

| Component | Owner role | Tech | Purpose |
|-----------|-----------|------|---------|
| Toy app + capture SDK | Builder | Vite + React + rrweb | The thing the user "uses." Hosts the demo bug. |
| Frustration detector | Builder | TS, in-app | Decides when to ship a bundle. |
| `/capture` edge function | Architect | InsForge edge fn | Storage write, log tap, Realtime publish. |
| `sessions` table + RLS | Architect | InsForge Postgres | Source of truth for captured bundles. |
| Receipt page | Builder | React + InsForge Realtime SDK | The demo's "money shot" surface. |

## External APIs / sponsors

| Provider | Used for | Auth | Cache strategy | Fallback if it dies |
|----------|----------|------|----------------|---------------------|
| InsForge  | DB, auth/RLS, edge fns, Storage, Realtime, branch projects | Project keys | n/a | None — pivot makes InsForge structural. Backup is a screencast. |
| Devin     | Generate `insforge.toml` policy diff from failing branch test | API token | n/a | Pre-recorded diff demo. |

## Data model

```
sessions
  id              uuid pk
  tenant_id       uuid          -- RLS scope
  user_id         uuid
  signal          text          -- 'rage_click' | 'abandoned_form' | 'dead_click' | 'report'
  url             text
  build_sha       text
  clip_url        text          -- signed URL into Storage
  request_log_window  jsonb     -- slice of edge-fn logs around the signal
  captured_at     timestamptz
  status          text          -- 'captured' | 'diagnosed' | 'patched' | 'closed_not_bug'
```

## What we are NOT building

- A general-purpose session replay tool (we ship 30s windows on signal).
- Mobile, native, or iframe capture.
- Anything that requires the customer to install a backend agent — capture
  is one `<script>` tag plus the edge fn.

## Open questions

- [ ] Do we use rrweb v2 (newer, faster) or v1 (more stable docs)? — Builder, by T+1h.
- [ ] Does the toy app demo bug fire a dead-click or a render-empty? — Architect, by T+2h.
- [ ] Storage bucket cost on InsForge: any per-write fee that matters at demo scale? — Architect, by T+1h.
