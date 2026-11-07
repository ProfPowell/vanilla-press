# VP New Look (step 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the Vanilla Press app and editor to the "quiet writing tool" design: Sites, the site rail, Posts, and an editor with the title in the document, a floating format toolbar, gutter handles, a "⋯" menu and a toggleable Post settings panel.

**Architecture:**
- App pages stay plain HTML plus ES modules. Each screen's logic moves into
  a pure, DOM-free view module tested in Node, the pattern
  `app/assets/js/components-view.js` already uses. The page script only
  renders.
- The server gains a few cheap fields on `GET /api/sites` and a guard on
  deleting a published post.
- The editor's ProseMirror changes are:
  - a `title` node as the document's first child, mapped to `meta.title`
    and never into the stored AST;
  - two plugins: a floating format toolbar and gutter handles.

  Their state logic is tested in Node by adding the ProseMirror packages as
  devDependencies.

**Tech Stack:** Node ≥22, `node:test`, Vanilla Breeze CSS tokens/elements, ProseMirror (esm.sh in the browser; the same versions as devDependencies for tests).

**Spec:** `docs/superpowers/specs/2026-11-07-vp-new-look-design.md`. Visual spec: `docs/design/README.md` and `docs/design/mockups/*.dc.html` (read the README's "How to read the mockups" first).

## Global Constraints

- CSS uses only the VB tokens in the README's token table. No hex values,
  no one-off colors. The rules stay under the existing `@layer` setup in
  `app/assets/app.css` and `editor/assets/css/*.css`.
- Fonts: app controls use `--font-sans`; writing, titles and page/section
  titles use `--font-serif`; paths and slugs use `--font-mono`.
- Contrast is at least 4.5:1. Primary controls are at least
  `--size-touch-min`; other controls at least 40px.
- No front-end framework, and no new runtime dependencies. devDependencies
  for tests are allowed.
- Post JSON and rendered HTML do not change. Stored media URLs stay
  `/media/<file>`.
- No browser `alert`, `confirm` or `prompt`.
- `vp serve` (fixture mode, no `?site=`) keeps working with the same editor.
- Every screen works at phone width; the rail stacks above the content.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npm test` passes at the end of every task.

## Plan rulings (made while planning, for the user to check)

- **P1, empty titles:**
  - New posts start with an empty title.
  - Validation allows an empty `meta.title` on a **draft**. Publish and
    Update refuse a post with no title: "Give the post a title before
    publishing."
  - New posts get the slug `untitled-<stamp>`, as the Posts screen already
    creates.
  - *Cost if wrong:* drafts can be saved untitled; lists show "Untitled".
- **P2, slug following the title:**
  - The slug follows the title only while `meta.status !== 'published'`
    and the slug hasn't been hand-edited.
  - "Hand-edited" is computed on load as `slug !== slugify(title)`, so it
    survives a reload. Today's flag resets on every load.
  - A post that was published and then unpublished follows its title
    again; its URL is offline by then.
  - *Cost if wrong:* an unpublished post's slug can change when it's
    retitled.
- **P3, Delete:**
  - Delete is refused on the server (409) while the post is published and
    a site workspace is open, not only in the UI.
  - Fixture mode is unchanged.
  - *Cost if wrong:* none for the app.

## Review Focus

1. **Undo across the title/body edge.** Typing in the title, then the body,
   then Undo must step back through both. The title must never end up in
   the stored blocks. *Test:* Task 6, `title edits undo with the body`.
2. **A published post's slug never changes on retitle**, including after a
   reload. *Test:* Task 6, `slugAfterTitleEdit keeps a published slug`.
3. **Unpublish and Delete are never one click from the live site going
   away.** A confirmation names the live URL; Escape or Cancel leaves
   everything as it was. *Test:* Task 5, `confirmation for unpublish names
   the live url`, plus the browser check.
4. **Keyboard-only formatting.** With the fixed toolbar gone, Alt+F10
   reaches the floating toolbar, arrow keys move within it, and Escape
   returns to the text with the selection intact. *Test:* Task 7,
   `toolbarKeyNav`, plus the browser check.
5. **Moving a block inside a list or callout** moves the innermost movable
   item within its parent and never lifts it out. *Test:* Task 8,
   `moveBlock moves a list item within its list`.

---

### Task 1: Sites API fields and the published-delete guard

**Files:**
- Modify: `src/git/git.js` (two new exports)
- Modify: `src/app/server.js:318-325` (`GET /api/sites`)
- Modify: `src/server/api.js:279` (`DELETE /api/documents/:id`)
- Test: `test/git/git.test.js` (or the existing git test file),
  `test/app/server.test.js`, the existing document API test file under
  `test/server/`

**Interfaces:**
- Produces:
  - `aheadBehind(dir: string) => Promise<{ ahead: number, behind: number } | null>`:
    from `git rev-list --left-right --count HEAD...@{u}`. Returns null
    with no upstream. It does not fetch.
  - `lastVpCommitAt(dir: string) => Promise<string|null>`: the ISO commit
    time of the newest commit on `@{u}` whose subject starts with one of
    `Draft: `, `Edit: `, `Publish: `, `Update: `, `Unpublish: `,
    `Components: `. Use `git log -1 --format=%cI -E --grep=… @{u}`.
    Returns null when there is none or no upstream.
  - `GET /api/sites` items gain:
    - `siteUrl: string|null` (via `readSiteUrl(site.path)` from
      `src/app/publish.js`; null on error);
    - `git.ahead` and `git.behind` (numbers, or null);
    - `git.lastBackupAt` (string|null).

    It must not open the site workspace.
  - `DELETE /api/documents/:id`: when `ws` exists and the stored doc's
    `meta.status === 'published'`, it responds
    `409 { error: 'Unpublish this post before deleting it.' }` and deletes
    nothing.

- [ ] **Step 1: Write failing tests**
  - `aheadBehind` on the `test/app/git-site-fixture.js` repo:
    - `{ahead:0,behind:0}` after setup;
    - `{ahead:1,behind:0}` after one local commit;
    - null in a repo with no upstream.
  - `lastVpCommitAt`:
    - null before any VP commit;
    - after committing and pushing `Draft: x [CI Skip]`, it equals that
      commit's `%cI`;
    - an unpushed `Edit: y` commit does not change it.
  - `GET /api/sites` returns `siteUrl`, `git.ahead`, `git.behind` and
    `git.lastBackupAt` for a fixture site. Use the existing
    `test/app/server.test.js` setup.
  - DELETE of a published doc with a workspace returns 409 with that
    error text, and the doc is still listed. A draft still deletes (200).
- [ ] **Step 2: Run** `node --test test/git test/app/server.test.js test/server`.
  Expected: the new tests FAIL (functions not exported, fields missing,
  delete returns 200).
- [ ] **Step 3: Implement** the two git functions, the
  `/api/sites` fields, and the delete guard.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then run `npm test`.
  Expected: all pass.
- [ ] **Step 5: Commit** `feat: sites list carries live url, sync counts and last backup; published posts can't be deleted`

### Task 2: App tokens and the Sites screen

**Files:**
- Create: `app/assets/js/sites-view.js` (pure)
- Modify: `app/index.html`, `app/assets/js/sites-page.js`, `app/assets/app.css`
- Test: `test/app/sites-view.test.js`

**Interfaces:**
- Consumes: the Task 1 `/api/sites` fields.
- Produces (`sites-view.js`):
  - `countPosts(docs: Array<{meta:{collection,status}}>) => { published: number, drafts: number }`.
    Counts the `posts` collection only.
  - `syncText(git: {connected, branch, ahead, behind}) => { text: string, tone: 'ok'|'warn'|'off' }`.
    The texts:
    - `'GitHub · main · in sync'` / ok when ahead and behind are both 0;
    - `'GitHub · main · 2 to push'` / warn when ahead > 0;
    - `'GitHub · main · 1 to pull'` / warn when behind > 0. When both are
      non-zero, show the push text first, then `' · 1 to pull'`;
    - `'Not connected to GitHub'` / off when not connected.
  - `backupText(iso: string|null, now: Date) => string`:
    - `'Backed up 8:48 AM'` when it's today, using a local short time;
    - `'Backed up Nov 3'` on another day;
    - `'Not backed up yet'` when null.

    Task 3's rail reuses it.

- [ ] **Step 1: Write failing tests** for all three helpers, using the exact
  strings above, with a fixed `now`.
- [ ] **Step 2: Run** `node --test test/app/sites-view.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `sites-view.js`. Then rebuild the Sites page to
  match `Main.dc.html`:
  - the top bar with the serif wordmark and the local address;
  - the "Sites" title and its line of explanation;
  - "Clone from GitHub" (secondary) and "Add site" (primary);
  - a card per site with:
    - the serif name, linking to `site.html?id=…`;
    - the mono path;
    - "N published · M drafts";
    - a status dot and `syncText`;
    - `backupText`;
    - "View live ↗" (only when `siteUrl` is set) and "Open".

  The add/clone/folder-browser panels keep their IDs and behavior,
  restyled. Set the app-wide token layer in `app.css` once (backgrounds,
  borders, radii, type roles) so Tasks 3 and 4 reuse it.
- [ ] **Step 4: Run** `npm test`. Expected: PASS. Then do a browser check
  with `vp` on a registered site:
  - the card renders with real counts and sync state;
  - at 390px wide, nothing overflows;
  - keyboard Tab reaches every action, with a visible focus ring;
  - an axe pass shows no serious issues.
- [ ] **Step 5: Commit** `feat: Sites screen in the new look`

### Task 3: Site shell rail with addressable sections

**Files:**
- Create: `app/assets/js/site-nav.js` (pure)
- Modify: `app/site.html`, `app/assets/js/site-page.js`, `app/assets/app.css`
- Test: `test/app/site-nav.test.js`

**Interfaces:**
- Consumes: `backupText` (Task 2); the existing `GET /api/sites/:id/status`
  that site-page already polls.
- Produces (`site-nav.js`):
  - `SECTIONS = ['posts','media','components','theme']`.
  - `LATER = ['Programs','Analytics','Social']`.
  - `sectionFromSearch(search: string) => string`: the `section` query
    value when it's in SECTIONS, else `'posts'`.
  - `sectionHref(siteId: string, section: string) => string`: gives
    `site.html?id=<enc>&section=<section>`, and omits `section` for posts.

- [ ] **Step 1: Write failing tests**:
  - `sectionFromSearch('?id=a&section=media') === 'media'`;
  - unknown or missing → `'posts'`;
  - `sectionHref('my blog','theme') === 'site.html?id=my%20blog&section=theme'`;
  - `sectionHref('a','posts') === 'site.html?id=a'`.
- [ ] **Step 2: Run** `node --test test/app/site-nav.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** Replace the side-nav buttons with a `<nav aria-label="Site">`
  rail as in `Site.dc.html` and `Media.dc.html`:
  - "← All sites", the site name, and "View live site ↗" (hidden without
    `siteUrl`);
  - links for SECTIONS with `aria-current="page"` on the current one;
  - a "Coming later" group of LATER as plain list items, not buttons;
  - a `role="status"` footer with the sync dot and `backupText`.

  Navigation uses real links and `history.pushState` plus `popstate`, so
  Back works. Media keeps a restyled "Coming in the next step" body.
  **Theme** hosts the existing `<theme-picker>` from
  `editor/assets/js/components/theme-picker.js`:
  - import it as a module;
  - give it the site's API base, the same way the editor does via
    `site-context.js` `apiBase`;
  - restyle it.

  Components keeps its current content, restyled. The rail becomes a
  wrapping flex row that stacks at phone width.
- [ ] **Step 4: Run** `npm test`. Expected: PASS. Then do a browser check:
  - each section loads by URL and by click;
  - Back returns to the previous section;
  - picking a theme in the Theme section saves (reload shows it), and the
    editor uses it;
  - the rail stacks at 390px.
- [ ] **Step 5: Commit** `feat: site rail with addressable sections; theme picker lives in Theme`

### Task 4: Posts screen

**Files:**
- Create: `app/assets/js/posts-view.js` (pure)
- Modify: `app/site.html` (posts section), `app/assets/js/site-page.js`, `app/assets/app.css`
- Test: `test/app/posts-view.test.js`

**Interfaces:**
- Produces (`posts-view.js`):
  - `filterPosts(docs, { filter: 'all'|'published'|'drafts', query: string }) => docs`:
    - posts collection only;
    - the query matches title or description, case-insensitive and
      trimmed;
    - newest first: `meta.published`, else `updated`.
  - `filterCounts(docs) => { all, published, drafts }` (posts collection).
  - `rowModel(doc) => { title, description, descriptionMissing: boolean, path, statusText: 'Published'|'Draft', date: string }`:
    - title falls back to `'Untitled'`;
    - description falls back to `'No description'` with
      `descriptionMissing: true`;
    - path is `/posts/<slug>`;
    - date uses `formatDate` from `app-api.js`.
  - `emptyText(filter, query) => string`:
    - with a query: `'No posts match "<query>".'`;
    - all: `'No posts yet. Start a new post.'`;
    - published: `'Nothing published yet.'`;
    - drafts: `'No drafts. Start a new post.'`.

- [ ] **Step 1: Write failing tests** for each function, using those exact
  strings and a mix of collections and statuses.
- [ ] **Step 2: Run** `node --test test/app/posts-view.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement**, then render the posts section as in `Site.dc.html`:
  - the header has "Posts", "Preview site" (secondary) and "New post"
    (primary);
  - a filter group of `aria-pressed` buttons with counts;
  - a search box;
  - each row is one link to the editor and shows: the serif title, the
    one-line description (ellipsis; italic when missing), the mono path,
    a status dot with text, and the date.

  "Preview site" calls the existing preview endpoint (`POST /api/sites/:id/preview`)
  and opens its `previewUrl`. On failure it shows the existing "run npm run
  dev" message inline. New post creates with `title: ''` (P1).
- [ ] **Step 4: Run** `npm test`. Expected: PASS. Then do a browser check of
  the filters, search, empty states, and the row link, at desktop width
  and at 390px.
- [ ] **Step 5: Commit** `feat: Posts screen in the new look`

### Task 5: Editor top bar, "⋯" menu, confirmations

**Files:**
- Modify: `editor/index.html` (header), `editor/assets/js/site-context.js`, `editor/assets/js/site-mode.js`, `editor/assets/css/_site-mode.css`, `editor/assets/css/_shell.css`
- Create: `editor/assets/js/components/more-menu.js`, `editor/assets/js/components/confirm-panel.js`
- Test: `test/editor/site-context.test.js`, `test/editor/site-mode-css.test.js`

**Interfaces:**
- Consumes: Task 1's delete 409 and `siteUrl` from `/api/sites`.
- Produces (`site-context.js`). These replace `headerActions`, so update
  its callers:
  - `primaryAction(meta) => { text: 'Publish'|'Update', action: 'publish'|'update' }`.
  - `moreMenuItems(meta, { siteMode: boolean, liveUrl: string|null }) => Array<{ id, text, danger?: boolean, disabled?: boolean }>`.
    The ids, in order:
    - `export`, `ast`;
    - `live` (only when `liveUrl` is set);
    - `delete` (text `'Delete post…'`, danger; disabled while published,
      with the title "Unpublish it first");
    - `unpublish` (text `'Unpublish…'`, danger; site mode and published
      only).

    In fixture mode, Unpublish stays in its existing meta-panel control
    and is not in this menu.
  - `confirmText(kind: 'unpublish'|'delete', { title, liveUrl }) => { heading, body, confirm }`:
    - unpublish: heading `'Unpublish "<title>"?'`, body
      `'<liveUrl> stops working once the site rebuilds. The post stays here as a draft.'`
      (or `'The live page stops working…'` without a URL), confirm
      `'Unpublish'`;
    - delete: heading `'Delete "<title>"?'`, body
      `'This removes the post and its page file. It can be recovered only from git history.'`,
      confirm `'Delete post'`.
  - `savePill(outcome, meta, held) => { text, tone: 'warn'|'plain' }`.
    It wraps the existing `saveStateText`. The tone is `warn` exactly when
    the post is published and the edits aren't live.
- `<more-menu>`: a button (`aria-label="More actions"`,
  `aria-expanded`) and a `role="menu"` list of `menuitem` buttons.
  - Keys: arrow keys and Home/End move; Escape closes and returns focus to
    the button.
  - It dispatches a `more-select` event with `detail.id`.
- `<confirm-panel>`: an in-page `role="alertdialog"` with
  `aria-labelledby` and `aria-describedby`.
  - Its method is `ask({heading, body, confirm}) => Promise<boolean>`.
  - Focus goes to Cancel first. Escape, or Cancel, resolves false.
  - On close, focus returns to where it was.

- [ ] **Step 1: Write failing tests** for `primaryAction`, `moreMenuItems`
  (published and draft, site and fixture, with and without a live URL),
  `confirmText` (both kinds, with and without a URL), and `savePill`.
  Name one `confirmation for unpublish names the live url`. Add a
  `site-mode-css` assertion that `.more-menu [role=menu][hidden]` is
  `display: none !important`.
- [ ] **Step 2: Run** `node --test test/editor`. Expected: FAIL.
- [ ] **Step 3: Implement.** Build the header from `Editor.dc.html`:
  - "← Posts", the site name (from `/api/sites`), and the save pill;
  - a spacer;
  - Preview, the Post settings toggle (an icon button with
    `aria-pressed`, keeping `vp.settingsHidden`), `<more-menu>`, and the
    primary button;
  - the action state ("Publishing…" → "Live ↗") next to the primary
    button.

  Unpublish and Delete go through `<confirm-panel>`. A Delete 409 shows
  the server's text. Remove the old Unpublish button and the Tools button.
  Remove `.editor-toolbar`'s Export/AST/save indicator; they now live in
  the menu and the pill.
  - `vp serve` shows the same header without "← Posts" and the site name.
  - The meta-panel's Publish keeps working there. The fixture header's
    primary button runs the meta-panel's existing publish toggle.
- [ ] **Step 4: Run** `npm test`. Expected: PASS. Then do a browser check
  in site mode and in `vp serve`:
  - the menu works by keyboard;
  - Unpublish → Cancel changes nothing; Unpublish → confirm works;
  - Delete of a published post is disabled; Delete of a draft works;
  - Export and AST work.
- [ ] **Step 5: Commit** `feat: editor top bar with ⋯ menu and in-page confirmations`

### Task 6: Title in the document, meta line, slug rule

**Files:**
- Modify: `package.json` (devDependencies: `prosemirror-model@1.25.1`, `prosemirror-state@1.4.3`, `prosemirror-transform@1.10.4`, `prosemirror-commands@1.6.2`, `prosemirror-history@1.4.1`, `prosemirror-keymap@1.2.2`, matching the import map)
- Modify: `editor/assets/js/schema.js` (`doc` content and a new `title` node), `editor/assets/js/ast.js`, `editor/assets/js/editor.js`, `editor/assets/js/keymap.js`, `editor/assets/js/meta-state.js`, `editor/assets/js/components/meta-panel.js`, `editor/assets/css/_prosemirror.css`, `src/schema/validate.js`, `src/app/publish.js` (title required to publish), `app/assets/js/site-page.js` (new post title `''`)
- Create: `editor/assets/js/title.js`, `editor/assets/js/slug.js`
- Test: `test/editor/title.test.js`, `test/editor/slug.test.js`, the validate tests under `test/schema/`, and `test/app/publish.test.js`

**Interfaces:**
- Produces:
  - The schema: `doc.content = 'title block+'`.
    - `title`: `content: 'text*'`, `marks: ''`, `defining: true`, and
      `parseDOM`/`toDOM` as `h1.doc-title`.
    - When the node is empty, it carries `data-placeholder="Untitled"`
      through a decoration.
  - `ast.js`:
    - `toBlockAst(pmDoc)` skips the title node. Its output is unchanged
      for every existing fixture.
    - `fromBlockAst(blocks, pmSchema, { title = '' } = {})` puts the title
      node first.
  - `title.js`:
    - `titleOf(pmDoc) => string`;
    - `setTitleTr(state, text) => Transaction`;
    - `titleKeymap() => Record<string, Command>`.
      - Enter in the title moves the cursor to the start of the first
        block, inserting an empty paragraph if the first block isn't a
        textblock.
      - Backspace at the start of the first block, when it isn't empty,
        moves to the end of the title.
      - Mod-a inside the title selects only the title.
    - `titlePastePlugin() => Plugin`: pasting into the title inserts the
      slice's plain text, with newlines turned into spaces.
  - `slug.js`:
    - `slugify(title) => string`, moved from meta-panel with the same
      output;
    - `slugIsHandEdited(meta) => boolean`, which is
      `!!meta.slug && meta.slug !== slugify(meta.title || '')`;
    - `slugAfterTitleEdit(meta, newTitle, { handEdited }) => string`,
      which returns the current slug when
      `meta.status === 'published' || handEdited`, otherwise
      `slugify(newTitle) || meta.slug`.
  - `editor.js`: on every transaction where `titleOf` changed, call
    `setCurrentMeta({ title, slug: slugAfterTitleEdit(...) })`. Loading a
    doc builds the PM doc with its title.
  - The meta line above the title: a non-editable widget decoration
    showing `'Published Nov 3, 2026 · posts'` or `'Draft · posts'`.
  - meta-panel drops its Title field.
  - Validation: `meta.title` may be `''` when `meta.status === 'draft'`
    (P1).
  - Publish/Update with an empty title respond
    `422 { error: 'Give the post a title before publishing.' }`.

- [ ] **Step 1: Write failing tests** (Node, real ProseMirror):
  - `round-trips every fixture with a title`: for each
    `test/fixtures/*.json`, `toBlockAst(fromBlockAst(blocks, schema,
    {title}))` deep-equals `blocks`, and `titleOf` returns the title.
  - `enter in the title moves to the first block` and
    `backspace at the start of the first block moves into the title`.
  - `paste into the title is plain text`: a slice with a heading and a
    bold run becomes plain text with no newline.
  - `title edits undo with the body`, with `prosemirror-history`:
    1. type in the title;
    2. type in the body;
    3. Undo twice;

    `titleOf` and the body both return to their originals.
  - `slugAfterTitleEdit keeps a published slug`, with cases:
    - published + new title → old slug;
    - draft + not hand-edited → slugified new title;
    - draft + hand-edited → old slug;
    - `slugIsHandEdited` true and false.
  - validate: a draft with `title: ''` is valid; a published post with
    `title: ''` is invalid.
  - publish: an empty title → 422 with that text.
- [ ] **Step 2: Run** `npm install` (devDeps), then
  `node --test test/editor test/schema test/app/publish.test.js`.
  Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** The empty-title placeholder is
  `h1.doc-title:empty::before { content: attr(data-placeholder) }` in
  `--color-text-subtle`. The writing column is `--measure-normal`, centered,
  `--font-serif`, 20px/1.65 per the README. Create new posts with
  `title: ''` everywhere they're created today (`editor.js` 538/570,
  `meta-state.js` 9, `site-page.js` 78).
- [ ] **Step 4: Run** `npm test`. Expected: PASS. Then do a browser check:
  - type a title in a new post, Enter, then a body; reload and the title
    shows;
  - a published post's slug doesn't change on retitle, before or after a
    reload;
  - Undo crosses the edge;
  - an empty title shows the placeholder, and Publish refuses with the
    message.
- [ ] **Step 5: Commit** `feat: the title is the first line of the document; slug follows it only for unpublished posts`

### Task 7: Floating format toolbar (replaces the fixed toolbar)

**Files:**
- Modify: `editor/assets/js/menu.js` (split items; remove `EditorToolbar` mounting), `editor/assets/js/editor.js`, `editor/index.html`, `editor/assets/css/_shell.css`
- Create: `editor/assets/js/format-toolbar.js`, `editor/assets/css/_format-toolbar.css` (imported in `editor.css`)
- Test: `test/editor/format-toolbar.test.js`

**Interfaces:**
- Consumes: the item definitions in `menu.js` `buildToolbarItems()` and the
  link command (the existing link button, Mod+K); `wrapInComponent` from
  step 2.
- Produces:
  - `menu.js`:
    - `PRIMARY_IDS = ['bold','italic','code','highlight','link']`;
    - `formatItems() => { primary: Item[], more: Item[] }`. Every
      existing toolbar command lands in exactly one list. `more` holds
      strikethrough, keyboard, subscript, superscript, lift (Mod+[) and
      "Wrap in component…". Block types (H2–H4, lists, quote, rule) are
      not in either list; the palette and input rules cover them.
  - `format-toolbar.js`:
    - `toolbarPosition(sel: {top,bottom,left,right}, size: {width,height}, viewport: {width,height}, gap = 8) => { top, left, placement: 'above'|'below' }`.
      - It goes above the selection when `sel.top - size.height - gap >= 0`,
        else below.
      - `left` centers on the selection, clamped to
        `[gap, viewport.width - size.width - gap]`.
    - `toolbarKeyNav(index: number, count: number, key: string) => number|null`:
      ArrowRight and ArrowLeft wrap, Home gives 0, End gives count-1, any
      other key gives null.
    - `formatToolbarPlugin() => Plugin`.
      - It shows a `role="toolbar"` `aria-label="Format selection"` when
        the selection is a non-empty text selection outside the title.
      - It hides when the selection is empty, and on blur unless focus
        moved into the toolbar.
      - Alt+F10 focuses its first button.
      - Escape returns focus to the editor and keeps the selection.
      - Buttons reflect active marks with `aria-pressed`.

- [ ] **Step 1: Write failing tests**:
  - `formatItems` covers every old toolbar mark and command exactly once,
    and none of the block types;
  - `toolbarPosition` above, below, and clamped at both edges;
  - `toolbarKeyNav` covers wrap, Home and End.
- [ ] **Step 2: Run** `node --test test/editor/format-toolbar.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** Remove `.editor-toolbar` from `index.html`.
  "More" is a menu button that opens a `role="menu"` of the `more` items,
  with the same keyboard behavior as Task 5's `<more-menu>`. Reuse that
  element if it fits. The toolbar's shadow is one of the README's two
  allowed shadows.
- [ ] **Step 4: Run** `npm test`. Expected: PASS. Then do a browser check:
  - select text, and the toolbar appears without covering it;
  - Bold, Link and More → Strikethrough all work;
  - keyboard only: Alt+F10, arrows, Enter, Escape;
  - the toolbar never shows in the title.
- [ ] **Step 5: Commit** `feat: floating format toolbar replaces the fixed toolbar`

### Task 8: Gutter handles, block move, "Type / for blocks", quote headings

**Files:**
- Create: `editor/assets/js/block-handles.js`, `editor/assets/css/_block-handles.css`
- Modify: `editor/assets/js/editor.js`, `editor/assets/js/keymap.js`, `editor/assets/js/components/block-palette.js` (open with an insert position), `editor/assets/css/_prosemirror.css`
- Test: `test/editor/block-handles.test.js`

**Interfaces:**
- Consumes: the block palette's existing open/insert API. Add an optional
  `insertAfter: number` position if it lacks one.
- Produces (`block-handles.js`):
  - `movableBlockAt($pos: ResolvedPos) => { depth: number, pos: number } | null`:
    the innermost ancestor that is a list item, or a block whose parent
    holds more than one child and isn't the doc's title. Top-level blocks
    count; the title is never movable.
  - `moveBlock(dir: -1|1) => Command`. It swaps the movable block with
    its sibling in the same parent, and the selection follows it. It
    returns false at the first or last sibling, and never moves past the
    title.
  - `blockHandlesPlugin() => Plugin`, for the hovered or cursor block:
    - a `+` button (`aria-label="Add block after"`) that opens the palette
      inserting after that block;
    - a drag handle (`aria-label="Drag to move"`, `draggable`) that sets a
      `NodeSelection` on the block and uses ProseMirror's own drag and
      drop with the existing dropcursor.
  - The keymap gets `Alt-Shift-ArrowUp` → `moveBlock(-1)` and
    `Alt-Shift-ArrowDown` → `moveBlock(1)`.
  - An empty-paragraph placeholder decoration shows "Type / for blocks"
    on the empty paragraph that holds the cursor. It is never stored.
  - CSS: `blockquote h2..h6` use the normal heading sizes and roman style.

- [ ] **Step 1: Write failing tests** (Node, real ProseMirror):
  - `moveBlock moves a top-level paragraph down`;
  - `moveBlock moves a list item within its list`. The item stays inside
    the list, and at the last item it returns false;
  - `moveBlock never moves above the title`;
  - `movableBlockAt inside a callout picks the callout's child`;
  - `toBlockAst after a move` reflects the new order.
- [ ] **Step 2: Run** `node --test test/editor/block-handles.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** The handles sit in the left gutter of the
  writing column and are visible on hover and when the cursor is in the
  block. At phone width they move inside the column.
- [ ] **Step 4: Run** `npm test`. Expected: PASS. Then do a browser check:
  - `+` inserts after the right block;
  - dragging reorders, and so does Alt+Shift+↑/↓ (in a list too);
  - the placeholder shows only on the cursor's empty line;
  - headings in a quote look like headings.
- [ ] **Step 5: Commit** `feat: gutter + and drag handles, keyboard block move, block placeholder`

### Task 9: Post settings panel

**Files:**
- Modify: `editor/assets/js/components/meta-panel.js`, `editor/assets/js/components/component-settings.js` (host), `editor/assets/js/site-mode.js`, `editor/assets/js/components/ast-inspector.js` (placement), `editor/index.html` (sidebar), `editor/assets/css/_meta-panel.css`, `editor/assets/css/_shell.css`
- Create: `editor/assets/js/settings-view.js` (pure)
- Test: `test/editor/settings-view.test.js`

**Interfaces:**
- Consumes: `savePill` (Task 5); the collections config (`GET <apiBase>/config/collections`
  — use whatever the panel reads today); the component cursor state from
  step 2's `component-settings`.
- Produces (`settings-view.js`):
  - `statusBox(meta, { liveOutOfDate: boolean }) => { title: string, note: string|null }`:
    - published: title `'Published Nov 3, 2026'`, note
      `"Your saved edits aren't on the live site yet. Update builds the site and pushes them."`
      only when `liveOutOfDate`;
    - draft: title `'Draft'`, note
      `'Publish builds the site and puts this post live.'`.
  - `collectionOptions(collectionsConfig, current) => string[]`: the
    config's names in order, plus `current` when it's missing.
  - `urlPrefix(collection, collectionsConfig) => string`: `'/<collection>/'`,
    or the config's URL base if it sets one. Use `postUrlPath`'s rule from
    `src/app/publish.js`; import or mirror it.
- The panel follows `Editor.dc.html`, top to bottom:
  - a **Component** section, present only while the cursor is in a
    component (step 2 R11);
  - the status box, which replaces the Status select in site mode
    (fixture mode keeps its select);
  - URL as a prefix plus the slug input;
  - Description with its hint;
  - Tags;
  - Collection, as a select;
  - Appearance (`<details>`) reading "Page theme: site theme". The link
    is absent until step 4.
- When the panel is hidden and the cursor enters a component, the settings
  toggle shows a dot (`data-attention`), and its `aria-label` becomes
  "Post settings (component settings available)".
- A save conflict still forces the panel open (`site-mode.js:227`).
- "Show block tree" (Task 5 menu) swaps the panel's contents for
  `<ast-inspector>`, with a "Back to settings" button.
- `vp serve`: the doc browser and the theme picker sit at the bottom of
  the panel.

- [ ] **Step 1: Write failing tests** for `statusBox` (published with and
  without out-of-date, and draft), `collectionOptions` (current missing and
  present), and `urlPrefix`.
- [ ] **Step 2: Run** `node --test test/editor/settings-view.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS. Then do a browser check:
  - each field saves;
  - with the panel hidden, entering a component shows the dot;
  - the AST view swaps in and back;
  - a conflict forces the panel open;
  - `vp serve` still has its doc browser and theme picker;
  - at 390px the panel stacks below the writing area.
- [ ] **Step 5: Commit** `feat: Post settings panel in the new look`

### Task 10: Docs and the whole-app pass

**Files:**
- Modify: `docs/EDITOR.md`, `README.md` (screens and shortcuts), `CLAUDE.md` (only if a path it names moved)
- Test: none new

- [ ] **Step 1: Update docs.** EDITOR.md lists:
  - the new header and "⋯" items;
  - Alt+F10, Alt+Shift+↑/↓, `/` and `+`;
  - the title rules (P1, P2) and the delete guard (P3).

  Remove references to the fixed toolbar, the Tools button and the meta
  Title field.
- [ ] **Step 2: Whole-app browser pass** at 1440px and 390px, on Sites,
  each rail section, Posts, and the editor (draft and published), in site
  mode and `vp serve`:
  - keyboard only;
  - axe with no serious issues;
  - `grep -nE '#[0-9a-fA-F]{3,8}\b' app/assets/app.css editor/assets/css/*.css`
    shows no new hex values outside comments;
  - every function from before has a home (spec Anti-goals list).
- [ ] **Step 3: Run** `npm test`. Expected: all pass.
- [ ] **Step 4: Commit** `docs: editor and app guide for the new look`
