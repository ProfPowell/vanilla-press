# Vanilla Press brand: Bloom Seal 04

The Vanilla Press mark is a vanilla orchid pressed into a wax seal. The seal is the moment a letter is finished and sent, which is what Publish means in this app. This folder holds the finished assets and the rules for using them. Read it before adding a logo, favicon, icon, splash, empty state or social card anywhere in Vanilla Press.

- Preview everything: open `index.html` in a browser.
- Source canvas: https://claude.ai/artifact/BRqizim5tK1hHa2Wgv2jba (artboard "Bloom Seal 04 · iteration 1"; history in "Logo ideas", "Wax seal variations", "Bloom seal (03) variations"). Copies of those sheets are in `../mockups/`.

## The mark

```
 ┌ scallop: 16 semicircular bumps on a radius-66 circle (the wax)
 │  ┌ rim: radius 55, pressed ring (full drawing only)
 │  │  ┌ bloom: 5 solid petals on 72° rays, each with a pressed vein
 │  │  │  ┌ eye: gold flower centre with a wax-colored dot
 ▼  ▼  ▼  ▼
```

Geometry, in a 200 × 200 drawing space centred on (100, 100). These numbers are in `tokens.json` too:

| Part | Value |
|---|---|
| Wax edge | 16 bumps, semicircular (depth 1.0), valleys on r 66, bump radius 12.88, tips at r 77.6 |
| Rim | circle r 55, stroke 4 |
| Petals | 5 ellipses, rx 11 × ry 22, centres at r 26 from the middle, rotated 0/72/144/216/288° |
| Veins | stroke 2 down each petal's middle half, wax color at 55% opacity |
| Eye | r 9, with a r 3 wax-colored dot |
| Shine | arc `M54 78 A50 50 0 0 1 86 48`, white, stroke 5 (22% on ink, 50% on vanilla) |
| Micro drawing | disc r 94, five r 22 round petals on r 38, eye r 14 |

The exported SVGs are cropped to the mark (`viewBox="22 22 156 156"`, micro `6 6 188 188`).

## Three drawings, one per size

Don't scale one drawing to every size. Use the drawing made for the size you render at.

| Rendered size | Drawing | Files |
|---|---|---|
| 128px and up | **Full**: rim, veins, shine | `svg/seal-ink.svg`, `svg/seal-vanilla.svg` |
| 32–127px | **Medium**: no rim, no veins, no shine | `svg/seal-ink-medium.svg`, `svg/seal-vanilla-medium.svg` |
| 16–31px | **Micro**: plain disc, five round petals | `svg/seal-ink-micro.svg`, `svg/seal-vanilla-micro.svg`, `favicon.svg` |

Minimum size is 16px. Below that, don't use the mark.

## Colors

Two colorways. Use **Ink** on light backgrounds and **Vanilla** on ink or dark backgrounds. Nothing else.

| Role | Ink seal (C1) | Vanilla seal (C3) | Token |
|---|---|---|---|
| Wax | `#23314F` | `#ECD89A` | `--vp-brand-ink` / `--vp-brand-vanilla` |
| Rim | `#141C30` | `#C9AD62` | `--vp-brand-ink-rim` / `--vp-brand-vanilla-rim` |
| Petals | `#F7EEDB` | `#23314F` | `--vp-brand-petal` / `--vp-brand-ink` |
| Eye | `#F0C95A` | `#B07A4A` | `--vp-brand-eye` / `--vp-brand-eye-dark` |
| Backgrounds | paper `#FFFAF0`, parchment `#F4EDE0`, white | ink `#23314F`, dark photos | `--vp-brand-paper`, `--vp-brand-parchment` |

`seal-mono.svg` is the one-color version: the wax is `currentColor` and the bloom is cut through to whatever is behind it. Use it inline where the mark must follow text color (app chrome icons, print, stamps, embossing).

### Brand colors versus app colors
**The app's chrome is branded; the writing area is not.** The chrome (the Sites, Site and Theme screens, and the editor's top bar, settings panel, menus, palette and toolbars) wears the brand through `app/assets/brand-ui.css`, which maps the Vanilla Breeze semantic tokens (`--color-primary`, `--color-text`, `--color-border` …) to brand values in light and dark. See the token tables in `../README.md`. Screen CSS keeps using the VB tokens: don't write `--vp-brand-*` into buttons, links or focus rings directly. The writing area (the editor pane and its content) and the Theme screen's preview keep the site's own theme, so a post looks the same in the editor as on the live site. `--vp-brand-petal` (`#F7EEDB`) is the text color on ink brand surfaces.

## Type

- **Wordmark:** "Vanilla Press" in **Fraunces Bold**, tracking −0.02em. The lockup and wordmark SVGs have the text converted to outlines, so they need no font. Use the SVG files; don't retype the wordmark in HTML.
- **Brand headlines** (splash, marketing, social cards) and the app's **screen titles** use Fraunces via `--vp-brand-font-display` (the app's `--vp-title-font`). It is self-hosted: `fonts/fraunces-latin-wght-normal.woff2` (the variable latin subset, weights 100–900, copied once from `@fontsource-variable/fraunces` 5.3.0) with its license in `fonts/OFL.txt` (SIL Open Font License 1.1), served at `/brand/fonts/`. `app/assets/brand-ui.css` declares the `@font-face`. Don't load it from Google Fonts in the app.
- **App UI** otherwise stays on Vanilla Breeze fonts: `--font-sans` for controls, `--font-serif` (Charter) for writing, and h2 and below. The app's top bar pairs the medium seal with "Vanilla Press" set in Charter Bold at UI size. That is the one place the name is live text.

