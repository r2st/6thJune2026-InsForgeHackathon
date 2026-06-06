# apps/demo — the victim storefront

Next.js toy storefront with rrweb embedded. Renders an `/orders` page that goes empty for the demo user because of the silent RLS bug in [`infra/insforge.toml`](../../infra/insforge.toml).

## What goes here

| Path | Owner | Ticket |
|---|---|---|
| `lib/hush/capture.ts` | rrweb client instrumentation + frustration-signal detection | 0012 |
| `lib/hush/insforge-client.ts` | wrapped `fetch` that injects `x-hush-session-id` on every request | 0014 |
| `app/page.tsx` | landing | — |
| `app/orders/page.tsx` | the page that goes empty (the demo bug surface) | 0016 |
| `app/login/page.tsx` | issues the demo JWT (with the `tenant_ids[]` claim shape) | 0007 |

## Dev

```bash
pnpm install
pnpm dev                  # :3000
```

## Env

Reads `NEXT_PUBLIC_INSFORGE_URL`, `NEXT_PUBLIC_INSFORGE_ANON_KEY`, and `NEXT_PUBLIC_INGEST_URL` from `.env.local`. The full matrix lives in [`docs/deployment.md` §2](../../docs/deployment.md).

## Demo bug, in one sentence

The login page mints a JWT with `tenant_ids: [...]`. The orders page queries InsForge. The RLS policy on `orders` reads `auth.jwt() ->> 'tenant'` (singular). Zero rows. The user rage-clicks. rrweb fires. Hush takes over.
