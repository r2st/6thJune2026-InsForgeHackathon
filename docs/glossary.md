# Glossary

Terms used in this project. If a new agent wouldn't immediately
understand it, it goes here.

| Term | Meaning |
|------|---------|
| **Hush** | The product. Spots "bugs that don't crash" by linking user frustration to backend policy misfires, and ships an `insforge.toml` patch as a PR. |
| **Bug that doesn't crash** | A user-visible defect that throws no error — empty list, wrong total, silently filtered row. Sentry stays green; the user emails support or leaves. |
| **Capture** | Stage 1. Buffer the last 30s of rrweb events, then flush when a frustration signal fires. Tickets 0023 / 0024 / 0013. |
| **Correlate** | Stage 2. Match the captured session to the backend request that failed it. Tickets 0014 + 0005. |
| **Diagnose** | Stage 3. InsForge AI returns a `Diagnosis`: the failing policy and an `insforge.toml` patch. Tickets 0018 / 0019. |
| **Branch test** | Stage 4. Fork the backend, apply the patch, replay the failing request against prod and fork in parallel. ADR 0001. |
| **Ship** | Stage 5. Safety-check the patch, score confidence, open the PR (or draft, or issue). Tickets 0011 / 0020 / 0021. |
| **Receipt page** | The narrator UI. One per session. Subscribes to `hush:session:<id>` and updates five step rows live. Tickets 0015 / 0022 / 0009. |
| **Frustration signal** | One of `rage_click`, `dead_click`, `abandoned_form`, `report`. The thing that decides we capture. |
| **rrweb** | [github.com/rrweb-io/rrweb](https://github.com/rrweb-io/rrweb). A recorder that captures DOM and user events as JSON. We use the events; we don't use the rrweb player UI. |
| **Ring buffer** | The 30s window of rrweb events the browser keeps in memory until a signal fires. |
| **ReplayPayload** | The failing request, as JSON: `{ method, path, headers, body, query, ts }`. Headers include the user's JWT — Stage 4 needs it for forge. |
| **TOML diff** | An edit to `insforge.toml`: `{ path, before, after }`. Always small — one policy, ≤5 lines. |
| **Branch project / fork** | An InsForge primitive: a copy of the prod project with its own schema, RLS, auth keys, and edge fns. Spun up from a pre-warm pool. 1h TTL. |
| **Pre-warm pool** | Two branch projects provisioned before the pitch, so spin-up at demo time is ~2s instead of 10s. Ticket 0004. |
| **JWT forge** | Sign a new JWT with the fork's key, carrying the captured user's claims. Lets the replay hit the fork without auth errors. Ticket 0007. |
| **Verdict** | The parallel-replay output: `{ prod_rows, fork_rows, ok }`. If `prod_rows < fork_rows`, the bug is confirmed and the fix is verified. |
| **Confidence tier** | How sure we are about the patch. ≥85 opens a PR, 60–84 opens a draft, <60 opens an issue. |
| **Safety rail** | A deterministic check after the LLM: does the patch widen access? If yes, drop the tier to issue, no matter the confidence. Ticket 0021. |
| **`request_log`** | One table row per backend request. Has `session_id`, RLS decisions, returned row count. The link from Capture to Correlate. |
| **`insforge.toml`** | The InsForge project's config file: schema, RLS, auth, edge-fn routing. Hush patches this file, not application code. |
| **Money shot** | Slide 7: a GitHub PR with a 4-line TOML diff, the clip, the RLS trace, and a 90% badge. The demo closes here. |
| **Toy app** | The SaaS we built for the demo. Multi-tenant orders app on InsForge. Hosts the seeded RLS bug. *(No ticket yet — see `architecture.md` §F.)* |
| **Pivot (v5 → v6)** | The call in `ideas/FINAL-analysis.md`: replay the *policy* on a forked backend, not the *page* in a sandbox. |
