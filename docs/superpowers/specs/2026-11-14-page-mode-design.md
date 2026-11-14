# Page mode, and never losing work

Status: draft for review (2026-11-14)
Builds on: `2026-11-11-layouts-design.md` (regions, the per-document layout), `2026-11-11-layout-editor-design.md`
(the layout preview copy), and the draft Preview on `fix/layout-editor-polish` (763f4c4: any post, draft or
published, built as published in a private copy).
Repo: `~/src/vanilla-press`. Cook needs no change unless the builder finds the region markers (below) need one.

## Why

The post editor is a block editor beside a page it doesn't look like. The user writes technical teaching
material and wants to "directly write and add components like code blocks as I go", on the page as it will be
published, because Vanilla Breeze output is plain HTML and the page is already the best picture of the post.
Typing ``` should "immediately pull in a possibility of being prompted for code listing or full code-block
component".

Asked what would make them wince, the user said: "just losing work … Losing work is a much more serious
issue." Layout precision can be adjusted with use; lost work can't be undone. So the work comes in two phases,
safety first, and safety is a requirement on everything in phase 2 as well.

## Goals

**Phase 1: never lose work (both editors as they are today)**
1. Every change to an open post is kept in the browser at once, before any save is tried.
2. After a crash, closed tab, app restart or failed save, reopening the post offers to restore those
   changes, showing what differs.
3. A failed or paused save is shown loudly and stays shown until resolved; closing the tab with unsaved work
   warns.

**Phase 2: page mode**
4. Writing a post happens on the real built page: the site's own CSS, theme, fonts and components, with the
   regions the post fills editable in place and everything else locked.
5. Markdown-style triggers turn into the element or component as you type, asking first when the trigger
   could mean more than one thing.
6. Components appear as the real live element; clicking one edits its settings in a panel, with changes
   shown in the page as they are made.
7. Page and Blocks are two views of one post. A post opens in Page view the first time; after that the
   editor remembers the last view used.

## Non-goals and anti-goals

- **Anti-goal: any path that loses content.** Not on save failure, crash, layout switch, view switch, a
  component that won't render, or content page mode can't represent. If it can't hold something faithfully
  it says so and doesn't save over it (the existing rule: `component-model.js` refuses to auto-save
  unrepresentable content).
- **No free-form HTML editing.** The page is edited through the document model, as in the block editor.
- **No creating regions from a post.** Regions come from the layout. The user: "mostly filling the regions
  the layout already has". Layout changes stay in the layout editor.
- **Not a page builder.** No drag-and-drop between regions on the page; moving content between regions is
  done in the Blocks view.
- **No writes to the site except saves.** The page shell is built in the private preview copy
  (`src/app/layout-preview.js`), never in the site's working tree.

## Phase 1: never lose work

Today (checked 2026-11-14) the post editor auto-saves to the server, pauses auto-save on a conflict (file
changed on disk, 409) or on unrepresentable content, and has no local copy: edits between saves are lost if
the tab, network or app dies.

- **Local copy.** On every content or settings change, write `{siteId, docId (or a temporary id for a new
  post), document AST, meta, the server version it was based on, time}` to IndexedDB. Writes are cheap enough
  per change; the builder may coalesce within one animation frame. The copy for a post is cleared only after
  the server confirms a save of a version at least as new.
- **Restore.** Opening a post with a local copy newer than the saved file shows a notice: "Unsaved changes
  from <time> — Restore · Show differences · Discard". Show differences lists changed blocks/fields in plain
  words (no raw diff). Discard asks nothing more but keeps the discarded copy in the history below.
  A local copy based on an older server version than the current file is a conflict: offer Restore as a
  separate copy and the existing conflict notice, never a silent overwrite.
- **Loud save state.** Failed, paused (conflict, unrepresentable content) or offline: a bar under the editor
  bar that stays until resolved, saying what happened and what to do. `beforeunload` warns while anything is
  unsaved on the server (the local copy still makes the warning survivable).
- **Recent versions** *(my call)*. Keep the last 20 server-confirmed versions of each post locally, with a
  "Versions" list in the post's settings to look at and restore one. Restoring creates a normal edit (undoable,
  saved as usual).
- **Layout editor too** *(my call)*. The same local copy and restore for the layout editor's open file; it
  shares the mechanism.
- Storage failing (private window, quota) must not break editing: show a one-line warning that unsaved work
  isn't protected locally, and carry on.

## Phase 2: page mode

### The page

- The page shell is the post's page as Cook builds it for Preview (the doc-preview path from 763f4c4: the
  private copy, the post's own address, built as published, drafts included). It is shown in a frame of its
  own so the editor's styles never reach the page and the site's styles never reach the editor.
- The editor needs to work inside that frame, so the frame's page must be served from the app's own origin
  (the preview's static server is on another port today). How is the builder's call.
- The shell is rebuilt only when the layout or theme changes (switching layout in Settings, saving a layout
  or theme, the site's config changing). Typing never rebuilds it. While a rebuild runs, the current page stays
  editable and the new shell replaces it without losing the caret's place or any edit.
- The builder needs to know where the body and each region the post fills sit in the built page. Building
  the shell with a marker per region (for example a placeholder element per region in the private copy's
  draft) is the expected route; a Cook change is allowed if needed, behind the same "nothing written to the
  site" rule.
- **Precision.** "Very close, identical if possible." Editing marks (region outlines and labels, the selected
  component's ring, toolbars, choosers) are overlays that take no space. With nothing selected the editable
  regions must lay out as the published page does. Known, accepted differences: the empty line at the end of
  a region, interactive components opened up while selected, and the "＋ Add" line for an empty optional
  region. **Hide marks** (a bar toggle, my call: ⌘.) removes every overlay.
- **Widths** *(my call)*: a Phone / Tablet / Full switch resizes the frame.
- Fields and live parts of the layout (`${date}`, a recent-posts list) show the real values from the
  shell's build.

### Regions

- Each region the layout lets a post fill (`regionPlan` in `editor/assets/js/regions.js`) is editable where
  the page puts it. The body includes the title as it does today.
- The layout's own parts (site header, nav, footer, and regions posts can't fill) are faded and locked;
  hovering one offers **Edit in the layout**, which opens the layout editor on that layout.
- An optional region the post doesn't use shows as one "＋ Add <label>" line where it would go. Emptying a
  region returns it to that line.
- Stored regions the current layout doesn't show are kept (as today) and listed in a "Kept, not shown on this
  layout" note with a way to see them in the Blocks view. Nothing is dropped.
- The `/` menu offers only what the region allows, as in the post editor now.
- Undo and redo span all regions, in the order edits were made.

### Triggers

Each trigger works in every region and opens its chooser at the caret. Enter takes the highlighted choice
(the one used last time); Escape leaves the typed text as text. Nothing triggers inside code.

| Typed | Result |
|---|---|
| ``` at the start of a line | Chooser: **Code listing** (`<pre><code>`) or **Code block** (`code-block`). For html, css or js, a third choice: **Code playground**. A language typed after the backticks (```` ```js ````) is used. |
| ```` ```mermaid ```` | A diagram (`diagram-wc`), drawn live as its source is typed |
| ```` ```http ```` | Chooser: code listing or **HTTP exchange** (`http-component`, request and response) |
| A URL pasted inside text | A link |
| A URL pasted on an empty line | Chooser: link, or the matching embed (YouTube address → YouTube player, video file → video player, PDF → PDF viewer) |
| A PDF or video file dropped or pasted | Chooser: viewer/player or link, defaulting to the last choice. (This settles the open question from the earlier PDF bug: the user chooses each time.) |
| `> [!note]`, `> [!tip]`, `> [!warning]` … | An alert/callout of that kind |
| `#`, `>`, `-`, `1.`, `**…**`, `*…*`, `` `…` ``, `[…](…)`, `:emoji`, `&name;` | As in the post editor today |
| `/` | The full component menu, as today, including tabs and teaching items |

**Browser window** wraps something: a selected code playground, image or embed gets "Show in a browser
window" on its toolbar (and unwraps the same way).

### Components

- Every component in the catalog works in page mode; none is block-editor-only. The user's frequent ones
  get triggers, defaults and the demo below: code-block, code-playground, browser-window, http-component,
  diagram-wc, video-player, youtube-player, pdf-viewer, links, plus tabs, alerts and teaching items
  (glossary terms, footnotes, steps, notes) "on occasion".
- `http-component` is not in `src/components/catalog.js` yet (Vanilla Breeze ships it as an integration,
  like code-block); add it.
- A component renders as the real element. Where it has editable text (code, a caption, a tab's content) the
  text is edited in place. Clicking it selects it: a ring and a small toolbar — **Settings…**, move up/down,
  **Show in Blocks**, delete. Settings opens a side panel (the existing component settings form); changes show
  in the page as they're made.
- Interactive components (tabs, accordions, steps) show every part while selected so each can be written,
  and behave normally when not selected.
- A component that fails to load or render shows a plain card with its name and a Settings button; its
  content is kept untouched.

### The editor around the page

- The bar: site, **Page | Blocks** toggle, save state, Settings (title, slug, tags, date, layout, status —
  today's post settings), Preview, Publish, Hide marks, widths.
- Page and Blocks edit the same document state: switching converts nothing and keeps undo history and the
  selection's place where it can.
- View choice: Page the first time a post is opened; after that the last view used (a per-browser
  convenience, kept in localStorage).
- Phase 1's local copy, restore and save bar apply unchanged.

## The demo, and what "done" means

A lesson post, **"How HTTP caching works"**, written from scratch in page mode on thomasapowell.com's post
layout, with something in the aside: an intro; a code-block of the response headers; an http-component
showing the request and a 304; a Mermaid sequence diagram; a code playground in a browser window that fetches
twice; a short video; the slides as a PDF viewer; a warning alert about `no-store`; tabs comparing `fetch`
and `XMLHttpRequest`. Done means: it can be written entirely on the page using the triggers above, the
published page matches what was on screen with marks hidden, and killing the app mid-edit and reopening
restores everything typed.

## Constraints

- Browser tests against a real site block writes as the project already does (route `**/api/**`, abort
  non-GET requests except the read-only preview builds).
- Never write to the site's working tree except through saves; the shell is built in the private copy.
- The existing block editor keeps working throughout; page mode lands behind the Page/Blocks toggle.
- No browser `alert`/`confirm`/`prompt`.

## Settled after the builder check *(all my calls)*

1. **One document model is fixed.** Page mode edits the same ProseMirror document (title, body, `region`
   nodes), schema, plugins and history as the block editor; that is what makes "switching converts nothing"
   true. Phase 2 starts with a throwaway spike that must show, on thomasapowell.com's post layout: typing in
   the body and the aside in place, one undo history across both in edit order, the existing input rules and
   node views working, and a switch to Blocks and back with nothing changed. If the spike can't meet that
   without a second document model, stop and bring it back to the user before planning further.
2. **Where the page runs.** A same-origin iframe served by the app, running the site's own CSS and its
   component scripts (Vanilla Breeze and the installed component packages), so components are the real
   elements. Other page scripts the site adds (analytics and the like) are not run in the editor frame.
   Third-party embeds stay in their own cross-origin iframes as on the published page. This is a local,
   single-user app editing the user's own site, the same trust the existing Preview already extends.
3. **Region markers.** Cook changes are allowed, on a branch, unpublished, as with earlier layout work. The
   shell is built with each fillable region's content replaced by a marker element and the title's
   `${title}` output marked too. The title is edited where the layout prints it; if the layout doesn't print
   it, the title is edited in Settings only. A region the layout accepts but doesn't render is treated as
   "kept, not shown". If a layout can't be marked reliably, page mode falls back to Blocks for that post with
   a one-line reason; it never guesses.
4. **Phase 1 identity and conflicts.** The save conflict check is server-side today (`rejectSave` →
   `preflightSave` in `src/server/api.js`); the client has no version token. Add one: the server returns a
   revision (the stored document's `updatedAt` or a counter) on load and save, and the local copy records it.
   A new post's local copy uses a temporary id and is re-keyed to the real id when the first save returns.
   Everything in Phase 1 is client-side apart from that revision. Two tabs on one post: each keeps its own
   local copy; the second tab to open the post shows "Open in another tab" and edits read-only until the user
   chooses to take over (BroadcastChannel).
5. **Releases.** Phase 1 ships on its own branch, usable with the block editor alone, before Phase 2 work
   begins. It must not assume page mode exists.
6. **Precision check.** Automated: a Playwright check that, with marks hidden, each editable region's box and
   its blocks' boxes in the editor frame match the Preview page's within 2px at Full and Phone widths, on the
   demo post. Plus the user's own look at the demo.
7. **Triggers.** Reuse the existing input-rule modules (`input-rules.js`, `inline-marks.js`, chars/); the
   new choosers are added beside them as Node-testable rule specs, as `text-rules.js` does. Desktop browsers
   first; IME composition must never trigger a rule or a chooser. Phone width is for seeing the narrow layout,
   not for touch editing.
8. **Slow shell rebuilds.** The current shell stays editable while a rebuild runs, with a quiet "Updating the
   page…" line; a failed rebuild keeps the old shell and shows why in the same line. Edits are never blocked
   on a build.

## Left to the builder

- How one document is edited in several separate places on the page (one editor per region coordinated
  into one document and one undo history, or another approach). This is the hardest technical question;
  a throwaway spike before planning phase 2's tasks in detail is expected.
- How the frame is served on the app's origin, and how region markers are produced.
- IndexedDB schema and coalescing, the wording of notices (plain, short), the exact keyboard shortcuts.
- Order of work within each phase.
