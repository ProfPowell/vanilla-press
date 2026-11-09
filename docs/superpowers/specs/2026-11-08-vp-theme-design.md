# Vanilla Press step 4: themes

Date: 2026-11-08 · Status: draft for approval (builder check done)

Builds on step 1 (`2026-11-02-vp-app-core-design.md`), the new look
(`2026-11-07-vp-new-look-design.md`) and media
(`2026-11-03-vp-media-design.md`). The visual spec is
`docs/design/mockups/Theme.dc.html`, `docs/design/mockups/EditorTheme.dc.html`
and the Theme and "Page theme override" sections of `docs/design/README.md`.
This document doesn't repeat them. It says what this step builds, the
decisions the mockups leave open, and the Cook work underneath.

## Decided by the user

- **Both kinds of look:** pick and adjust an existing Vanilla Breeze theme,
  and make custom looks.
- **Both levels:** the whole site, and a single post with its own look
  (the mockup's example is a retro article in `8bit`).
- **Vanilla Breeze changes in this step** so that a theme set by the page
  survives VB's script (see goal 0), rather than working around it.
- **Cook gets one shared theme setting** that any Cook site can use; the
  rest of a site's look (its custom themes, its adjustments) lives in that
  site.

## Intent

Today the theme picker in VP's Theme section writes `config/vp.json`
(`{ "theme": "swiss" }` on thomasapowell.com), and nothing reads it: the
site's layouts load `vanilla-breeze.css` with no `data-theme`, so the live
site always shows the default theme. The editor shows the chosen theme, the
live site doesn't. Step 4 makes the look you choose in VP be the look of
the live site, and gives the user a real Theme screen to choose and shape
it, per site and per post.

## Background: how VB themes work (verified)

- Each theme's CSS sets tokens under `[data-theme~=<id>]` (and
  `:root[data-theme~=<id>]`) in `@layer bundle-theme`. Because the selector
  is `~=`, an element may carry several ids (`data-theme="swiss vp-site"`)
  and any element can carry one, so a theme can be scoped to an article.
- Some themes are compiled into `vanilla-breeze.css`; the rest are separate
  files in VB's `themes/` directory (`src/themes/list-themes.js` already
  tells them apart: `file` is null for built-ins).
- Light/dark: `data-mode="light"` or `data-mode="dark"` on `<html>` forces
  a scheme; without it VB follows `prefers-color-scheme`. Some themes have
  `-dark` siblings.
- Tokens adjustments can target: `--hue-primary` (and `--hue-secondary`,
  `--hue-accent`), `--font-heading`, `--font-body`, `--font-sans`,
  `--font-serif`, `--radius-*`.
- The Theme Composer (vb-design-system, `tools/theme-composer`) exports a
  `theme.css` that sets custom properties on `:root`, or a DTCG
  `theme.tokens.json`. It is built from VB components (`palette-generator`,
  `semantic-palette`, `font-pairer`, `theme-export`, `theme-import`).

## Goals

### 0. Vanilla Breeze: respect a theme the page sets

Found by the builder check and confirmed in the site's vendored
`vanilla-breeze.js`: the theme manager (`src/lib/theme-manager.js` in
`~/src/vanilla-breeze`) runs `init()` → `apply()` on load, which
- rewrites `<html data-theme>` to one brand id plus `a11y-*` ids, dropping
  any other ids (so `swiss vp-site` becomes `swiss`);
- always sets `data-mode` from the visitor's stored mode (default `auto`);
- lets a brand the visitor saved earlier beat the page's `data-theme`;
- fetches `<themes dir>/<brand>.css` itself, so a custom id 404s and a
  linked VB theme is fetched twice.

