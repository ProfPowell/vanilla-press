# Layout Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Layouts screen and a three-pane layout editor (canvas, inspector, live preview) in Vanilla Press that open, edit, create, duplicate, delete and publish format-1 layouts and fragment includes, on a shared layout tree from Cook.

**Architecture:**
- **Cook** gains a JSON layout tree with `parseLayout` / `serializeLayout` (canonical HTML) and `layoutUsage`.
- **VP's server** loads these from the site's own Cook (ruling P1 of the layouts plan). It saves layout files with a hash guard, and Publish commits and pushes them.
- **The preview** builds a cached working copy of the site with the site's Cook, served by a per-site static server on its own port.
- **The editor** is a separate page. A layout schema in ProseMirror converts to and from the tree, alongside an inspector, a head dialog and a preview iframe.

**Tech Stack:** Node 25 ESM, node:test, linkedom (both repos), ProseMirror (VP editor), better-sqlite3 (VP).

**Spec:** `docs/superpowers/specs/2026-11-11-layout-editor-design.md` (702db19). It builds on `docs/superpowers/specs/2026-11-11-layouts-design.md`.

## Global Constraints

- **Repos and branches:**
  - Cook: `~/src/cook`, branch `feat/layout-editor` from `master`.
  - VP: `~/src/vanilla-press`, branch `feat/layout-editor` from `main`.
- **Never** push, merge to a remote, or `npm publish` without the user's explicit OK.
- **Never** stage VP's `CLAUDE.md`; stage files by name.
- **Commits:** every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **No new dependencies** in either repo.
- **Running tests:**
  - Cook: `npm test`. Its test fixtures never go under `test/fixtures/`, which `test/markdown.test.js` deletes.
  - VP: `npm test`. On Node 25, run single files by path.
- **Cook byte identity:** existing sites build byte-identically. Re-run `COOK_REGRESSION=1 node --test test/regression-byte-identical.test.js` after any Cook build-path change.
- **Cook version:** bump to `2.9.0` in Task 2. Do not publish it.
- **VP during development:** it runs against a linked local Cook. Tests symlink a temp site's `node_modules/cook-ssg` to `~/src/cook`, as `test/app/site-layouts.test.js` already does.
- **Don't touch the user's environment:**
  - Never write in `~/src/thomasapowell.com` or `~/src/vanilla-breeze`. Read-only copies into the scratchpad are fine.
  - Don't start servers on ports 3017, 3007 or 4180. Those belong to the user's session.
  - Browser checks are time-limited Node Playwright scripts: `perl -e 'alarm N; exec @ARGV' node script`, with chromium from `/Users/tpowell/src/vanilla-breeze/node_modules/playwright/index.mjs`. They run against temp apps (`startApp({ port: 0 })`). Never use MCP browser tools, and never trigger alert, confirm or prompt dialogs.
- **Layout and include name pattern** (from VP `validate.js`): `^[A-Za-z0-9_][A-Za-z0-9_.-]*$`.
- **Copy (exact):**
  - Screen and actions:
    - `Layouts`
    - `New layout`
    - `Open`
    - `Duplicate`
    - `Delete`
    - `Publish layout`
  - Layout status:
    - `Editable`
    - `Can't be edited here: <first problem>`
    - `Show all problems`
    - `Plain layout: add a layout info block to edit it here`
  - Layout relationships:
    - `Used by <N> pages` (`Used by 1 page` when there is one)
    - `Built on <parent>`
    - `Base for: <a, b>`
  - New-layout starts:
    - `Built on <layout label>`
    - `Copy of <layout label>`
    - `Blank base`
  - Warnings:
    - `This layout changed on disk since you opened it`, with the button `Reload`
    - `This site's Cook is too old to edit layouts; update cook-ssg`
    - `Not published` (the marker for saved but unpublished)
  - Editor labels:
    - `Document body goes here`
    - `Region: <label>`
    - `Repeats for each <alias> in <source>`, plus ` (<limit>)` when a limit is set
    - `Show only when`
    - `Desktop` / `Narrow`
    - `Chosen by layouts built on this one`
    - `Head`
    - `Abstract`
    - `Save`

## Review Focus

