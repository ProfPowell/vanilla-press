# Vanilla Press UI design

The target design for the Vanilla Press app screens and editor: a **quiet writing tool** built on Vanilla Breeze tokens. The mockups are in `mockups/`. This file is the spec. Read it before changing anything under `app/` or `editor/`.

Source canvas (interactive, private to Thomas): https://claude.ai/artifact/BRqizim5tK1hHa2Wgv2jba

## Brand

The logo, favicons, app icons, lockups and brand colors are in `brand/` (Bloom Seal 04). Read `brand/README.md` before adding any logo, icon, favicon, splash or social card.

**The app's chrome is branded; the writing area is not.**

- The chrome is the Sites, Site (all sections) and Theme screens, and the editor's top bar, settings panel, menus, palette and toolbars. It wears ink, paper, parchment and vanilla.
- `app/assets/brand-ui.css` maps the Vanilla Breeze semantic tokens to brand values (the tables below), in its own `@layer` after VB's. The app pages and the editor link `/brand/tokens.css` and it right after `vanilla-breeze.css`. Screen CSS keeps using the VB tokens, never `--vp-brand-*` hex values.
- The writing area (`.editor-pane`, `.editor-content`) shows the post as the site will: the pane always carries `data-theme` (empty when the site has no theme), so VB re-declares the site theme's tokens there. The Theme screen's preview frame is its own document and never links `brand-ui.css`.
- The scheme follows `prefers-color-scheme` only, so dark chrome around a light post is expected.
- Screen titles use Fraunces (`--vp-title-font`), self-hosted from `brand/fonts/`. The Sites top bar uses the medium seal next to the "Vanilla Press" name.

Both servers (the app and `vp serve`) serve `brand/` itself at `/brand/`, so this folder stays the only copy. The app pages and the editor link the favicons, the Apple touch icon and `site.webmanifest` from there.

## How to read the mockups

`mockups/*.dc.html` are Design Component files from the canvas. They are **visual specs, not code to copy**:

- Styles are inline with literal hex values. When implementing, use the Vanilla Breeze custom properties in the token table below, put the rules in the app's CSS (`app/assets/app.css`, `editor/assets/css/*.css`) under its existing `@layer` setup, and keep markup semantic.
- `{{name}}` holes, `<sc-for>`, `<sc-if>` and the `class Component extends DCLogic` script are the mockup runtime's templating. They show which parts are data-driven and which interactions exist. They are not a pattern to reproduce: the real app renders from its own JS (`app/assets/js/*.js`, editor web components).
- `<script src="./support.js">` is the canvas runtime and is not in this repo. The files won't render standalone.
- `canvas.json` is the canvas layout (artboard sizes and order). Ignore it for implementation.
- Links between mockups (`href="Site.dc.html"`) show navigation: Sites → Site → Editor, rail → Media and Theme, Editor → page theme.

All of these screens are built. The table says where each lives now.

| Mockup | Screen | Built as |
|---|---|---|
| `Main.dc.html` | Sites list | `app/index.html`, `app/assets/js/sites-page.js` (step 3a) |
| `Site.dc.html` | Site, Posts section | `app/site.html`, `app/assets/js/site-page.js`, `posts-view.js` (step 3a) |
| `Media.dc.html` | Site, Media section | Media section of `app/site.html`, `app/assets/js/media-page.js`, `media-detail.js` (step 3b) |
| (none) | Site, Programs section | No mockup; follows Media. Programs section of `app/site.html`, `app/assets/js/programs-page.js`, `programs-detail.js`, `programs-add.js`, rules in `src/programs/programs-view.js` |
| `Theme.dc.html` | Site, Theme section | Theme section of `app/site.html`, `app/assets/js/theme-*.js` (step 4). The editor's old `theme-picker.js` remains only in `vp serve`'s fixture tools |
| `Editor.dc.html` | Editor in site mode | `editor/index.html`, `site-mode.js`, `format-toolbar.js`, `block-handles.js`, `meta-panel.js` (step 3a) |
| `EditorTheme.dc.html` | Editor, post with its own theme | Appearance section of Post settings: `components/appearance-section.js`, `pane-theme.js` (step 4) |
| `Logos.dc.html`, `Seals.dc.html`, `BloomSeal.dc.html`, `BloomSeal04.dc.html` | Logo exploration history | final assets in `brand/` |

## Direction

- The content dominates; the app's buttons, toolbars and panels recede. One primary action per screen (Add site, New post, Upload, Apply to site, Update/Publish).
- Type roles: the app's own controls use `--font-sans` (system UI); screen titles use Fraunces (`--vp-title-font`, falling back to Charter); the user's writing and h2 and below use `--font-serif` (Charter).
- Brand neutrals (paper, parchment, ink-black text) plus one main color: ink in light, vanilla in dark (`--color-primary`). Status colors only for status. The writing area keeps the site theme's colors.
- Hairline borders, 8–12px radii, no shadows except menus and the floating format toolbar.
- Every page layout is fluid and works at phone width: rail + content is a wrapping flex row, so the rail stacks above the content on narrow screens.
- Touch targets ≥ 44px for primary controls (`--size-touch-min`), ≥ 40px elsewhere. Text contrast ≥ 4.5:1.

