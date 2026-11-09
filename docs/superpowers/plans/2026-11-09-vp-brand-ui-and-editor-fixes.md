# Branded UI and Editor Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app's chrome wears the Bloom Seal brand, light and dark, without touching the writing area. The editor gains inline Markdown, menus that stay on screen, room to write at the bottom, and keyboard and click paths past media blocks.

**Architecture:**
- Editor behavior lives in pure modules that import only `prosemirror-state` and `prosemirror-model`, so they are unit-tested in Node: `inline-marks.js`, `link-url.js`, `popover-place.js`, `block-nav.js`. The browser files wire them in.
- The brand is one stylesheet, `app/assets/brand-ui.css`, that maps Vanilla Breeze semantic tokens to `--vp-brand-*`. A few screen-level edits add the brand surfaces.

**Tech Stack:**
- Vanilla JS ES modules.
- ProseMirror. In the browser it comes from an esm.sh import map. In Node only `prosemirror-state`, `-model`, `-transform`, `-commands`, `-keymap` and `-history` are installed. `prosemirror-view`, `-inputrules` and `-gapcursor` are not, so pure modules must not import them.
- `node --test`.
- Playwright for browser checks: `/Users/tpowell/src/vanilla-breeze/node_modules/playwright/index.mjs`, run with `perl -e 'alarm 120; exec @ARGV' node script.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-09-vp-brand-ui-and-editor-fixes-design.md`

## Global Constraints

- Branch `feat/brand-editor`, from `main`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never stage `CLAUDE.md`, which holds the user's uncommitted edit.
- Never touch `~/src/vanilla-breeze`, except to import Playwright from it. Never touch `~/src/thomasapowell.com`.
- No `alert`, `confirm` or `prompt`.
- Browser checks use time-limited Node Playwright scripts, never MCP browser tools. Run them against a temp site from `test/app/git-site-fixture.js` (`makeGitSite`) and `startApp({ port: 0, env: { ...process.env, VP_CONFIG_DIR: <temp>, VP_NO_OPEN: '1' } })`, never against a real site.
- **Contrast:** text at least 4.5:1, controls and focus rings at least 3:1, in light and dark.
- **Brand values:**
  - They come from `docs/design/brand/tokens.css` (served at `/brand/tokens.css`).
  - The in-between light values are fixed: surface-alt `#EAE0CC`, border `#DCD1BD`, border-subtle `#ECE3D2`, text `#1A2133`, muted `#4A5164`, subtle `#5F6577`.
  - Dark: background ink-rim `#141C30`, raised ink `#23314F`, text petal `#F7EEDB`, primary vanilla `#ECD89A` with ink text on it.
- The chrome's scheme follows `prefers-color-scheme` only.
- The writing area (`.editor-content`, the theme pane) and the Theme screen's preview frame are never branded.
- The full suite stays green: `npm test` currently runs 1455 tests, 1 of them skipped.

## Review Focus

1. **Paste.** Pasting text that contains `**x**` or `[a](b)` stays literal, because input rules only fire on typing. *Test in Task 1.*
2. **Undo after the trailing paragraph.** Undo after inserting an image, then redo, never loops or stacks extra empty paragraphs. Deleting the final image leaves exactly one trailing paragraph at most. *Test in Task 3.*
3. **Opening a saved post that ends in an image** shows "Saved", not "Unsaved". *Test in Task 3, browser check in Task 3.*
4. **A short window** (390×500): the `/` palette and the format toolbar stay fully on screen, and the palette list scrolls. *Unit test and browser check in Task 2.*
5. **OS dark with a light site:** the editor's top-bar controls, the save pill and the Publish button are readable on ink, and the writing area is still light. *Browser check in Task 5.*

---

### Task 1: Inline Markdown on type

**Files:**
- Create: `editor/assets/js/inline-marks.js`, `editor/assets/js/link-url.js`
- Modify:
  - `editor/assets/js/format-toolbar.js`: move `normalizeLinkUrl` out to `link-url.js` and import it back. Keep re-exporting it from `format-toolbar.js` so existing tests still pass.
  - `editor/assets/js/input-rules.js`: add the mark rules.