## Lockups

| File | Use |
|---|---|
| `svg/lockup-horizontal-ink.svg` | Default: seal + wordmark side by side, on light |
| `svg/lockup-horizontal-vanilla.svg` | Same, on ink |
| `svg/lockup-stacked-ink.svg` | Square-ish spaces: splash, README hero, about page |
| `svg/lockup-stacked-vanilla.svg` | Same, on ink |
| `svg/wordmark-ink.svg`, `svg/wordmark-vanilla.svg` | Wordmark alone, where the seal already appears nearby |

Horizontal: seal height = 96, gap = 18, wordmark 46 units, vertically centred on the seal. Stacked: seal 96, gap 14, wordmark 34 units, centred.

## Clear space and don'ts

- Keep clear space of **25% of the seal's width** on every side (`--vp-brand-clear-space`).
- Don't rotate, skew, crop or outline the seal. Don't add shadows or gradients.
- Don't recolor outside the two colorways (use `seal-mono.svg` for one color).
- Don't put the Ink seal on ink, or the Vanilla seal on paper; contrast collapses.
- Don't set the seal on busy photos or patterns.
- Don't change the wordmark's font, weight or spacing, or place the wordmark left of the seal.
- Don't use the full drawing below 128px or the medium drawing below 32px.

## Icons and favicons

| File | Size | Purpose |
|---|---|---|
| `favicon.ico` | 16, 32, 48 | Legacy favicon (16 = micro drawing, 32/48 = medium) |
| `favicon.svg` | any | Modern favicon; micro drawing, switches to the Vanilla colorway in dark mode |
| `png/favicon-16.png`, `-32`, `-48` | | Same as the ICO frames |
| `png/apple-touch-icon.png` | 180 | iOS home screen: ink seal on the `#F3E7B8` tile (iOS rounds the corners) |
| `png/icon-192.png`, `png/icon-512.png` | | PWA icons |
| `png/icon-maskable-512.png` | 512 | PWA maskable: seal inside the 80% safe zone |
| `png/icon-dark-512.png` | 512 | Vanilla seal on ink, for dark contexts and store listings |
| `png/seal-ink-256.png`, `-512`, `png/seal-vanilla-256.png`, `-512` | | Transparent PNGs where SVG isn't accepted |
| `png/og-image.png` | 1200 × 630 | Social card: vanilla horizontal lockup on ink |
| `site.webmanifest` | | Example manifest using the icons above |

Head markup (adjust the path to where the files are served):

```html
<link rel="icon" href="/brand/favicon.ico" sizes="any">
<link rel="icon" href="/brand/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/brand/png/apple-touch-icon.png">
<link rel="manifest" href="/brand/site.webmanifest">
<meta name="theme-color" content="#23314F">
```

## Using it in Vanilla Press

- **Serving:** `docs/` isn't served by the app. Copy the runtime files (favicons, `svg/`, the PNGs you need, `tokens.css`) to `app/assets/brand/` so they're served under `/app/assets/brand/`, or add a static mount in `src/app/server.js` (`STATIC_MOUNTS`). Keep this folder as the master copy.
- **App and editor `<head>`:** add the favicon links above to `app/index.html`, `app/site.html` and `editor/index.html`.
- **Top bar** (`Main.dc.html` header): the app's top bars are ink (`.on-ink` in `app/assets/brand-ui.css`), so they use `seal-vanilla-medium.svg` at 28px, then "Vanilla Press" in `--font-serif` bold and petal. On a light surface (the rail, empty states) use `seal-ink-medium.svg`, swapped for the vanilla one in dark with `<picture>` and `prefers-color-scheme`. Use `<img src="…" alt="">` with the name as adjacent text, or `alt="Vanilla Press"` if the image stands alone.
- **Inline in UI** where the mark must follow the theme: inline `seal-mono.svg` and set `color` (it uses `currentColor`).
- **Empty states and "Published" moments** may use the full seal or the stacked lockup. A green "Published" badge may use `seal-mono.svg` in the success color; that's the only sanctioned recolor.
- **Tokens:** import `tokens.css` once (it declares `@layer tokens`, matching Vanilla Breeze's layer order) where brand surfaces need the colors.
- **Accessibility:** a decorative seal next to the name gets `alt=""`. A standalone mark gets `alt="Vanilla Press"`. The SVG files carry `role="img"` and a `<title>` for when they're inlined.

## Rebuilding

The SVGs are the masters; edit them or the generator, never the PNGs. `source/build_brand.py` writes every SVG from the geometry above (`python3 source/build_brand.py <out> <fraunces-700.woff>`; needs `fontTools`; get the font from `npm pack @fontsource/fraunces`). `source/raster.js` renders the PNGs with Playwright (`node source/raster.js <brand_dir>`), and `favicon.ico` is made from the three favicon PNGs with Pillow.
