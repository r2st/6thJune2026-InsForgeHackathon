# Hush — pitch deck

[`index.html`](index.html) is the deck. Open it in any browser. No build step.

Live presentation and demo links:

| Surface | URL | Description |
|---|---|---|
| Pitch deck | https://w369egnp.insforge.site/pitch.html | The deployed presentation. Arrow keys / click to advance, `F` for fullscreen. |
| Receipt demo | https://w369egnp.insforge.site/r/demo?demo=1 | The full catch-and-fix arc: capture → correlate → diagnose → fork-test → PR. |
| Victim app | https://hush-acme-store.vercel.app/orders?user=migrated | Acme Store with the silent bug: migrated user sees 0 orders. |
| Fix PR | https://github.com/r2st/hush-victim-acme/pull/1 | The reviewable `insforge.toml` policy diff that fixes the demo bug. |

## Present

```bash
# from repo root, point a browser at it
open demo/slides/index.html

# or serve locally if you want clean URLs
python3 -m http.server 8080 -d demo/slides
# → http://localhost:8080/
```

Press **F** to fullscreen as soon as it loads. The deck is built at 1920×1080 and scales to whatever projector you're on.

## Navigation

| Key | Action |
|---|---|
| `→` · `space` · `PageDown` · click | Next slide |
| `←` · `PageUp` | Previous slide |
| `1`–`9` · `0` | Jump to slides 1–9; `0` jumps to slide 11 |
| `Home` · `End` | First / last slide |
| `F` | Toggle fullscreen |

Touch: swipe left/right on tablets. URL hash deep-links: `#5` opens slide 5.

## Slide map (matches [`../pitch-script.md`](../pitch-script.md))

| # | Title | Beat |
|---|---|---|
| 01 | Hero — *Hush.* | open |
| 02 | Customer's empty orders page | problem story |
| 03 | The 70% gap | stat |
| 04 | What Hush does | how it catches bugs |
| 05 | Receipt page lights up | demo beat 1 — rage click + request log |
| 06 | Same session, two backends | demo beat 2 — RLS row drop + fork proof |
| 07 | Four-line TOML diff, shipped | demo beat 3 — PR |
| 08 | Confidence tiers | defense |
| 09 | Why InsForge | substrate vs engine |
| 10 | Why these tools | sponsor/tool loop |
| 11 | Close | tagline + live demo links |

The two slides that **must** land: **06** (the prod/branch split — proof) and **07** (the PR — money shot). Everything else supports those.

## Demo-day checklist (T-15 min)

- [ ] Laptop on charger, not battery
- [ ] DND on; Slack, iMessage, email all quit
- [ ] One browser, one tab: `demo/slides/index.html#1`
- [ ] Press **F** once, confirm fullscreen renders on the projector
- [ ] Second tab queued with the demo recording in case live breaks
- [ ] Test from the back row — text on slides 5–7 legible?
- [ ] Three rehearsals with a timer. Each under 3:00.

## Fallback

If the deck won't open on the venue laptop:

1. The deck is a **single HTML file** with no external dependencies except Google Fonts.
2. Fonts fail open — system fonts render fine.
3. Worst case: print to PDF in advance (`Cmd-P` → Save as PDF). `@media print` is wired up; one slide per page.

## Editing

The deck is one self-contained file. Edit `index.html` directly — no toolchain. CSS at the top, content in `<section class="slide">` blocks, JS at the bottom for nav.

Brand tokens (colors, fonts) match [`../../assets/brand/brand-guide.md`](../../assets/brand/brand-guide.md). Don't drift.