1. **Round trip.** Parsing, serializing and parsing again gives the same tree for every layout in the starter set and for all seven thomasapowell.com layouts. Building with the serialized files gives the same pages, apart from whitespace. Pinned in Task 1.
2. **Hand edits.** A layout edited by hand while it is open is never overwritten. Saving says `This layout changed on disk since you opened it` and writes nothing. Pinned in Task 3.
3. **Other unsaved edits.** Opening, saving or publishing one layout never stages or pushes anything else: not documents' pages, and not other people's working-tree edits to layouts. Pinned in Task 4.
4. **Preview isolation.** The preview never writes into the site directory. A build error in the preview shows as text in the pane and never breaks the editor. Pinned in Task 5.
5. **Correct-only.** A layout that isn't correct can't be opened or saved, and an editor round trip never loses a component's inner HTML, a comment, or an inline script or style. Pinned in Tasks 1 and 7.

## Rulings made while planning (deviations from the spec's text)

- **P1. Save writes the file but does not commit it. Publish commits the layout files VP wrote and pushes them.**
  - Git can't hold back one commit while the regular backup pushes the others.
  - Backups never stage `src/layouts/` or `src/includes/`, so saved but unpublished edits stay in the working tree.
  - The `Not published` marker means the file differs from HEAD (`git status`).
  - *Cost if wrong:* saved layouts aren't backed up to GitHub until they are published.
- **P2. The preview is served by a small per-site static server on a free port,** not by a VP route.
  - Built pages link `/assets/...` from the site root, which can't work under a sub-path.
  - The server binds to 127.0.0.1 and serves the working copy's `dist/` with `Access-Control-Allow-Origin: *`, because the sandboxed iframe has a null origin and loads module scripts.
  - *Cost if wrong:* one more local port per site with an open layout editor.
- **P3. The preview working copy lives under VP's config directory,** at `<configDir>/layout-preview/<siteId>/` (`configDir` from `src/app/registry.js`). Nothing is written in the site's `.vp/`.
  - *Cost if wrong:* disk use outside the site.
- **P4. "Used by" counts pages,** with the label `Used by N pages` everywhere.
  - The spec said "posts" in one place and "pages" in another. `layoutUsage` counts pages and layouts.
  - *Cost if wrong:* the wording.
- **P5. The draft being previewed is written into the working copy** as `src/vp-layout-preview.html`, a root file so it belongs to no collection.
  - Its front matter and body come from the same function `syncDocument` uses to compose a page.
  - *Cost if wrong:* a site whose root pages are a collection would list it. That doesn't happen in Cook.

---

## Phase 1: Cook

### Task 1: Layout tree: `parseLayout` and `serializeLayout`

**Files:**
- Create: `scripts/utils/layouts/tree.js` (parse), `scripts/utils/layouts/serialize.js`
- Modify: `scripts/layouts.js` (exports)
- Test: `test/layout-tree.test.js`
- Fixtures:
  - copy thomasapowell.com's seven layouts read-only into `test/fixtures-layouts/tap/`;
  - read the starter set from `starters/vanilla-breeze/src/`.

**Interfaces:**
- Consumes: `parseLayoutSource`, `childrenOf`, `checkLayout` (2.8.0); `stripInfo`, `findTemplatedTag`, `templateDataAttrs` from `render.js`.
- Produces:
  - `parseLayout(html: string, { fragment?: boolean, fields?: string[], lists?: string[] }) → { ok: boolean, tree: LayoutTree|null, problems: Array<{ line, message }> }`. `tree` is null unless `checkLayout` passes.
  - `serializeLayout(tree: LayoutTree) → string`
