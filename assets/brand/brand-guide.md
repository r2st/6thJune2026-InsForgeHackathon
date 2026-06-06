# Hush — brand guide

For a 9-hour hackathon, not a 90-page guideline. Six pages, decided.

---

## 1. Name & punctuation

The product is **Hush.** — with the period. The period is the mark; it's not optional. In running prose you may write *Hush* without it if the punctuation gets awkward. The wordmark always includes it.

Never *the Hush*, never *Hush AI*, never *HushIO*.

---

## 2. One-line positioning

> Hush is the bug-fixer for the bugs that don't crash.

That sentence is the contract. Every piece of copy should be defensible against it.

---

## 3. Color system

Direct lift from `ideas/FINAL.html` — already in use in the pitch.

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0b0c0f` | Page background. Almost-black, slightly cool. |
| `--bg-elev` | `#131418` | Cards, raised surfaces (level 1). |
| `--bg-elev2` | `#181a20` | Raised surfaces (level 2). |
| `--ink` | `#ecedef` | Primary text. |
| `--ink-dim` | `#9097a3` | Secondary text, captions, labels. |
| `--line` | `#25272e` | Hairlines, card borders. |
| `--accent` | `#ff6b35` | **The watching dot.** Brand orange. Use sparingly. |
| `--good` | `#6ee7b7` | Confirmation, "live," InsForge-aligned mint. |
| `--cool` | `#a78bfa` | Secondary signal — confidence-tier low, info chips. |
| `--warn` | `#fde68a` | Warnings, draft state. |

### Pairing rules

- **Default surface is dark.** Light-mode is a fallback, not the canon.
- **One accent at a time.** Don't mix orange and mint in the same component. Orange = "live, attention." Mint = "confirmed, shipped."
- **Glow belongs to orange.** Mint and purple do not glow. The glow is what makes the dot look *alive*.
- **`--ink-dim` is for everything secondary.** Resist using full white for body copy on dark.

### Don't

- Don't introduce new accents. The 4-accent palette is the brand.
- Don't use pure black (`#000`) or pure white (`#fff`) for surfaces.
- Don't use red for errors. Use `--accent` (orange) — Hush uses orange where most tools use red.

---

## 4. Typography

Three families, no exceptions.

| Family | Use | Source |
|---|---|---|
| **Instrument Serif** | Headlines, hero, card titles, big stats. Italic when emphasizing. | Google Fonts |
| **JetBrains Mono** | Eyebrows, labels, timestamps, code, version tags. 11–13px, letter-spaced. | Google Fonts |
| **Inter** | Body copy, paragraphs, UI labels. 14–17px. | Google Fonts |

### Scale (from FINAL.html, ship-ready)

- Display (h1): `clamp(60px, 9vw, 120px)` · Instrument Serif · `letter-spacing: -0.03em`
- Section (h2): `clamp(36px, 5vw, 52px)` · Instrument Serif · `letter-spacing: -0.02em`
- Card title (h3): `20–22px` · Instrument Serif
- Body: `17px` · Inter · `line-height: 1.6` · `max-width: 62ch`
- Eyebrow / label: `11–12px` · JetBrains Mono · `letter-spacing: 0.14em` · `uppercase`

### Do

- Italicize emphasized phrases in body copy — *the screen, not the stack trace.*
- Use the mono eyebrow above every section title.

### Don't

- Don't use Instrument Serif for body copy. It's a display face.
- Don't use Inter for headlines.
- Don't justify text. Left-align everything.

---

## 5. Voice & tone

### How Hush sounds

- **Plain English.** "It just frustrates." not "It causes a degraded UX."
- **Specific over abstract.** "A button that does nothing when you click it." not "User interaction failures."
- **Confident, not breathless.** Hush states what it observed. It doesn't promise miracles.
- **No exclamation points.** Anywhere.
- **No emoji** in product copy. The pitch uses a few status checkmarks; that's the limit.

### How Hush does not sound

- Marketing-speak: "leverage," "AI-powered," "next-generation."
- VC-deck noise: "10x faster," "revolutionizing."
- Cute personification: "I noticed a bug for you!" Hush is a system, not a buddy.

### The signature move

Hush names what's *silent*. "Sentry sees nothing. The dev sees nothing. The user just leaves." Whenever you write product copy, find the silence and name it.

---

## 6. The mark

A single filled circle, orange, with a soft outer halo. The halo is part of the mark; don't ship it bare.

- **Color:** `--accent` (`#ff6b35`)
- **Halo:** Gaussian-style blur, ~25% opacity, ~3× the radius of the dot.
- **Minimum size:** 12×12 px. Below that, drop the halo and use the bare dot.
- **Clear space:** Reserve a square of the dot's diameter on every side. Nothing crowds the dot.
- **The wordmark's period is the same dot.** The two assets are the same shape at different roles.

### What the mark means

It's a quiet pulse. A live tracer. The thing that's listening when nothing seems to be happening. That is the whole product, compressed.

---

## 7. Don't list (the short version)

- Don't ship a new logo concept. The dot is decided.
- Don't draft a new tagline without re-reading `taglines.md` first.
- Don't break the type stack — three families, decided.
- Don't put the mark on busy imagery. Dark solid bg only.
- Don't use the brand orange for errors *or* destructive actions. It's a presence color.
- Don't write copy that sounds like a SaaS landing page. Read the FINAL deck and match that voice.
