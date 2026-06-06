<!--
Hush PR body template — ticket 0011.
Placeholders are {{key}} (see openPr.ts buildPrBody). Section headers are bold
one-liners, NOT h2s — the body must be readable in 5 seconds (slide 7). Keep one
blank line after each section. Order is fixed.
-->
**What broke** — {{summary}}

**The fix** — one policy edit, {{diffLoc}} line(s):
```toml
# {{diffPath}}
- rls = "{{diffBefore}}"
+ rls = "{{diffAfter}}"
```

**Proof it works** — tested on a throwaway fork of prod, same data, same JWT claims:
```
{{rlsTrace}}
```
{{verdictLine}}

**Session replay** — the user session that triggered this: {{clipUrl}}

**Poke at it** — the fork project the test ran against: {{branchUrl}}

**Confidence** — {{confidenceBreakdown}}

---
<sub>🔇 Opened by Hush · run `{{runId}}` · prompt `{{promptVersion}}` · this PR edits itself on re-run.</sub>