- Tree shape, used verbatim by later tasks:
  ```
  LayoutTree = { kind: 'base'|'child'|'fragment', info: Info|null, parent: string|null,
                 vars: Array<[name, value]>,        // child <body> data-* except data-template / data-page-layout
                 pageLayout: string|null,           // base: data-page-layout on <body> (a VB value or '${pageLayout}'); child: its own value
                 htmlAttrs: Array<[name, value]>,   // base <html> attributes (e.g. lang)
                 head: HeadItem[],                  // base only
                 body: Block[],                     // base: body children; child: body blocks except slot templates; fragment: all
                 slots: Array<{ name, attrs, if?, unless?, body: Block[] }> }   // child <template slot> pieces, in order
  Info     = { format: 1, label: string, description?: string, abstract?: boolean, slots: Record<string, { label: string }> }
  HeadItem = { tag: 'title'|'meta'|'link'|'script'|'style'|'base', attrs, text?: string, if?, unless? } | { slot: 'head' }
  Block    = Common & (
      { type: 'content' } | { type: 'slot', name }
    | { type: 'text', tag, inline: Inline[] }
    | { type: 'image', tag: 'img'|'picture', html?: string }        // picture keeps its <source>s verbatim in html
    | { type: 'container', tag, body: Block[] }                    // regions, sectioning, header/footer, layout-*, div[data-layout], figure
    | { type: 'menu', tag: 'ul'|'ol'|'menu', items: Array<Common & { inline?: Inline[], body?: Block[] }> }
    | { type: 'include', path } | { type: 'component', tag, html } | { type: 'comment', text } )
  Common   = { attrs: Array<[name, value]>, if?: string, unless?: string,
               repeat?: { source: string, pipes: string[], alias: string, index?: string } }
  Inline   = { text: string } | { field: string } | { tag, attrs, inline: Inline[] } | { tag: 'br'|'img', attrs }
  ```
- Canonical serialization (spec, "Canonical form"):
  - two-space indent, one block per line;
  - the info block first, as pretty JSON with 2-space indent;
  - attribute order is `data-template`, `data-page-layout`, then the rest in their tree order, then `data-repeat`, `data-if`, `data-unless`;
  - double-quoted values;
  - text blocks on one line;
  - component `html`, comments, and inline script and style text are kept byte-for-byte.
  - Fragments start with `<!-- layout-fragment -->`.

- [ ] **Step 1: Write failing tests**
  - For each starter layout and include, and each `tap/` layout:
    - `parseLayout(src).ok` is true;
    - `parseLayout(serializeLayout(tree)).tree` deep-equals `tree`;
    - `checkLayout(serializeLayout(tree)).ok` is true.
  - `serializeLayout` is idempotent: serializing the reparsed tree gives an identical string.
  - A layout whose component holds `<template shadowrootmode="open"><p>x</p></template>`, plus a comment and an inline `<style>` with `a>b{}`, keeps all three byte-for-byte (**Review Focus 5**).
  - `${post.title}` inside a repeated `li` parses as `{ field: 'post.title' }`, and `repeat` is `{ source: 'collections.blog', pipes: ['limit:3'], alias: 'post' }`.
  - A plain layout gives `{ ok: false, tree: null }`, and so does a layout with problems; the problems are passed through.
  - **Review Focus 1, build equality:** copy `starters/vanilla-breeze` into tmp. Build it, then replace every layout and include with its serialized form and build again. Every `dist` HTML file is equal after collapsing whitespace between tags.
- [ ] **Step 2:** `node --test test/layout-tree.test.js` fails because the module is missing.
- [ ] **Step 3: Implement.** Walk the linkedom DOM that `parseLayoutSource` returns, block by block, following `check.js`'s classification. Reuse its helpers rather than duplicating the vocabulary.
- [ ] **Step 4:** the file passes, `npm test` is green, and the regression gate is unaffected (no build path changed).
- [ ] **Step 5: Commit** `feat(layouts): layout tree, parseLayout and serializeLayout`.

### Task 2: `layoutUsage`, docs, 2.9.0

**Files:**
- Create: `scripts/utils/layouts/usage.js`
- Modify: `scripts/layouts.js`, `docs-site/src/docs/layouts.md` (a section on the tree and on these exports for tool authors), `package.json` (`2.9.0`)
- Test: `test/layout-usage.test.js`

**Interfaces:**
- `layoutUsage(siteDir) → Promise<{ pages: Record<string, string[]>, layouts: Record<string, string[]> }>`
  - `pages[name]` lists site-relative paths of pages in `src/` that use layout `name`: HTML front matter `layout:`, markdown front matter `layout:` (or the markdown default layout from `config/main.js`), or `data-template` on `<html>`/`<body>`.
  - `layouts[name]` lists the layouts whose `data-template` names `name`.
  - It skips `src/layouts`, `src/includes`, `src/components` and program folders.
  - It never throws: unreadable files are skipped.

