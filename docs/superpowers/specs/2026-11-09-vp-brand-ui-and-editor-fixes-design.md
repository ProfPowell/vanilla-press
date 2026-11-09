# Branded UI and editor fixes

Status: approved in chat 2026-11-09 ("I would a branded UI and all those fixes"). The calls marked *(my call)* are Claude's and are listed for review.

## Why

Polish on the app and the editor matters more right now than new features. Two problems:

- The app doesn't look like Vanilla Press. The Bloom Seal brand exists (`docs/design/brand/`), but the design rule kept it to the logo and favicons. Every screen is the plain Vanilla Breeze gray-and-blue.
- The editor has friction you hit in the first minute of writing:
  - there are no inline Markdown shortcuts;
  - the block menu falls off the bottom of the screen;
  - you can't get past an image or video to keep typing.

Media clean-up comes next, after this work. It is not part of this spec.

## Goals

1. Every app screen and the editor's chrome wear the brand: ink, paper, parchment and vanilla, with the seal.
2. The writing area still shows the post the way the site will show it.
3. Inline Markdown works as you type.
4. Menus anchored to the text stay on screen, and the line you're typing on never sits jammed against the bottom edge.
5. You can always move past a media block, by keyboard or by click, and start a paragraph after it.

## Non-goals

- New screens or features.
- Media clean-up.
- A phone-width editor redesign.
- Analytics and Social.
- Changing what the writing area renders.

## Anti-goals

- The brand leaks into the writing area, so a post looks different in the editor than on the live site.
- Low-contrast text: anything under 4.5:1 for text, or under 3:1 for controls and focus rings.
- Typing that deletes a selected image or video.
- A Markdown shortcut that fires inside code, or in the middle of `snake_case` words.

## Part 1: Branded UI

### The design rule changes

`docs/design/README.md`, `docs/design/brand/README.md` and the header comment of `docs/design/brand/tokens.css` currently say that brand colors are for the mark only. Both are updated to say:

- The app's chrome is branded. That means the Sites, Site (all sections) and Theme screens, and the editor's top bar, settings panel, menus, palette and toolbars.
- The writing area is not branded.

The token table in `docs/design/README.md` is replaced with the table below.

### How it's built

- One stylesheet, `app/assets/brand-ui.css`, maps the Vanilla Breeze semantic tokens to brand values. The app pages and the editor link it right after `vanilla-breeze.css`, in its own `@layer` placed after VB's token layer.
  - Screen CSS keeps using VB tokens (`--color-primary`, `--color-surface-raised` …), so most screens rebrand without per-screen edits.
  - Per-screen edits are only for places that used literal colors, or that need a brand surface (below).
- The chrome's scheme follows `prefers-color-scheme` only. It ignores the writing area's `data-mode` (which `pane-theme.js` sets per site), so dark chrome around a light post is expected *(my call)*.
- The brand mapping must not reach the writing area: it either scopes itself away from `.editor-content` and the pane, or the pane reset sits in a later layer. Whichever is chosen, the computed-colors test below is the contract.
- `--vp-brand-*` tokens come from `docs/design/brand/tokens.css`, served at `/brand/tokens.css`. Hex values are not repeated in app CSS.

### Light scheme *(my call on the in-between values; each must pass the contrast checks)*

| Role | VB token | Value |
|---|---|---|
| Page background | `--color-background` | paper `#FFFAF0` |
| Rail, settings panel, cards' raised surface | `--color-surface-raised` | parchment `#F4EDE0` |
| Selected nav item, segmented track, hover | `--color-surface-alt` | `#EAE0CC` |
| Borders | `--color-border` | `#DCD1BD` |
| Dividers | `--color-border-subtle` | `#ECE3D2` |
| Text | `--color-text` | `#1A2133` (ink-black) |
| Secondary text | `--color-text-muted` | `#4A5164` |
| Labels and hints | `--color-text-subtle` | `#5F6577`, ≥ 4.5:1 on parchment |
| Primary buttons, links, focus | `--color-primary`, `--color-interactive` | ink `#23314F` |
| Text on primary | `--color-text-on-primary` | petal `#F7EEDB` |
| Status colors | success, warning, error | unchanged VB values, re-checked for contrast on paper |

### Dark scheme *(my call)*

The app follows the OS setting, as VB already does.

| Role | Value |
|---|---|
| Background | ink-rim `#141C30` |
| Raised surfaces | ink `#23314F` |
| Text | petal `#F7EEDB` |
| Primary | vanilla `#ECD89A`, with ink text on it |
| Borders | a lighter ink |
| The mark | vanilla seal variants |