- Test: `test/editor/inline-marks.test.js`

**Interfaces:**
- Produces:
  - `normalizeLinkUrl(text: string): string|null`, moved unchanged from `link-url.js`.
  - `matchInlineMark(textBefore: string): { mark: 'strong'|'em'|'code'|'strikethrough'|'highlight'|'link', start: number, text: string, attrs?: { href: string } } | null`.
    - `textBefore` is the text block's text up to the cursor, including the character just typed.
    - `start` is the offset in `textBefore` where the opening delimiter begins. The match always ends at `textBefore.length`.
  - `applyInlineMark(state, match, from, to): Transaction`, where `from`/`to` are document positions of the matched range. It removes the delimiters, adds the mark to the inner text, and clears that stored mark.
- Consumes: the mark names in `schema.js`. Check `schema.marks` for the exact keys of bold, italic, code, strike, highlight and link, and map the names above to them.

- [ ] **Step 1: Write the failing tests** in `test/editor/inline-marks.test.js`.

  `matchInlineMark` table:

  | Input | Result |
  |---|---|
  | `'a **bold**'` | `{mark:'strong', start:2, text:'bold'}` |
  | `'__bold__'` | strong |
  | `'x *it*'` | em, text `'it'` |
  | `'_it_'` | em |
  | `` '`c`' `` | code |
  | `'~~s~~'` | strikethrough |
  | `'==h=='` | highlight |
  | `'see [VP](https://vp.dev)'` | link with `attrs.href === 'https://vp.dev'` and `text === 'VP'` |
  | `'[x](example.com)'` | href `'https://example.com'` |
  | `'[x](javascript:alert(1))'` | null |
  | `'snake_case_'` | null |
  | `'a_b_'` | null |
  | `'2 * 3 *'` | null |
  | `'** x**'` | null |
  | `'****'` | null |
  | `'**bold*'` | null (an unfinished bold doesn't fire as italic) |
  | `'***'` | null |

  `applyInlineMark` on an `EditorState` (doc from `fromBlockAst([para('a **bold**')], schema, { title: 'T' })`):
  - The paragraph text becomes `'a bold'`, and `bold` carries the strong mark.
  - `tr.storedMarks` doesn't contain strong.

  The existing format-toolbar tests still import `normalizeLinkUrl` from `format-toolbar.js`.

- [ ] **Step 2: Run** `node --test test/editor/inline-marks.test.js`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `link-url.js` (the move) and `inline-marks.js`. Then, in `input-rules.js`, add one `InputRule` per closing delimiter. Each rule:
  - builds `textBefore` from `$from.parent.textBetween(0, $from.parentOffset) + typedChar`;
  - calls `matchInlineMark`;
  - returns `null` when there's no match, when the parent is a `code_block` or the title node, or when the range already carries `code`;
  - otherwise returns `applyInlineMark(...)`.

  The existing `undoInputRule` (keymap.js) gives Backspace-to-undo.

- [ ] **Step 4: Run** `node --test test/editor/` then `npm test`. Expected: all pass.

- [ ] **Step 5: Browser check.** A scratch script types each table input into a new paragraph:
  - the resulting HTML has `<strong>`, `<em>`, `<code>`, `<s>`/`<del>`, `<mark>` and `<a href>`;
  - Backspace right after `**bold**` restores the literal text;
  - pasting `**x**` (via `page.evaluate` with a `ClipboardEvent` or `insertText`) stays literal.

- [ ] **Step 6: Commit** with `feat(editor): inline Markdown as you type`.

### Task 2: Menus stay on screen, room to write

**Files:**
- Create: `editor/assets/js/popover-place.js`
- Modify:
  - `editor/assets/js/components/block-palette.js` (`position()` around line 289, plus keyboard scroll-into-view);
  - `editor/assets/js/format-toolbar.js` (`toolbarPosition` delegates to `placePopover` with `prefer: 'above'`, keeping its return shape);
  - `editor/assets/js/components/more-menu.js`, and `menu.js` if it positions itself;
  - `editor/assets/js/editor.js` (`scrollMargin`/`scrollThreshold` props);
  - `editor/assets/css/_prosemirror.css` (or `_shell.css`) for the bottom padding;
  - `editor/assets/css/_palette.css` (`overflow-y: auto` when `max-height` is set).
- Test: `test/editor/popover-place.test.js`

**Interfaces:**
- Produces: `placePopover(anchor: {top,bottom,left,right}, size: {width,height}, viewport: {width,height}, opts?: { gap?: number = 4, margin?: number = 8, prefer?: 'below'|'above' = 'below' }): { top: number, left: number, maxHeight: number|null, side: 'below'|'above' }`.
  - It goes on the preferred side when it fits, else the other side when that fits.
  - When neither fits, it goes on the side with more room, and `maxHeight = room - gap - margin`.
  - `left` is clamped to `[margin, viewport.width - size.width - margin]`.
  - `maxHeight` is null when the menu fits.

- [ ] **Step 1: Write the failing tests:**
  - Fits below: anchor `{top:100,bottom:120,left:50,right:60}`, size `{width:300,height:200}`, viewport `{width:1280,height:800}` → `side:'below'`, `top:124`, `maxHeight:null`.
  - Flips above: anchor bottom 790 (top 770), height 360 → `side:'above'`, `top === 770-4-360`.
  - Neither fits: viewport `{width:390,height:500}`, anchor `{top:260,bottom:280,left:20,right:30}`, size `{width:300,height:400}` → `side:'above'` (260 of room above, 220 below), `maxHeight:248` (260-4-8), `top:8`.
  - Neither fits, more room below: anchor `{top:200,bottom:220}`, same sizes → `side:'below'`, `top:224`, `maxHeight:268` (500-220-4-8).
  - Clamping: anchor left 1200, width 300 → `left === 1280-300-8`.
  - `prefer:'above'` with no room above → below.
  - Existing `toolbarPosition` tests stay green.
- [ ] **Step 2: Run** `node --test test/editor/popover-place.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `placePopover`, then wire it in:
  - **Palette:**
    - measure the element after render;
    - apply `top`, `left` and `max-height`;
    - re-place on `scroll` (capture) and `resize` while open, and remove the listeners on close;
    - `scrollIntoView({ block: 'nearest' })` on the selected item when the arrows move.
  - **Toolbars and menus:** the format toolbar and the more-menu use it too.
  - **Room to write:**
    - the writing area gets `padding-block-end: 40dvh` (with a `40vh` fallback);
    - `EditorView` props get `scrollMargin: { top: 80, bottom: 120, left: 0, right: 0 }` and `scrollThreshold: { top: 80, bottom: 120, left: 0, right: 0 }`.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Browser check** in 1280×800 and 390×500 windows:
  - type 25 Enters then `/`. The palette's bounding box lies within the viewport (`top >= 0`, `bottom <= innerHeight`) and its list scrolls (`scrollHeight > clientHeight` in the small window);
  - select a word on the last line. The toolbar is in the viewport;
  - after typing on the last line, the caret's `bottom <= innerHeight - 80`.
- [ ] **Step 6: Commit** with `fix(editor): menus stay on screen; room to write at the bottom`.

### Task 3: Moving past media blocks

**Files:**
- Create: `editor/assets/js/block-nav.js`
- Modify:
  - `editor/assets/js/keymap.js`: bind the commands ahead of the defaults for `ArrowDown`, `ArrowUp`, `ArrowRight`, `ArrowLeft` and `Enter`;
  - `editor/assets/js/editor.js`: add the plugin; add a `handleTextInput` prop or plugin that calls `typeAfterMedia`; and, in `dispatchTransaction`, don't set `'unsaved'` for a transaction whose only change is the trailing-paragraph append (`tr.getMeta('vp-trailing')`);
  - `editor/assets/js/ast.js` (`toBlockAst`): drop the final empty paragraph when the block before it is not a paragraph.
- Test: `test/editor/block-nav.test.js`

**Interfaces:**
- Produces, from `block-nav.js` (imports only `prosemirror-state` and `prosemirror-model`):
  - `isMediaBlock(node: Node): boolean`. True for `figure`, and for any block node whose spec has `atom: true` or that is a leaf (`embed`, `hr`, `component_leaf`). False for text blocks and containers (callout, card, collapsible, tabs, steps, code_block, table, `component_blocks`).
  - `trailingParagraphPlugin(): Plugin`. Its `appendTransaction` adds an empty paragraph when the doc's last child is not a paragraph. It sets `tr.setMeta('vp-trailing', true)` and `tr.setMeta('addToHistory', false)`.
  - The commands `navDown`, `navUp`, `navRight`, `navLeft`, `enterAfterMedia`, each `(state, dispatch?) => boolean`.
  - `typeAfterMedia(state, text: string): Transaction|null`. With a `NodeSelection` on a media block, it inserts a paragraph containing `text` after the block and puts the cursor after the text. Otherwise it returns null.
- Consumes: `schema` and `fromBlockAst`/`toBlockAst` (the doc's first child is the title node).

- [ ] **Step 1: Write the failing tests.** Docs are built with `fromBlockAst`, `figure` = `{type:'figure', attrs:{src:'/media/x.png', alt:'x'}, children:[]}`, `embed` = `{type:'embed', attrs:{url:'/media/x.mp4', type:'video'}}`.

  Media blocks:
  - `isMediaBlock` is true for figure, embed and hr, and false for paragraph, callout and code_block.

  Arrow keys:
  - `navDown`, with the cursor at the end of `p('First')` and an embed next: selection becomes a `NodeSelection` on the embed.
  - `navDown` again: cursor at the start of the next text block (the trailing paragraph, once the plugin ran).
  - Figure with a caption: `navDown` from the figure's `NodeSelection` puts the cursor in the caption, and again moves to the next block.
  - `navUp` mirrors both.
  - Two embeds in a row: each `navDown` steps one block.
  - Cursor in the middle of a paragraph: `navDown` returns false, so the default behavior applies.

  Enter and typing:
  - `enterAfterMedia` on a selected embed: a new empty paragraph right after it, with the cursor inside.
  - `typeAfterMedia(state, 'h')` on a selected figure: the figure is still there, and the next block is `p('h')` with the cursor after `h`.
  - `typeAfterMedia` with a `TextSelection`: null.

  Trailing paragraph and saving:
  - The plugin on a doc ending with an embed: the last child is an empty paragraph. Applying it again adds nothing.
  - The plugin's transaction has `addToHistory === false`.
  - After deleting the embed, the doc does not end with two empty paragraphs.
  - `toBlockAst` of `[p('a'), embed, p('')]` → `[p('a'), embed]`.
  - `toBlockAst` of `[p('a'), p('')]` keeps both.
  - Undo (`prosemirror-history`) after inserting an embed, then redo: there is only one trailing paragraph.

- [ ] **Step 2: Run** `node --test test/editor/block-nav.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `block-nav.js`, and wire it into `keymap.js` and `editor.js`. `typeAfterMedia` runs from `handleTextInput(view, from, to, text)` when `view.state.selection` is a media `NodeSelection`.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Browser check.** Rerun the reproduction `/private/tmp/claude-501/-Users-tpowell-src-cook/8bc5f774-dd5b-445c-a102-efcc2e179744/scratchpad/editor/repro.mjs`, adapted. For an image post and a video post:
  - ↓↓ then typing creates a paragraph after the media;
  - clicking below the last block, then typing, creates a paragraph;
  - selecting the media then Enter then typing creates a paragraph;
  - selecting the media then typing creates a paragraph, and the media survives;
  - the save pill reads "Saved" right after load.
- [ ] **Step 6: Commit** with `fix(editor): keyboard and click paths past media blocks`.

### Task 4: Figure and embed blocks: fields under the image, display not editable

**Files:**
- Modify: `editor/assets/js/blocks/figure-view.js`, `editor/assets/js/blocks/embed-view.js`, `editor/assets/css/_block-controls.css` (or wherever `.figure`/embed node-view styles live)
- Test: `test/editor/figure-view.test.js` (new). Use the DOM-free parts. If the views need a DOM, assert the class and attribute contract with a minimal fake, as `steps-view.test.js` does.

**Interfaces:**
- Consumes: `isMediaBlock` and the `NodeSelection` behavior from Task 3. `selectNode()`/`deselectNode()` on the node views toggle the `data-selected` attribute.
- Produces, as the DOM contract:
  - The image (or the missing-file placeholder) and the fields row are `contenteditable="false"`. Only the caption wrapper is editable.
  - The fields row is a sibling under the image and is hidden unless the figure has `data-selected` or `:focus-within`.
  - A `.figure-alt-missing` badge is visible when alt is empty and the block isn't selected.
  - The embed's URL field follows the same pattern.

- [ ] **Step 1: Write the failing tests:**
  - The view's `dom` has a fields row with `contenteditable="false"`.
  - The display wrapper has `contenteditable="false"`.
  - `selectNode()` sets `data-selected`, and `deselectNode()` removes it.
  - With `alt: ''` the badge is present, and with alt set it's absent.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** CSS:
  - the fields row is `display: none` unless `[data-selected]` or `:focus-within`;
  - it is laid out in normal flow under the image (no absolute positioning over it);
  - the selected outline is `2px solid var(--color-primary)`.
- [ ] **Step 4: Run** `npm test`. Expected: pass.
- [ ] **Step 5: Browser check:**
  - screenshot of a post with an image, unselected and selected;
  - the fields' bounding box doesn't overlap the image box;
  - ↓ onto the figure then typing doesn't change the placeholder's text.
- [ ] **Step 6: Commit** with `fix(editor): figure and embed fields sit under the media, display not editable`.

### Task 5: Brand tokens, light and dark, with the writing area excluded

**Files:**
- Create:
  - `app/assets/brand-ui.css`;
  - `docs/design/brand/fonts/fraunces-latin-wght-normal.woff2` and `docs/design/brand/fonts/OFL.txt`. Get them with `npm pack @fontsource-variable/fraunces` into a temp folder, then copy the latin wght normal `woff2` and the license. Don't add a dependency.
- Modify:
  - `app/index.html`, `app/site.html` and `editor/index.html`: link `/brand/tokens.css` and `/app/assets/brand-ui.css` right after `vanilla-breeze.css`. Check that the editor server (`vp serve`, `src/server/index.js`) serves `/app/assets/brand-ui.css` too. If it doesn't, serve the file at a path both servers expose and say so in the report.
  - The header comment in `docs/design/brand/tokens.css`, `docs/design/brand/README.md` ("Brand colors versus app colors") and `docs/design/README.md` (Brand section, Direction and the Tokens table, which becomes the spec's light and dark tables): all say that the chrome is branded and the writing area is not.
- Test: `test/app/brand-ui.test.js`

**Interfaces:**
- Produces:
  - The VB semantic tokens are overridden for the chrome: `--color-background`, `--color-surface-raised`, `--color-surface-alt`, `--color-border`, `--color-border-subtle`, `--color-text`, `--color-text-muted`, `--color-text-subtle`, `--color-primary`, `--color-interactive`, `--color-text-on-primary`, with light values and a `@media (prefers-color-scheme: dark)` block.
  - `@font-face { font-family: Fraunces; src: url(/brand/fonts/fraunces-latin-wght-normal.woff2) format('woff2'); font-weight: 100 900; font-display: swap; }`
  - The custom property `--vp-title-font: var(--vp-brand-font-display)`, for Task 6.
  - The writing area (`.editor-content` and the pane element `pane-theme.js` themes) keeps the site theme's tokens. Use either a later-layer reset or scoping away from those elements.

- [ ] **Step 1: Write the failing test** `test/app/brand-ui.test.js`. It reads `brand-ui.css` and `docs/design/brand/tokens.css`, resolves `var(--vp-brand-*)` references to hex, and asserts contrast with a WCAG relative-luminance helper written in the test. These pairs must be ≥ 4.5 in light and in dark:
  - text, muted and subtle on background;
  - text, muted and subtle on surface-raised;
  - text-on-primary on primary;
  - primary on background (links).

  Primary on background must also be ≥ 3 (focus ring). The test also asserts that `brand-ui.css` declares the `@font-face` and the dark media block, and that `app/index.html`, `app/site.html` and `editor/index.html` link it after `vanilla-breeze.css`.
- [ ] **Step 2: Run** `node --test test/app/brand-ui.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** with the values in Global Constraints.
- [ ] **Step 4: Run** `npm test`. Expected: pass.
- [ ] **Step 5: Browser check:**
  - In the editor on a temp site, the content area's computed `background-color`, `color` and a link's `color` are the same with `brand-ui.css` loaded and with it blocked (`page.route` aborting it). They are not paper or ink.
  - With `colorScheme: 'dark'`, `body` has background `rgb(20, 28, 48)`.
  - `document.fonts.check('600 32px Fraunces')` is true after load.
  - The Theme screen's preview frame's background is unchanged.
- [ ] **Step 6: Commit** with `feat(app): branded UI tokens, light and dark; writing area unbranded`.

### Task 6: Brand surfaces

**Files:**
- Modify:
  - `app/index.html` and `app/assets/app.css` (the `.topbar` becomes an ink brand bar with the vanilla medium seal, petal text and an address in petal at 80% opacity);
  - `app/site.html` and `app/assets/app.css` (rail: the medium ink seal at 28px above `.rail-name`; the rail name and the screen `h1`s use `font-family: var(--vp-title-font)`);
  - `editor/index.html` and `editor/assets/css/_site-mode.css` / `_shell.css` (the editor top bar is ink; its buttons, `⋯`, settings toggle and save pill get on-ink styles; the primary Publish/Update is vanilla with ink text);
  - the empty states (`.empty` in `app/assets/app.css` plus the markup in the JS that renders them: sites, posts, media, programs), which get the medium seal at 64px and 35% opacity above the text, as `<img src="/brand/svg/seal-ink-medium.svg" alt="" width="64" height="64">`, with the vanilla variant in dark via `<picture>` + `prefers-color-scheme`, or CSS `content`.
  - In dark, the top bars use the vanilla seal on `--vp-brand-ink-rim`.
- Test: extend `test/app/brand-ui.test.js`:
  - `app/index.html` topbar has `img[src$="seal-vanilla-medium.svg"]`;
  - `app/site.html` rail has `img[src$="seal-ink-medium.svg"]`;
  - app.css sets `font-family: var(--vp-title-font)` for `h1` and `.rail-name`;
  - the editor top-bar text is petal on ink (≥ 4.5:1, from the declared values).

- [ ] **Step 1: Write the failing assertions.**
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: pass.
- [ ] **Step 5: Browser check.** Screenshots at 1280 and 390, light and dark, of Sites, Posts, Media, Programs, Theme and the editor, saved to `/private/tmp/claude-501/-Users-tpowell-src-cook/8bc5f774-dd5b-445c-a102-efcc2e179744/scratchpad/brand/`. Also an axe pass (axe-core from `~/src/vanilla-breeze/node_modules` if present). Report any serious issue.
- [ ] **Step 6: Commit** with `feat(app): brand surfaces: ink top bars, seal in the rail, Fraunces titles, seal empty states`.