- [ ] **Step 1: Write failing tests**
  - On a temp site:
    - a front-matter HTML page and a markdown page on `post`;
    - a `data-template="page"` page;
    - a child `post` of `base`;
    - a page inside `src/layouts/`, which is ignored.
  - Assert both maps exactly.
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3: Implement,** then update the docs and set the version.
- [ ] **Step 4:** the tests pass, `npm test` is green, and the docs-site builds.
- [ ] **Step 5: Commit** `feat(layouts): layoutUsage; docs; 2.9.0`.

## Phase 2: VP server

### Task 3: Layout routes: list, read, save, create, duplicate, delete

**Files:**
- Create: `src/app/layout-store.js`
- Modify: `src/app/site-layouts.js` (export the Cook loader), `src/app/server.js` (routes beside the other `${prefix}` routes), `app/assets/js/app-api.js` (client calls)
- Test: `test/app/layout-store.test.js`, plus route tests in `test/app/`

**Interfaces:**
- Consumes: Cook `parseLayout`, `serializeLayout`, `layoutUsage`, `listLayouts`, `checkLayout` (Tasks 1–2), loaded from the site via `importCook(siteDir)`, which you export from `site-layouts.js`.
- Produces (`layout-store.js`). `kind` is `'layout' | 'include'`, `name` matches the global pattern, and `hash` is the sha1 of the file text:
  - `listLayoutFiles(siteDir) → Promise<{ supported: boolean, message: string|null, layouts: Entry[], includes: Entry[] }>`
    - `Entry = { name, kind, label, status: 'editable'|'problems'|'plain', problems, parent, baseFor: string[], usedBy: string[], unpublished: boolean }`.
    - `usedBy` comes from `layoutUsage().pages`; `baseFor` from `.layouts`.
    - `unpublished` is true when `git status --porcelain -- <file>` is non-empty.
    - `supported` is false, with the exact old-Cook message, when the site's Cook lacks `parseLayout`.
  - `readLayoutFile(siteDir, kind, name) → Promise<{ tree, hash, problems }>`. It throws `LayoutError(409, 'not editable', { problems })` unless the entry is editable.
  - `saveLayoutFile(siteDir, kind, name, { tree, hash }) → Promise<{ hash }>`
    - It serializes the tree, then checks it with `listLayouts`-equivalent site names. A failed check throws `LayoutError(422, …, { problems })`.
    - It re-reads the file and compares hashes. A mismatch throws `LayoutError(409, "This layout changed on disk since you opened it")` (**Review Focus 2**).
    - It then writes atomically (`writeFileAtomic` from `src/sync/`).
    - A null `hash` means the file must not exist yet; if it does, that's a 409.
  - `createLayoutFile(siteDir, { kind, name, label, start: { type: 'child'|'copy'|'blank', from? } }) → Promise<{ name, hash }>`
    - `child`: info `{ label, slots: {} }`, `parent: from`, and `pageLayout` set to the parent's when the parent's is `'${pageLayout}'`, else null. The body is `[ { type: 'content' } ]`.
    - `copy`: the `from` tree with info.label set to the new label.
    - `blank`: a base with header, `main > content` and footer, `pageLayout: 'stack'`, and the head with charset, viewport and `<title>${title}</title>`.
    - An existing name is a 409.
  - `deleteLayoutFile(siteDir, kind, name) → Promise<void>`. If `usedBy` or `baseFor` is non-empty, it throws `LayoutError(409, 'in use', { usedBy, baseFor })`.
- Routes, under `/api/sites/:id`:
  - `GET /layout-files`
  - `GET /layout-files/:kind/:name`
  - `PUT /layout-files/:kind/:name` with body `{ tree, hash }`
  - `POST /layout-files` with body `{ kind, name, label, start }`
  - `DELETE /layout-files/:kind/:name`
  - Rules for all of them:
    - `LayoutError` maps to its status with `{ error, ...body }`.
    - A bad name or kind gives 400.
    - No other path input is accepted.
    - Writes go through the server's existing document write lock (`writes(...)`, as in `theme-routes.js`).