Every pair is checked for contrast.

### Brand surfaces

- **Top bar** (Sites page, and the Site screens if they get one) and **editor top bar:**
  - ink background with the vanilla medium seal and "Vanilla Press" in petal text;
  - the editor bar keeps its controls readable on ink. The save-state pill and the buttons get on-ink variants.
  - *(My call: the editor top bar is ink. It is the strongest brand cue and stays out of the writing area.)*
- **Rail:** parchment, with the seal above the site name.
- **Screen titles** ("Sites", "Posts", "Media", "Programs", "Theme", and the site name in the rail): **Fraunces**, self-hosted.
  - The variable `woff2` (latin subset) and its OFL license go in `docs/design/brand/fonts/`, so they are served at `/brand/fonts/`. They are copied once from `@fontsource-variable/fraunces`.
  - The package is not added as a dependency *(my call)*. Fetch it once with `npm pack @fontsource-variable/fraunces` into a temp folder and copy out the latin `woff2` and the `LICENSE`/OFL text.
  - The `@font-face` rule is declared in `brand-ui.css`.
  - `font-display: swap`, with the Charter fallback from `--vp-brand-font-display`.
  - h2 and below stay Charter. Controls stay `--font-sans`.
- **Empty states** (no sites, no posts, no media, no programs) show the medium seal at 64px, faint, above their text.
- The wordmark rule is unchanged: the seal is an `<img>` of the brand SVG, and the name is live text only in the top bar.

### The writing area

In the editor, the content area (`.editor-content` and the theme pane) uses the site's own theme. Today it inherits the page tokens, so after this change it would inherit paper and ink.

The pane resets to the site theme's background, text and primary colors:
- **Site mode:** from the site's `data-theme` (`pane-theme.js` already sets it).
- **`vp serve` fixture mode:** from VB defaults.

Test: with the brand stylesheet on, the content area's computed background, text and link colors are the same as on a page rendered with the site theme and no brand stylesheet.

The Theme screen's preview frame is already a separate document and must stay unbranded.

## Part 2: Editor fixes

### 2.1 Inline Markdown on type

New input rules in `editor/assets/js/input-rules.js`, next to the block rules.

| Typed | Result |
|---|---|
| `**text**` or `__text__` | bold (`strong`) |
| `*text*` or `_text_` | italic (`em`) |
| `` `text` `` | code |
| `~~text~~` | strikethrough |
| `==text==` | highlight |
| `[text](url)` | link |

How the rules behave:

- **When a rule fires:** when the closing delimiter is typed.
  - The delimiters are removed and the mark is applied to the text between them.
  - The mark is then cleared from stored marks, so the next typed character is plain.
- **What the text may be:**
  - It must be non-empty and must not start or end with a space.
  - `_` and `__` don't fire when the opening delimiter follows a letter or digit, so `snake_case_name` stays literal.
  - `*` doesn't fire on `2 * 3 * 4` (spaces inside the delimiters).
- **Links:** the rule reuses `normalizeLinkUrl` (`format-toolbar.js:55`) as it is, including `tel:` and adding `https://` to a bare domain *(my call)*. It is moved to a pure module, so that `input-rules.js` and its Node tests don't import DOM code. When the URL is refused (for example `javascript:`), the text stays as typed.
- **Where rules don't fire:** inside `code_block`, inside text that already has the `code` mark, or in the title field.
- **Undo:** Backspace right after a rule fires undoes it and restores the typed characters. This is the existing `undoInputRule` binding.
- **Pure helper:** the match logic is a pure function `matchInlineMark(textBefore)`, returning `{ mark, from, to, text, attrs } | null`. It is unit-tested in Node with the cases above. The input rules call it.

### 2.2 Menus stay on screen

**Placement helper.** A pure function `placePopover(anchor, size, viewport, { gap = 4, margin = 8 })`, returning `{ top, left, maxHeight, side: 'below' | 'above' }`.

- It goes below the anchor when the menu fits there, and above when it fits there instead.
- When it fits neither way, it goes on the side with more room, with `maxHeight` set to the room left. The list scrolls.
- `left` is clamped inside the viewport.
- It is unit-tested.

**Which menus use it:**
- the block palette (`/` and `+`);
- the format toolbar (above the selection by default, flipping below near the top);
- the `⋯` menu and the more-menu;
- the media picker popover, if it is anchored to the text.

**Keeping position:**
- They reposition on scroll and resize while open.
- The palette keeps the selected item scrolled into view with arrow keys.