The change (VB's maintainer is the user, so it ships as a VB release):
- `apply()` keeps every id on `<html data-theme>` that it didn't put there
  (it only replaces the brand id it manages).
- A page can declare its theme as set by the site:
  `<html data-theme-source="site">` (name is my call). Then the page's brand
  wins over a stored brand, and the theme picker UI, if the page has one,
  starts from it.
- A page's `data-mode` of `light` or `dark` set in the HTML is kept: a
  stored visitor mode only wins when the page has none (Reader's choice).
- No fetch for a brand whose stylesheet the page already links: a `<link>`
  carrying `data-vb-theme="<id>"` marks it loaded.
- Existing behavior with none of these attributes is unchanged; VB's tests
  cover both.

Then: a VB release (the user publishes), thomasapowell.com picks it up
(its `vendor` script copies VB from `node_modules` on build; its
`package.json` asks for `^0.4.1`, so the range is bumped), and VP's
`vanilla-breeze` dependency is bumped. Note: `~/src/vanilla-breeze` is on
branch `work/next` with its own work in progress; the VB change goes on a
fresh branch from `origin/main`, never mixed into that work.

### 1. Cook: a built-in `theme` plugin (the shared setting)

A new built-in plugin in Cook, like `package-components`: per page, after
templates are applied, it

- sets `data-theme` on `<html>` to the site theme's ids,
  `data-theme-source="site"`, and `data-mode` when the scheme is forced;
- adds a `<link rel="stylesheet" data-vb-theme="<id>">` after the VB
  stylesheet for each theme file the page needs: a VB theme that isn't built in, a site custom theme,
  and the site's adjustments file;
- for a page whose front matter has `theme`, uses that theme instead:
  - `themeScope: page` (default): on `<html>`, replacing the site theme;
    The site's adjustments layer is dropped for that page (they were tuned
    for the site theme), and the site's color scheme setting still applies
    (my call: the scheme is a site-wide reading preference).
  - `themeScope: article`: the page keeps the site theme on `<html>`; the
    page theme's ids go on the page's first `<article>` (else `<main>`), so
    the site's header and footer keep the site look.

**Setting.** Cook reads the site theme from its config: `theme` in
`config/main.js` if present, else `config/theme.json`. VP writes
`config/theme.json` and never edits `main.js`. Shape:

```json
{
  "name": "swiss",
  "mode": "auto",
  "adjust": "vp-site",
  "files": { "8bit": "/assets/vendor/vanilla-breeze/themes/8bit.css",
             "retro-mine": "/assets/themes/retro-mine.css",
             "vp-site": "/assets/themes/vp-site.css" }
}
```

- `name`: the site theme id (VB or custom). `mode`: `auto | light | dark`.
- `adjust`: optional id of an adjustments layer added after `name` in
  `data-theme` (`data-theme="swiss vp-site"`).
- `files`: theme id → stylesheet URL, for every theme that needs a file.
  Cook links only the ones a page uses. Ids absent from `files` are assumed
  built into `vanilla-breeze.css`. Cook knows nothing about VP or about
  which VB themes exist: the map is the whole contract.
- With no setting, the plugin does nothing (existing sites unchanged).
- Front matter values that aren't safe ids (`[a-z0-9-]+`) are ignored with a
  build warning.

Docs page and tests in Cook; a minor version release (the user publishes
with their OTP). thomasapowell.com then upgrades Cook. VP keeps reading the
old `config/vp.json` once, to migrate it (goal 5).

### 2. Theme screen (`Theme.dc.html`)

Replaces today's theme picker in the Theme section.

- **Start from a theme:** cards from `GET /api/themes` plus the site's
  custom themes (marked "Custom"), each card drawn with the real theme CSS
  (`data-theme` on the card), not approximations. "All N themes" expands the
  grid. Search by name.
- **Adjust <theme>:** main color hue, color scheme (Light / Dark / Reader's
  choice), heading font, body font, corners (Theme's / Square / Round).
  These are written as the site's adjustments layer (`vp-site`), not into
  the theme. "Reset" clears them.
- **Make your own:**
  - "Save as a new theme…" turns the current theme plus adjustments into a
    custom theme with a name the user gives.
  - "Import from Theme Composer…" takes a `theme.css` the Composer exported
    (file pick or paste) and asks for a name. "Open in Theme Composer ↗"
    links there.
  - Custom themes can be renamed and deleted from their card's menu.
    Deleting one in use by the site or a post is refused, naming them.
- **Pages with their own theme:** the posts whose `meta.theme` is set, with
  their theme, linking to the editor.
- **Preview** (right column): a real post from the site (the most recent
  published, else the most recent draft, else sample text), rendered in a
  container with the chosen `data-theme`/`data-mode` and the unsaved
  adjustments applied live. Desktop / Phone width toggle.
- **Apply to site** (primary): saves `config/theme.json` and the theme files,
  then goes live like Update (sync, commit, push), with the same progress,
  "Live ↗" and error report. "Unapplied changes" shows while dirty;
  leaving the section with unapplied changes keeps them until reload
  (my call: no navigation guard dialog; the note is enough).

### 3. Custom themes in the site

- Stored as `src/assets/themes/<id>.css` in the site repo, one file per
  theme, every rule scoped to `[data-theme~=<id>]` inside
  `@layer bundle-theme`. Their names and base theme are in
  `config/theme.json` under `custom: [{ id, name, base }]`.
- A saved theme ("Save as a new theme") is written by VP from the base
  theme's computed tokens plus the adjustments, so it stands alone.
- An imported Composer file is rewritten: `:root` (and `html`) selectors
  become `[data-theme~=<id>]`, everything wrapped in
  `@layer bundle-theme`. Only custom properties are kept; any other rule is
  dropped and listed in the import result. Size limit 256 KB.
- **Light and dark** (my call: custom themes must work in both, like VB's):
  - "Save as a new theme" computes the tokens in both schemes and writes the
    dark set under `[data-theme~=<id>][data-mode=dark]` and the
    `prefers-color-scheme: dark` rule VB uses for auto.
  - An imported Composer file that has only one scheme is kept as is and
    marked "Light only" (or "Dark only") in `custom`. Cook then forces that
    scheme (`data-mode`) on the element that carries the theme, and the Theme
    screen disables the scheme control for it, with a line saying why.
- Ids are slugs of the name, unique against VB themes and other custom
  themes (`retro-mine`, `retro-mine-2`).
- **The site's own VB copy is the source of truth** (my call). The live
  site uses its vendored VB, which can differ from VP's dependency
  (thomasapowell.com has 58 theme files, VP's 0.5.0 has 44). So the theme
  list, the cards, the Theme screen preview and the editor all load the
  site's VB when the site has one, and VP's own only when it doesn't.
  - VP finds it by looking for `vanilla-breeze.css` under the site's `src/`
    (first match, shallowest path) and records the URL path as `vb` in
    `config/theme.json`. A site with no vendored VB uses VP's copy and the
    Theme screen says so.
  - Which ids are built in is read from that `vanilla-breeze.css`
    (`[data-theme~=<id>]` selectors), not from the hardcoded list in
    `list-themes.js`. Every other id gets a `files` entry pointing into the
    site's VB `themes/` directory. VP doesn't copy theme files.

### 4. A post with its own theme (`EditorTheme.dc.html`)

- Post settings → Appearance: "Site theme" / "Its own theme". Its own theme
  shows the theme grid (VB and custom) and "Apply to": "Whole page, header
  and footer too" (`page`) or "Article only, keep the site's header and
  footer" (`article`).
- "Adjust…" links to the Theme screen; a page theme isn't adjusted in place.
  To change it, the user saves a new custom theme there and picks it.
- Stored as `meta.theme` and `meta.themeScope` (`page` | `article`, default
  `page`) on the document, written to the page's front matter as `theme` and
  `themeScope` on sync. Clearing it removes both.
- The top bar shows a "Page theme: <name>" chip.
- The editor's writing area renders in the page theme; with `article` scope
  the pane shows the site header strip in the site theme, as in the mockup.
  The app's own chrome stays neutral.
- Changing a page theme is an edit like any other: the post shows "Saved ·
  not live yet" until Update.

### 5. Migration and editor

- On opening a site with `config/vp.json` holding a theme and no
  `config/theme.json`, VP writes `config/theme.json` with that theme
  (`mode: auto`, no adjustments) and removes `theme` from `vp.json`. It goes
  live with the next Apply or publish, not on its own.
- The editor reads the site theme from the same setting (theme, mode,
  adjustments) so the writing area matches the live site.

## Non-goals

- Editing a theme's every token in VP. Deep edits go through the Theme
  Composer and come back by import.
- DTCG `.tokens.json` import (the Composer's CSS export covers it).
- Web font loading. Font choices are the font stacks VB ships.
- Adjusting a page theme in place.
- A dark scheme for the app itself. Programs, Analytics, Social.

## Anti-goals

- A theme that shows in VP but not on the live site, or the reverse.
- Hex values or one-off colors in VP's CSS (the previews use real theme CSS).
- Changing a site that hasn't opted in: no `theme.json`, no change in Cook's
  output.
- A Composer import that can restyle anything outside its own theme id.
- Browser alert/confirm/prompt.

## Constraints

- Everything from earlier steps holds: no front-end framework, VB tokens,
  localhost only, stored post JSON unchanged except the two new optional
  meta fields.
- Cook stays generic: it reads a setting and a file map; no VP-specific
  code. Cook's own tests cover the plugin.
- Applying goes through the existing publish path (sync, commit, push), so
  backup status and errors behave as today.
- Browser checks at desktop and phone widths, and an axe/keyboard pass on
  the Theme screen and Appearance section, are part of done.

## My calls (to check)

- Interpreting "a shared setting, but mostly in one instance" as: Cook gets
  the generic `theme` setting and plugin; custom themes and adjustments are
  files in each site.
- `config/theme.json` as the setting VP writes, with `main.js` winning if it
  sets `theme`.
- Site adjustments as a separate `vp-site` layer, not a modified theme, so
  switching base theme keeps them.
- "Save as a new theme" as the in-VP way to make your own; the Composer for
  deep edits.
- Article scope targets the first `<article>`, else `<main>`.
- No unsaved-changes dialog on the Theme screen.

## Left to the builder

- Whether the Theme screen's controls reuse VB components
  (`palette-generator`, `font-pairer`) if VP's VB version ships them, or
  plain inputs.
- How a hue change reaches themes that write literal colors rather than
  `var(--hue-primary)`: it must visibly change the primary color in every
  theme in the preview and on the live site.
- Preview container mechanics, as long as it uses the real theme CSS.
- Wording, matching the mockups where they show text.