- [ ] **Step 1: Write failing tests,** on a temp site linked to `~/src/cook` and holding a copy of the starter layouts:
  - the list shows statuses, `usedBy`, `baseFor`, and `unpublished` after a save in a git-initialised temp site;
  - reading a plain layout gives 409;
  - a save round trip;
  - a hand edit between read and save gives 409 with the exact message, and the file is unchanged (**Review Focus 2**);
  - a save whose tree fails the check gives 422 and nothing is written;
  - all three create starts, and a duplicate name;
  - deleting a used layout gives 409 naming the users; deleting an unused one removes the file;
  - names `../x`, `a/b` and `.x` give 400;
  - an old Cook (stub without `parseLayout`) gives `supported: false` with the message.
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** the tests pass and `npm test` is green.
- [ ] **Step 5: Commit** `feat(layouts): layout file routes (list, read, save, create, duplicate, delete)`.

### Task 4: Publish layout

**Files:**
- Modify: `src/app/site-git.js` (add `LAYOUT_PATHS = ['src/layouts', 'src/includes']` and a `layoutMessage(labels)` helper), `src/app/layout-store.js`, `src/app/server.js`
- Test: `test/app/layout-publish.test.js`

**Interfaces:**
- `publishLayouts(ws, { backup, deps, names: Array<{ kind, name }> }) → Promise<{ status: 'pushed'|'saved', sha }>`
  - It runs inside `backup.exclusive(...)`, like Theme Apply.
  - It stages exactly the given files (`deps.commitPaths(siteDir, paths, message)`).
  - The message is `Layout: <label, label>`. It never carries `[CI Skip]`, because layouts change the live site.
  - Then it pushes.
- Route: `POST /api/sites/:id/layout-files/publish` with body `{ files: Array<{ kind, name }> }`. An empty list means every unpublished file VP can see.

- [ ] **Step 1: Write failing tests,** using the git helpers the existing site-git tests use:
  - publishing one saved layout commits only that file and pushes;
  - an unrelated hand-edited layout in the working tree, and a dirty document page, stay unstaged (**Review Focus 3**);
  - a backup flush after a layout save does not stage the layout;
  - a push failure surfaces as in Theme Apply, with the commit kept and counted as unpushed.
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** the tests pass and `npm test` is green.
- [ ] **Step 5: Commit** `feat(layouts): publish layouts (commit and push the files VP saved)`.

### Task 5: Preview working copy and preview server

**Files:**
- Create: `src/app/layout-preview.js`
- Modify: `src/sync/to-site.js` (export `pageHtml(doc, { layout, mediaAlt })`, which `syncDocument` then uses), `src/app/server.js` (route, plus closing preview servers on app close)
- Test: `test/app/layout-preview.test.js`

**Interfaces:**
- `createLayoutPreview({ site, configDir, spawn?, freePort? })` returns these methods (one instance per site, created lazily):
  - `render({ layouts?: Record<name, string>, includes?: Record<name, string>, doc?, layout }) → Promise<{ ok: true, url } | { ok: false, log }>`
    - It mirrors the site's `src/`, `config/`, `plugins/` and `package.json` into `<configDir>/layout-preview/<siteId>/`. Unchanged files are skipped by size and mtime, and files gone from the site are deleted.
    - It symlinks `node_modules` and writes the overrides into the copy.
    - It writes `src/vp-layout-preview.html` from `pageHtml(doc, { layout })`. With no doc, it writes a sample: title `Sample page`, description `A sample page for previewing layouts.`, and a paragraph.
    - It runs `node <site>/node_modules/cook-ssg/bin/cook.js build` in the copy with `NODE_ENV=production`.
    - It returns the URL `http://127.0.0.1:<port>/vp-layout-preview/`.
    - Builds are serialized, and only the latest request's result is used.
  - `close()`
  - The static server binds to 127.0.0.1 on a free port. It serves the copy's `dist/` with `Access-Control-Allow-Origin: *` and `Cache-Control: no-store`. It refuses `..`.
- Route: `POST /api/sites/:id/layout-preview` with body `{ layouts, includes, docId?, layout }` returns `{ ok, url }` or `{ ok: false, log }`.