## Tokens

Use the custom property, not the hex. `app/assets/brand-ui.css` sets these for the chrome; `test/app/brand-ui.test.js` checks every text pair at 4.5:1 or more and the focus ring at 3:1 or more, in both schemes. The writing area keeps the site theme's values.

### Light scheme

| Use | VB token | Value |
|---|---|---|
| Page background | `--color-background` | paper `#FFFAF0` |
| Rail, settings panel, cards' raised surface | `--color-surface-raised` | parchment `#F4EDE0` |
| Selected nav item, segmented track, hover | `--color-surface-alt` | `#EAE0CC` |
| Borders | `--color-border` | `#DCD1BD` |
| Dividers | `--color-border-subtle` | `#ECE3D2` |
| Text | `--color-text` | ink-black `#1A2133` |
| Secondary text | `--color-text-muted` | `#4A5164` |
| Labels and hints | `--color-text-subtle` | `#5F6577` (4.99:1 on parchment) |
| Primary buttons, links, focus | `--color-primary`, `--color-interactive` | ink `#23314F` |
| Text on primary | `--color-text-on-primary` | petal `#F7EEDB` |

### Dark scheme

| Use | VB token | Value |
|---|---|---|
| Page background | `--color-background` | ink-rim `#141C30` |
| Raised surfaces | `--color-surface-raised` | ink `#23314F` |
| Selected nav item, segmented track, hover | `--color-surface-alt` | `#2E3D5E` |
| Borders | `--color-border` | `#46577D` (a lighter ink) |
| Dividers | `--color-border-subtle` | `#2C3A5A` |
| Text | `--color-text` | petal `#F7EEDB` |
| Secondary text | `--color-text-muted` | `#CFC8B8` (7.76:1 on ink) |
| Labels and hints | `--color-text-subtle` | `#B4B0A6` (5.97:1 on ink) |
| Primary buttons, links, focus | `--color-primary`, `--color-interactive` | vanilla `#ECD89A` |
| Text on primary | `--color-text-on-primary` | ink `#23314F` |

### Unchanged Vanilla Breeze tokens

| Use | VB token | Mockup value |
|---|---|---|
| "In sync", "Published" | `--color-success`, `--color-success-text` | `#2f8a3e`, `#1d6b2a` |
| "Not live yet", "No alt text" | `--color-warning-subtle`, `--color-warning-text` | `#fbf3e2`, `#6b4a00` |
| Unpublish, Delete | `--color-error-text` | `#9b1c1c` |
| App controls font | `--font-sans` | system-ui |
| Screen titles | `--vp-title-font` | Fraunces, falling back to Charter |
| Content, h2 and below | `--font-serif` / `--font-display` | Charter |
| Paths, slugs, code | `--font-mono` | ui-monospace |
| Radii | `--radius-m` (8px) controls, `--radius-l` / `--radius-xl` cards | 8 / 10–12px |
| Content measure | `--measure-normal` | ~680px column |

## Screens

### Sites (`Main.dc.html`)
- Thin top bar: "Vanilla Press" wordmark (serif) and the local address.
- Title "Sites" with one line of explanation. Actions: "Clone from GitHub" (secondary), "Add site" (primary). The existing add/clone panels and folder browser stay; restyle them to match.
- Each site is a card: name (serif, links to the site), path (mono), published/draft counts, Git status dot + "GitHub · main · in sync", last backup time; actions "View live ↗" and "Open".

### Site shell (rail shared by Posts, Media, Programs, Theme)
- Left rail on `--color-surface-raised`: "← All sites", site name, "View live site ↗", nav (Posts, Media, Programs, Components, Theme as links/buttons with `aria-current="page"`), a "Coming later" group with Analytics and Social shown disabled, and the sync/backup status pinned to the bottom (`role="status"`, fed by the existing `GET /status` and backup state).

### Posts (`Site.dc.html`)
- Header: "Posts", "Preview site" (secondary), "New post" (primary).
- Filter group All / Published / Drafts with counts (`aria-pressed`), plus a search box.
- Row: title (serif), description (one line, ellipsis; "No description" in italic when empty, to flag missing metadata), path (mono), status with dot, date. Whole row links to the editor.
- Empty state: "No drafts. Start a new post."

### Media (`Media.dc.html`)
- Header: "Media", "N files in src/media · M missing alt text", "Upload" (primary).
- Filters: All / Needs alt text / Unused / Missing file (a library entry whose file is gone from `src/media`); a type select (All types, Images, Audio, Video, PDF); search by name or alt.
- Grid of tiles (thumbnail, filename, "No alt text" badge). Selecting a tile fills the detail panel.
- Detail panel: preview, name, type · size · date, **Alt text** textarea (warning border and hint when empty) with a "Decorative (alt="")" checkbox, URL with Copy, "Used in" (posts whose AST references the file), **Edit image** (images only; saves a copy), "Delete…" (blocked while used). No "Replace file" (decided 2026-11-07: an image never changes under a published post).
- Drop zone: drop or paste; files go to `src/media` and back up with the next save.

