---
id: 0022
title: Plain-English diagnosis card on the receipt page
role: builder
priority: P1
owner: claude-app-layer
started: 2026-06-06T13:00Z
status: in_progress
depends_on: [0018, 0015]
demo_path: yes — the on-stage moment between "diagnosing…" and "shipping…"
---

## Goal

When `ingest` broadcasts the `diagnosing` → `diagnosed` step, the receipt
page renders a card with the plain-English diagnosis (the `summary` field
from ticket 0004's schema) and the failing policy. This is what the judge
reads on slide 06 between "anomaly detected" and "branch project replay."

## Why it matters for the demo

This is the moment Hush stops looking like a black box. The card says
*"User expected to see their orders. The RLS policy on `orders` reads
`auth.jwt() -> 'tenant'`, but the JWT migrated to `tenant_ids[]` last
week."* That sentence is what makes a judge nod.

## Acceptance criteria

- [ ] New component in the receipt page: `<DiagnosisCard />` that renders
      `summary`, `expectation`, `observation`, `failing_policy` from the
      Realtime payload
- [ ] Styling matches `assets/brand/brand-guide.md`:
      - Background: `--bg-elev2` with `--accent` left-border (3px)
      - Mono `// DIAGNOSIS` eyebrow in `--accent`
      - Body copy in `--ink`; failing policy/JWT path in `code`-style chip
- [ ] Slides in below the status feed with a 200ms fade — not a layout jump
- [ ] Listens for `step: 'diagnosed'` Realtime event and renders within
      150ms of arrival (no spinner — the card IS the visual feedback)
- [ ] Falls back gracefully if the payload is missing fields (renders
      whatever is present; doesn't crash on a partial)
- [ ] Mobile breakpoint: card width matches the status feed column;
      no overflow

## Likely files / surfaces touched

- `apps/receipt/components/DiagnosisCard.tsx` (new)
- `apps/receipt/app/r/[runId]/page.tsx` (mount the card on the diagnosed event)
- `apps/receipt/lib/realtime.ts` (subscription handler — add the diagnosed
  case if it's not there)

## Notes

- This is the single most-rehearsed moment of the demo. Test it on the
  venue projector — the failing-policy line must be legible from the
  back row.
- Don't paginate or truncate. The summary is ≤200 chars by schema; show
  the whole thing.
- The `failing_jwt_claim` field is the most interesting visual. Format
  it as `code` inline, not in a separate sub-section.

## Outcome
<!-- Fill in when moving to done/. 2-3 lines max. -->