- [ ] **Step 1: Write failing tests,** on a temp site with the starter set and Cook linked:
  - rendering with a changed `post` override returns a URL whose page contains the override's marker;
  - the site directory's file list and mtimes are unchanged after render (**Review Focus 4**);
  - a broken override (a layout chain cycle) gives `{ ok: false, log }` mentioning the chain;
  - a second render after deleting a site file removes it from the copy;
  - a request for `/../` is refused.
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** the tests pass and `npm test` is green.
- [ ] **Step 5: Commit** `feat(layouts): layout preview working copy and server`.

## Phase 3: VP Layouts screen

### Task 6: The Layouts section

**Files:**
- Modify: `app/site.html` (rail entry and section), `app/assets/js/site-nav.js` (`SECTIONS`), `app/assets/js/site-page.js` (lazy `initLayoutsSection`)
- Create: `app/assets/js/layouts-page.js` (DOM), `app/assets/js/layouts-view.js` (pure model)
- Test: `test/app/layouts-view.test.js`, `test/app/layouts-page-dom.test.js`

**Interfaces:**
- `layoutRows(listing) → Array<{ name, kind, label, fileName, statusText, problems, usedText, relationText, unpublished, canOpen, canDelete, deleteBlockedText }>`. It uses the exact copy, with singular and plural forms of `Used by`.
- The page renders layouts, then includes, each with Open (when `canOpen`), Duplicate, Delete, `Show all problems`, the `Not published` marker, and `Publish layout` (shown when anything is unpublished).
- **New layout** is a dialog (not a browser prompt). It has a label field, a name field derived from the label and editable (pattern-checked), and a start select listing `Built on <label>` for each layout, `Copy of <label>` for each editable layout, and `Blank base`.
- Open navigates to `/editor/layout.html?site=<id>&kind=<kind>&name=<name>`.
- `Publish layout` first shows, in a dialog (not a browser confirm), each unpublished file with its `Used by N pages` and `Base for: …` text. It asks to confirm when any file is used. Then it calls the publish route and shows the result.
- An unsupported listing shows the old-Cook message and a read-only list.

- [ ] **Step 1: Write failing tests:**
  - the model's copy for each status;
  - `Used by 1 page` and `Used by 3 pages`;
  - `Base for: post, essay`;
  - the delete-blocked text names the users;
  - the DOM test covers create, Delete refusal and the Publish button visibility.
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** the tests pass and `npm test` is green.
- [ ] **Step 5: Commit** `feat(layouts): Layouts screen`.

## Phase 4: VP layout editor

### Task 7: Layout schema and tree ↔ ProseMirror conversion

**Files:**
- Create: `editor/assets/js/layout-editor/schema.js`, `editor/assets/js/layout-editor/convert.js`
- Test: `test/editor/layout-convert.test.js`

**Interfaces:**
- `layoutSchema`, a ProseMirror schema with one node type per tree block type:
  - `region` (base body containers whose tag is in `header nav main aside footer`);
  - `container`, `text` (inline content with a `field` atom and marks for `a`/`strong`/`em`/`span`/`time`/`abbr`/`code`);
  - `image`, `menu`, `menu_item`, `include`, `component`, `comment`, `content`, `slot_ref`, `slot_piece` (child `<template slot>`);
  - `Common` stored as node attrs `{ attrs, if, unless, repeat }`.
  - Atoms: `content`, `slot_ref`, `include`, `component`, `comment`, `image`.
  - Content expressions enforce the format's nesting. For example, `menu` holds `menu_item+`, and base `doc` holds `region|include`.
- `treeToDoc(tree, schema) → { doc, meta }`. `meta` holds `kind`, `info`, `parent`, `vars`, `pageLayout`, `htmlAttrs` and `head`, which live outside ProseMirror.
- `docToTree(doc, meta) → LayoutTree`. `info.slots` is recomputed from the `slot_ref` nodes (labels from their attrs) (spec, "my call").

- [ ] **Step 1: Write failing tests:**
  - For every starter and `tap/` fixture tree (from Cook Task 1, read through the linked Cook), `docToTree(treeToDoc(tree))` deep-equals `tree`, apart from `info.slots` key order (**Review Focus 5**).
  - Inline marks and field atoms survive.
  - Adding a `slot_ref` named `extra` with label `Extra` adds `info.slots.extra`.
  - Deleting a `slot_ref` removes it from `info.slots`.
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** the tests pass and `npm test` is green.
- [ ] **Step 5: Commit** `feat(layout-editor): schema and tree conversion`.