### Theme (`Theme.dc.html`)
- Header: "Theme", "The look of every page on the site. A post can override it in Post settings." Actions: "Open in Theme Composer ↗" (links to the VB design system's Theme Composer), "Apply to site" (primary). "Unapplied changes" note when dirty.
- Left column:
  - **Start from a theme**: 2-column grid of theme cards (swatch with "Aa" in the theme's heading font and a bar in its primary color; name; tier). Fed by `GET /api/themes` (`src/themes/list-themes.js`); link "All N themes" to the library.
  - **Adjust <theme>**: main color hue slider, color scheme (Light / Dark / Reader's choice), heading and body font, corners (Theme's / Square / Round). These write token overrides on top of the chosen theme. Deeper edits go through the Theme Composer and come back as an imported `theme.css`.
  - **Pages with their own theme**: list of posts that override the site theme, linking to them.
- Right column: live **preview** of a real post rendered with the chosen theme and adjustments, Desktop / Phone width toggle. Implement by setting `data-theme` (and override custom properties) on the preview container, as `theme-picker.js` already does for the editor pane.
- "Apply to site" saves `config/theme.json` (theme, mode, adjustments in `src/assets/themes/vp-site.css`) and goes live like Update: build, commit, push.

### Editor (`Editor.dc.html`)
- Top bar: "← Posts", site name, save-state pill ("Saved · not live yet" in warning colors; plain for drafts), then Preview, Post settings toggle (icon button, `aria-pressed`), "⋯" menu, and the primary action (Publish for drafts, Update for published posts).
- The "⋯" menu holds Export JSON, Show block tree (AST), View live page, and **Unpublish…** (danger, moved out of the top bar so it never sits next to Update).
- Writing area: centered ~680px Charter column, 20px/1.65. Meta line ("Published Nov 3, 2026 · posts"), then the **title as an editable H1 in the document** (moves out of the sidebar).
- The fixed formatting toolbar is removed. Formatting comes from a floating toolbar over the selection (Bold, Italic, Code, Highlight, Link, More), the `+` and drag handles in the gutter of the hovered block, and "Type / for blocks" on an empty line (the block palette).
- Blockquotes render headings at normal heading sizes inside the quote (the current editor renders them as oversized italics).
- Post settings panel (toggleable, right side):
  - Publishing status box: "Published Nov 3, 2026" plus the not-live explanation. Status is **not** an editable dropdown, because in the app only Publish/Update/Unpublish change it (`statusByActions`).
  - URL: slug input with a `/posts/` prefix shown.
  - Description textarea with hint "Used in feeds, search results and link previews."
  - Tags, Collection.
  - **Appearance**: "Page theme: site theme (Default). Give this page its own theme".

### Page theme override (`EditorTheme.dc.html`)
Goal: a site has one theme, and any single post can have a full one-off look (e.g. a retro article in `8bit`).

- Appearance section: radio "Site theme" / "Its own theme". With its own theme: a grid of theme cards, a link to adjust it, and "Apply to": "Whole page, header and footer too" or "Article only, keep the site's header and footer".
- Top bar shows a "Page theme: 8bit" chip.
- Only the writing area takes the page theme; the app's toolbar, sidebar and buttons stay neutral. The mockup shows the site header strip in the pane so the "Apply to" choice is visible.
- Storage: document metadata `theme: "8bit"` and `themeScope: "page"` or `"article"` (stored in the `theme` and `theme_scope` columns), written to the page's front matter on sync.
- Rendering: Cook's built-in theme plugin (Cook 2.6+, `docs-site/src/docs/theme.md` in Cook) reads front matter `theme` and `themeScope`. Page scope sets `data-theme` on `<html>`. Article scope sets it on the first `<article>`, else `<main>`, else falls back to page scope with a warning. The plugin links the theme's stylesheet when it isn't built into `vanilla-breeze.css`. The site theme comes from `config/theme.json`, and its `data-theme` always starts with the theme name (`default vp-site`), because VB reads the first token as the brand.
- Rulings and known limits: `docs/superpowers/followups/2026-11-08-vp-theme.md`.

## Placeholders in the mockups

These are not real data; don't hard-code them:

- Post descriptions are truncated where the source screenshot was cut off; "Another Post" path `/posts/another-post` is a guess.
- Media filenames are the repo's fixture files (`media/`), not the live site's; the alt text on some files is invented to show both states. `[size]`, `[date]`, `[Image preview]` and `[posts that reference this file]` are placeholders.
- Theme card colors and fonts are approximations from each theme's `.tokens.json`; render the real theme CSS instead.
- The retro post in `EditorTheme.dc.html` is sample text with a `[Your retro post title]` title.
- The editor shows a text selection and the gutter handles at the same time only to show both.

## Not designed yet

Phone-width editor, add/clone site panels, publish/update progress and error report, conflict ("Load the version on disk") state, Analytics / Social. Programs has no mockup: it follows the Media screen.