**Room to write.** The writing area gets bottom padding of about 40% of the screen height (`40vh` or `40dvh`), so the last line can scroll up off the bottom edge. ProseMirror's `scrollMargin` and `scrollThreshold` editor props (new; nothing sets them today) are set so the line being typed on stays at least about 80px above the bottom of the window.

### 2.3 Moving past media blocks

"Media block" means a block node that is an atom (`node.type.spec.atom` or a leaf: `embed`, `hr`, and components whose content kind is `none`), plus `figure` *(my call)*.

- Containers with editable content (callout, card, collapsible, tabs, steps, `code_block`, table, and components with `text`, `code`, `blocks` or `inline` content) are not media blocks. The arrow keys enter them as they do now.
- **Figure captions:**
  - ↓ onto a figure selects it.
  - From there, ↓ goes into its caption if it has one, then on to the next block.
  - ↑ works the same in reverse.
  - The caption stays editable.
  - Only the image, the placeholder and the fields are `contenteditable="false"`.

1. **A paragraph after the last block.** When the document's last block is not a paragraph (a media block or a container), an empty paragraph is kept after it, so clicking below the last block or pressing ↓ always lands somewhere you can type.
   - This is a ProseMirror plugin (`appendTransaction`).
   - **Serializing:** the editor drops one final empty paragraph when the block before it is not a paragraph. That is exactly the case the plugin creates, so saved files don't change because of it. An empty paragraph after another paragraph is kept *(my call)*.
   - **Saving:** the plugin's transaction is not added to undo history, and opening a post must not mark it unsaved. Dirty tracking compares the serialized AST, which is unchanged. A test pins this.
2. **Arrow keys:**
   - From the end of a text block, ↓ (or → at the very end) onto a media block selects the media block (`NodeSelection`, with a visible selected outline). Pressing ↓ again moves to the start of the next text block.
   - ↑ and ← work the same way in the other direction.
   - Two media blocks in a row step one at a time.
   - A gap cursor between two media blocks still works as ProseMirror's gap cursor does.
3. **Enter** with a media block selected creates an empty paragraph right after it and puts the cursor there.
4. **Typing a printable character** with a media block selected (a figure included, even one with a caption) starts a new paragraph after it, containing that character. It never replaces or deletes the media block. Backspace and Delete still delete a selected media block, as they do now.
5. **Clicking:**
   - Clicking a media block selects it.
   - Its own fields are editable only when the block is selected (for the figure: Src, Browse, Alt).
   - Typing into those fields never reaches the document as text.
6. **No text in node views.** A media block's display (the image, the "Missing file" placeholder, the video) is `contenteditable="false"`. Keystrokes can't insert text into it. Today, ↓ then typing put "typed-after" inside the figure's "Missing file" text.
7. **Pure key logic.** The key handlers are pure commands `(state, dispatch) => boolean`, exported from a new `editor/assets/js/block-nav.js`, and are unit-tested with `EditorState` in Node.

### 2.4 Figure block layout

The figure's Src / Browse / Alt fields are drawn faintly on top of the image, overlapping it. The fix *(my call)*:
- The image (or the missing-file placeholder) shows on its own.
- The fields appear in a row under the image, inside the figure's frame, only while the figure is selected or one of its fields has focus.
- The "Alt: Missing" warning stays visible when the block isn't selected, as a small badge on the frame.

The video/embed block follows the same pattern for its URL field.

## Verification

- **Unit tests:**
  - `matchInlineMark` (every row above, plus the non-firing cases);
  - `placePopover` (below, above, neither, clamping);
  - the `block-nav.js` commands (each numbered rule in 2.3);
  - the trailing-paragraph plugin and its serialization;
  - contrast: a test reads `brand-ui.css`, resolves each token pair in the tables (light and dark), and asserts the ratios.
- **Browser checks** (controller scripts, Playwright from `~/src/vanilla-breeze`):
  - the reproductions in the session scratchpad (`/private/tmp/claude-501/-Users-tpowell-src-cook/8bc5f774-dd5b-445c-a102-efcc2e179744/scratchpad/editor/repro.mjs`, run by the controller, not part of the repo), now passing: ↓ past an image and a video, typing after a media block, Enter after a media block, the palette near the bottom staying on screen;
  - screenshots of Sites, Posts, Media, Programs, Theme and the editor at 1280px and 390px, light and dark;
  - an axe pass with no new serious issues;
  - the writing area's computed colors matching the site theme.

## Left to the builder

- Exact border and hover values within the contrast rules.
- How `brand-ui.css` is layered relative to VB's layers.
- Whether the format toolbar reuses `placePopover` directly or through a small wrapper.
- How the trailing-paragraph plugin avoids fighting undo (for example, by adding its step to history).
