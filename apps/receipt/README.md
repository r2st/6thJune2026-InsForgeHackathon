# apps/receipt — the live status page

The judge-facing surface. Subscribes to the InsForge Realtime channel `receipt` and renders the run's progress in real time.

URL shape: `/r/<runId>`. Hush's `ingest()` function returns the run id; the toy storefront opens the receipt page automatically.

## What goes here

| Path | Owner | Ticket |
|---|---|---|
| `lib/realtime.ts` | Realtime channel subscription | 0015 |
| `app/r/[runId]/page.tsx` | the live receipt page (the on-stage moment) | 0015 |
| `components/DiagnosisCard.tsx` | plain-English diagnosis card | 0022 |
| `components/StatusFeed.tsx` | the captured/diagnosed/testing/shipped feed | 0015 |
| `components/PrLink.tsx` | the closing CTA — click-through to the GitHub PR | 0011 |

## Dev

```bash
pnpm install
pnpm dev                  # :3001
```

Listening for events on channel `receipt` defined in [`infra/insforge.toml`](../../infra/insforge.toml):

- `captured` · `correlated` · `diagnosed` · `testing` · `shipped` · `failed`

Each event carries a `runId` + `step` + optional `detail` per the `ReceiptEvent` type in [`functions/types.ts`](../../functions/types.ts).

## Style

Brand-aligned with [`assets/brand/brand-guide.md`](../../assets/brand/brand-guide.md). Dark surfaces, Instrument Serif headlines, JetBrains Mono for the status feed timestamps, the orange dot for "live."