### Task 8: The editor page: canvas, palette, header bar, save

**Files:**
- Create:
  - `editor/layout.html` (the same import map and VB assets as `editor/index.html`);
  - `editor/assets/js/layout-editor/main.js`;
  - `editor/assets/js/layout-editor/views.js` (NodeViews: labelled boxes);
  - `editor/assets/js/layout-editor/palette.js` (valid items at the selection, from the schema's content match);
  - `editor/assets/css/_layout-editor.css`.
- Modify: `editor/assets/js/components/block-palette.js`, only if needed so it accepts an item list from its caller (keep the post editor's behaviour; the post editor's existing tests must still pass).
- Test: `test/editor/layout-palette.test.js`, `test/editor/layout-editor-dom.test.js`

**Interfaces:**
- The canvas renders the exact labels:
  - regions show their name (`Header`, `Main`, `Sidebar` for aside, `Section menu` for a nav with `aria-label="Section"`, otherwise `Navigation`, and `Footer`);
  - `Document body goes here`;
  - `Region: <label>`;
  - lists show `Repeats for each <alias> in <source>` (` (<limit>)`);
  - include and component tiles show the path or tag.
- Fields render as tokens: document fields by their name in Title Case (`Title`, `Date`, `Image alt`), and item fields as written (`post.title`).
- The palette (the `/` menu) offers only the blocks the schema allows at the caret. Drag handles move blocks only to valid places.
- The header bar has:
  - `label` and `description` inputs;
  - the page-structure select: the VB values, plus `Chosen by layouts built on this one` for a base, which means `'${pageLayout}'`;
  - an `Abstract` toggle (base only);
  - `Head` (Task 10) and `Save`.
- Save:
  - `PUT` with the hash it opened with.
  - On 409 it shows the exact message with `Reload`.
  - On 422 it lists the problems.
  - On success it stores the new hash.
- It guards unsaved changes on leaving the page (the same mechanism the post editor uses), and keeps undo history (`prosemirror-history`).

- [ ] **Step 1: Write failing tests:**
  - the palette at a caret inside `main` of a base offers text and container blocks but not `region`;
  - inside a `menu` it offers only `menu_item`;
  - DOM: opening the starter `post` shows `Region: Sidebar` and `Document body goes here`;
  - editing the label and saving sends a tree whose `info.label` changed;
  - a 409 response shows `This layout changed on disk since you opened it` and `Reload`.
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** the tests pass and `npm test` is green.
- [ ] **Step 5: Commit** `feat(layout-editor): editor page, canvas, palette and save`.

### Task 9: Inspector

**Files:**
- Create: `editor/assets/js/layout-editor/inspector.js`, `editor/assets/js/layout-editor/inspector-model.js` (pure)
- Test: `test/editor/layout-inspector.test.js`

**Interfaces:**
- `inspectorFields(node, context) → Array<Field>`, where `context = { siteFields, documentFields, declaredFields, lists, components }`. By node:
  - text: tag (`h1`–`h6`, `p`, `small`, `figcaption`, `blockquote`);
  - container: tag, the VB layout element or `data-layout` value, and its attributes (gap, ratio…);
  - every block:
    - `repeat`: the source picks from `lists` (`collections.*`, `programs`, `programAreas.*`, data arrays), plus `limit`, `offset` and `alias`;
    - `Show only when`: field or `slot:<name>`, with `data-if` / `data-unless`;
    - `id`, `class` and `aria-label`;
  - component: its attributes, from VB's `custom-elements.json` when known (reuse `src/components/` manifest helpers through the existing editor component loader), otherwise raw name/value pairs;
  - field atom: a key picker (document, site and declared fields, plus item fields inside a repeat).
- `applyField(node, field, value) → attrs` updates the node through a ProseMirror transaction.
- The context comes from a new route, `GET /api/sites/:id/layout-files/context`, which returns `{ siteFields, declaredFields, lists }` from Cook's `loadSiteNames` and the collections config. `documentFields` is Cook's `DOCUMENT_FIELDS`.

- [ ] **Step 1: Write failing tests:**
  - the field lists for a text node, a repeated `li` and a component with a known manifest;
  - setting the repeat source and limit gives `repeat: { source, pipes: ['limit:5'], alias }`;
  - `Show only when` with `slot:aside` sets `if: 'slot:aside'`;
  - an item-field key is offered only inside a repeat.
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** the tests pass and `npm test` is green.
- [ ] **Step 5: Commit** `feat(layout-editor): inspector`.

### Task 10: Head dialog and preview pane

**Files:**
- Create: `editor/assets/js/layout-editor/head-dialog.js`, `editor/assets/js/layout-editor/preview-pane.js`
- Test: `test/editor/layout-head.test.js`, `test/editor/layout-preview-pane-dom.test.js`, plus a scratchpad browser check (not committed)

**Interfaces:**
- **Head dialog** (base only):
  - It lists `meta.head` items in order with add, edit, reorder and remove. The tags are those in `HeadItem`.
  - Text and attribute values accept field placeholders.
  - The `${slot:head}` item can be added once and is shown as `Region: Head`.
  - Inline `script`/`style` bodies are edited in a plain textarea.
- **Preview pane:**
  - An iframe with `sandbox="allow-scripts"` (never `allow-same-origin`) and `referrerpolicy="no-referrer"`.
  - The document select defaults to the most recent document whose effective layout is this one, otherwise the most recent post, otherwise `Sample page`.
  - It has `Desktop` and `Narrow` width buttons, sized the same as the Theme preview.
  - It re-renders 600 ms after the last edit. It sends the unsaved serialized tree as an override; the client serializes through a `POST /api/sites/:id/layout-files/serialize` route so it uses the site's Cook.
  - A `{ ok: false, log }` result shows the log's last lines as text in the pane, and the editor stays usable (**Review Focus 4**).

- [ ] **Step 1: Write failing tests:**
  - head: adding `meta[name=theme-color]` and the head region updates `meta.head`, and the region can't be added twice;
  - preview DOM:
    - the iframe sandbox is exactly `allow-scripts`;
    - a failed render shows the log text;
    - width buttons switch `data-width`;
    - the debounce sends one request for three quick edits (with fake timers).
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** the tests pass and `npm test` is green.
  - **Browser check** on a temp app with a git-initialised temp site holding the starter set, with Cook linked:
    1. Open Layouts and open `post`.
    2. Change the title heading to `h2` in the inspector, and see the preview update.
    3. Save. The file changes and the Layouts screen shows `Not published`.
    4. Edit the file on disk, then save again. The conflict message appears.
    5. Create `Built on base`, open it, and add a Sidebar region.
    6. Publish to a local bare remote: the commit holds only the layout files.
- [ ] **Step 5: Commit** `feat(layout-editor): head dialog and live preview`.

## Phase 5: Includes

### Task 11: Fragment mode

**Files:**
- Modify: `editor/assets/js/layout-editor/main.js`, `convert.js`, `preview-pane.js`, `app/assets/js/layouts-page.js`
- Test: extend `test/editor/layout-convert.test.js` and `test/editor/layout-editor-dom.test.js`

**Interfaces:**
- `kind=include` opens a fragment tree. Fragment mode has no head, no info block, no page structure and no Abstract; the canvas holds its blocks.
- Saving keeps the `<!-- layout-fragment -->` marker (Cook serializes it).
- The preview renders the most recent document through a layout that includes this include. It finds one by scanning layouts for `data-include="/includes/<name>.html"`, and falls back to the first non-abstract layout.
- Plain includes are listed but can't be opened.

- [ ] **Step 1: Write failing tests:**
  - the starter `site-nav` round-trips through convert;
  - the fragment-mode header bar hides `Head`, `Abstract` and the structure select;
  - the preview layout choice for `site-nav` is a layout that includes it.
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** the tests pass and `npm test` is green.
- [ ] **Step 5: Commit** `feat(layout-editor): edit includes`.

---

## After the last task

- Run a final whole-branch review across both repos.
- Report to the user:
  - the rulings P1–P5 and the ledger rulings;
  - that nothing is pushed or published;
  - that sites need Cook 2.9.0 for editing, which is unpublished until the user OKs it.
- Merge locally only when the user asks.
