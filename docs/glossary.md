# Glossary

Domain-specific terms used in this project. If a new agent wouldn't
immediately understand it, it belongs here.

| Term | Meaning |
|------|---------|
| **Hush** | The product. Catches "bugs that don't crash" by correlating frontend frustration with backend RLS/auth misfires and shipping an `insforge.toml` patch as a PR. |
| **Bug that doesn't crash** | A user-visible defect that throws no exception — empty list, wrong total, silently filtered row. Sentry / Datadog stay green; the user emails support or leaves. |
| **Capture** | Stage 1. Buffer the last 30s of rrweb events; flush on frustration signal. See `architecture.md` and tickets 0023 / 0024 / 0013. |
| **Correlate** | Stage 2. Pair the captured session with the matching backend request from `request_log`. Tickets 0014 + 0005. |
| **Diagnose** | Stage 3. InsForge AI proposes the failing policy + an `insforge.toml` diff in structured form. Tickets 0018 / 0019. |
| **Branch test** | Stage 4. Spin up an InsForge branch project, apply the diff, replay the failing request against prod and fork in parallel. Verdict comes from row-count delta. ADR 0001. |
| **Ship** | Stage 5. Safety-rail the diff, score confidence, open the PR (or draft, or issue). Tickets 0011 / 0020 / 0021. |
| **Receipt page** | The narrator UI. One per session, subscribes to `hush:session:<id>`, renders five step rows live. Tickets 0015 / 0022 / 0009. |
| **Frustration signal** | One of `rage_click`, `dead_click`, `abandoned_form`, `report`. The thing that decides we capture. |
| **rrweb** | [github.com/rrweb-io/rrweb](https://github.com/rrweb-io/rrweb). DOM + interaction recorder we embed in the toy app. We use the JSON event stream, not the rrweb player UI. |
| **Frustration ring buffer** | The 30s rolling window of rrweb events the client keeps in memory until a signal fires. |
| **ReplayPayload** | The one failing HTTP request extracted from the correlation window: `{ method, path, headers, body, query, ts }`. Headers include the user's verbatim JWT — needed for JWT forge. |
| **TOML diff** | A targeted edit to `insforge.toml`: an object `{ path, before, after }`. Always small — single policy, ≤5 lines. |
| **Branch project / fork** | An InsForge primitive: a forked copy of the prod project with its own schema, RLS, auth keys, and edge-fn deploys. Spun up from a pre-warm pool. 1h TTL. |
| **Pre-warm pool** | A small set of branch projects (size 2 for demo) provisioned before the pitch so spin-up at demo time is ~2s, not 10s. Ticket 0004. |
| **JWT forge** | Sign a new JWT with the *fork's* signing key carrying the *captured user's* claims, so the replay can hit the fork without auth issues. Ticket 0007. |
| **Verdict** | Output of the parallel replay: `{ prod_rows, fork_rows, ok }`. `prod_rows < fork_rows` → bug confirmed and fix verified. |
| **Confidence tier** | PR (≥85), Draft PR (60–84), Issue (<60). Routes the output by how sure we are the patch is right. |
| **Safety rail** | Deterministic post-LLM check: does the diff widen access? If yes, force the tier down to Issue regardless of confidence. Ticket 0021. |
| **`request_log`** | Table holding one row per backend request with `session_id`, `rls_decisions`, `returned_rows`. The load-bearing link between Capture and Correlate. |
| **`insforge.toml`** | Declarative config for an InsForge project: schema, RLS policies, auth, edge-fn routing. Hush patches this file, not application code. |
| **Money shot** | The slide-7 GitHub PR view: 4-line TOML diff, signed clip URL, RLS trace, 92% confidence badge. Demo closes on this. |
| **Toy app** | The demo SaaS we built. Multi-tenant orders app on InsForge. Hosts the seeded RLS-misfire bug. *(See `architecture.md` Critical analysis §F — needs an explicit ticket.)* |
| **Pivot (v5 → v6)** | The decision in `ideas/FINAL-analysis.md` to replay the *policy* on a forked backend, not the *page* in a sandboxed browser. |
