# Vanilla Press: Per-Site Workspace and Export to Cook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vanilla Press edits the content of one Cook site at a time and
exports it as files Cook already understands. Its own site generator goes
away.

**Architecture:**
- A **workspace** (`src/workspace/`) resolves every path from a site
  directory: the store at `<site>/.vp/content.db`, media in
  `<site>/src/media/`, JSON in `<site>/content/`, pages in `<site>/src/`.
- An **export** module (`src/export/`) turns one document into its JSON
  source file and, when published, a front-matter HTML page. It tracks what
  it wrote in a manifest and refuses to overwrite newer JSON.
- A **sync** step imports newer JSON into the store.
- The API, server and CLI call these after every document change.

**Tech Stack:** Node ESM, better-sqlite3, `node:test`; `cook-ssg@^2.4.0` as a
devDependency for the end-to-end test only.

**Spec:** `docs/superpowers/specs/2026-11-01-vp-drives-cook-blog-design.md`
(sections "Vanilla Press: one workspace per site, export instead of publish"
and "Anti-goals")

## Global Constraints

- **Where the site path comes from:** `--site <path>` or the `VP_SITE` env
  var. Without a site, Vanilla Press runs in **fixture mode**: the repo's own
  `content.db` and `media/`, and **export disabled**. Demo content is never
  exported anywhere.
- **Workspace paths:**
  - store: `<site>/.vp/content.db`
  - media: `<site>/src/media/<file>`
  - JSON: `<site>/content/<collection>/<slug>.json`
  - pages: `<site>/src/<path>/<slug>.html`
  - manifest: `<site>/content/.vp-manifest.json`
  - media metadata: `<site>/content/media.json`
  - VP settings: `<site>/config/vp.json`
- Vanilla Press never writes or deletes any other file in the site. Removals
  only touch paths recorded in the manifest.
- **Collection output config** (`config` table key `collections`, JSON):
  - default for a collection `c`: `{ path: c, layout: 'post' }`
  - default for `pages`: `{ path: '', layout: 'page' }`
- **Statuses:** `published` gets an HTML page. `draft` and `archived` get
  JSON only, and any HTML page is removed.
- **Front matter keys, in this order:** `title`, `description`, `date`,
  `published`, `updated`, `author`, `tags`, `layout`, `slug`. Omit a key
  whose value is empty.
  - `date` is the **local calendar day** (`YYYY-MM-DD`) of `meta.published`
    (falling back to `meta.created`).
  - `published` and `updated` are the full ISO strings.
  - Strings are written with `JSON.stringify` (valid YAML double-quoted
    scalars).
  - `tags` is a flow sequence (`["a","b"]`).
- **HTML body:** `render(doc, { scope: 'content', bare: true })`. The site
  layout supplies `<article>`.
- **All writes are atomic:** write `<file>.tmp-<pid>`, then rename.
- **Conflicts, decided by a hash rather than timestamps:**
  - Why not timestamps: a local save is always newer than a file pulled from
    another machine, so comparing `updated` would silently overwrite the
    pulled edit.
  - The manifest records a sha1 of every JSON it wrote (`jsonHash`). A JSON
    file whose current hash differs from the manifest, or which exists with
    no manifest entry, **changed on disk**, and the file wins:
    - the API checks this **before** saving to the store, and returns `409`
      `{ error, path }` without saving;
    - the editor offers "Load the version on disk";
    - startup sync imports changed files.
  - This is a refinement of the spec's "the JSON files win" rule. It keeps
    the spec's intent and fixes the timestamp hole.
- **Rendering is deterministic:** the same document gives byte-identical
  HTML.

## Review Focus

- **A rename (slug or collection change) of a published post.** Expected:
  the old HTML and JSON are removed, the new ones written, and the manifest
  updated. Test in Task 3.
- **The site was `git pull`ed with an edited JSON while the editor is
  running, and the local copy was then edited.** Expected: the next save
  returns 409 and the store is not changed. "Load the version on disk"
  brings in the pulled version. A restart's sync also brings it in. Test in
  Tasks 3, 4 and 5.
- **A title or description with quotes, a colon, `---` or a newline.**
  Expected: the front matter still parses with gray-matter and round-trips
  the exact string. Test in Task 2.
- **A manifest entry pointing at a file the user deleted by hand.** Expected:
  the removal is a no-op, not a crash. Test in Task 3.
- **Two published documents with the same output path** (for example
  `pages/about` exporting to the root while `src/about.html` is hand-written).
  Expected: export refuses to overwrite a file it doesn't own, with a clear
  error. Test in Task 3.

---

### Task 1: Workspace resolution and fixture mode

**Files:**
- Create: `src/workspace/workspace.js`
- Modify: `src/server/index.js` (`startServer` options and `--site` arg),
  `src/cli/run.js` (`openDb` → workspace; a global `--site` flag)
- Test: `test/workspace/workspace.test.js`

**Interfaces:**
- Produces:
  - `resolveWorkspace({ site?: string, env?: object, repoRoot: string }): Workspace`,
    where `Workspace = { siteDir: string|null, dbPath, mediaDir, contentDir, srcDir, configDir, exportEnabled: boolean }`.
    - `site` overrides `env.VP_SITE`.
    - With no site: `siteDir` is null, `dbPath` and `mediaDir` are the repo's
      `content.db` and `media/`, `exportEnabled` is false, and the other dirs
      are null.
    - A `site` that doesn't exist throws `Error('Site directory not found: <path>')`.
  - `openWorkspaceDb(ws): Database`: creates `.vp/` if needed, opens the
    database and runs `migrate`.

- [ ] **Step 1: Write the failing tests**:
  - With no site: `exportEnabled === false` and `dbPath` ends with
    `/content.db` under `repoRoot`.
  - With `site: tmp`: `dbPath === tmp + '/.vp/content.db'`,
    `mediaDir === tmp + '/src/media'`, and so on, with
    `exportEnabled === true`.
  - `env.VP_SITE` is used when `site` is absent, and `site` beats `env`.
  - A missing directory throws, and the message names the path.
  - `openWorkspaceDb` creates `<tmp>/.vp/content.db` with a `documents`
    table.
- [ ] **Step 2:** Run `node --test test/workspace/workspace.test.js`.
  Expected: FAIL, module not found.
- [ ] **Step 3:** Implement. In `startServer(options)`, accept
  `options.site`, resolve the workspace, use `ws.dbPath` and `ws.mediaDir`,
  and pass `ws` to `mountApi(router, db, { rootDir: ROOT, mediaDir: ws.mediaDir, workspace: ws })`.
  The server's `--site` arg uses `parseArgs`. The CLI's `openDb()` uses the
  workspace from `--site` / `VP_SITE`.
- [ ] **Step 4:** Run `npm test`. Expected: all pass. Existing tests use
  fixture mode because they set no site.
- [ ] **Step 5: Commit** `feat: per-site workspace (--site / VP_SITE), fixture mode without one`

---

### Task 2: Front matter and output paths (pure)

**Files:**
- Create: `src/export/front-matter.js`, `src/export/paths.js`
- Test: `test/export/front-matter.test.js`, `test/export/paths.test.js`
- Modify: `package.json`. Add devDependency `gray-matter` (test-only, to
  verify the YAML parses); Cook uses the same parser.

**Interfaces:**
- Produces:
  - `frontMatter(doc, { layout: string }): string`. Returns `---\n...\n---\n`
    with keys in the Global Constraints order.
  - `localDay(iso: string): string`. Returns `YYYY-MM-DD` in the process's
    local timezone.
  - `collectionOutput(collection: string, collectionsConfig?: object): { path: string, layout: string }`
  - `outputPaths(doc, collectionsConfig?): { json: string, html: string|null }`.
    Paths are relative to the site dir, e.g.
    `{ json: 'content/posts/hello.json', html: 'src/posts/hello.html' }`.
    For pages: `src/about.html`. `html` is `null` unless
    `doc.meta.status === 'published'`.

- [ ] **Step 1: Write the failing tests**:
  - `frontMatter` for a full doc gives exactly
    `---\ntitle: "Hello"\ndescription: "D"\ndate: "<localDay>"\npublished: "<iso>"\nupdated: "<iso>"\nauthor: "tp"\ntags: ["a","b"]\nlayout: "post"\nslug: "hello"\n---\n`.
  - Empty values are omitted.
  - **Round-trip:** for titles `He said "hi": yes`, `a\nb`, `--- x` and
    `#hash`, `matter(frontMatter(doc) + '<p>x</p>').data.title === title`.
  - `localDay`: with `process.env.TZ = 'America/Los_Angeles'`,
    `localDay('2026-11-02T05:30:00Z') === '2026-11-01'`. Restore TZ after.
  - `collectionOutput('posts')` deep-equals `{path:'posts', layout:'post'}`.
  - `collectionOutput('pages')` deep-equals `{path:'', layout:'page'}`.
  - A config override wins.
  - `outputPaths`:
    - published post → `src/posts/hello.html`
    - published page → `src/about.html`
    - draft → `html: null`
    - archived → `html: null`
    - `json` is always `content/<collection>/<slug>.json`
- [ ] **Step 2:** Run `node --test test/export/`. Expected: FAIL, modules
  missing.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `node --test test/export/` and then `npm test`.
  Expected: PASS.
- [ ] **Step 5: Commit** `feat(export): front matter and output paths`

---

### Task 3: Export a document (files, manifest, conflicts, removals)

**Files:**
- Create: `src/export/export.js`, `src/export/manifest.js`,
  `src/export/atomic-write.js`
- Modify: `src/renderers/html.js` (`renderTabs`: deterministic group name)
- Test: `test/export/export.test.js`, plus one case added to
  `test/renderers/html.test.js`

**Interfaces:**
- Consumes: `outputPaths`, `frontMatter`, `collectionOutput` (Task 2);
  `Workspace` (Task 1); `render` from `src/renderers/html.js`.
- Produces:
  - `class ExportConflictError extends Error { path }`
  - `changedOnDisk(ws, docId, jsonRelPath): boolean`. True when the JSON at
    `jsonRelPath` exists and either has no manifest entry for `docId` or its
    sha1 differs from the entry's `jsonHash`.
  - `exportDocument(ws, doc, { collectionsConfig }): { written: string[], removed: string[] }`.
    Writes the JSON. If published, writes the HTML. Removes stale paths this
    document owned before. Records `{ json, html, jsonHash }` in the
    manifest, keyed by `doc.id`.
    - Throws `ExportConflictError` when `changedOnDisk` is true for the
      target JSON. A safety net: the API checks first.
    - Throws `Error('Refusing to overwrite <path>: not written by Vanilla Press')`
      when the target HTML exists but isn't in the manifest.
  - `removeExport(ws, docId): { removed: string[] }`. Deletes that
    document's manifest paths (a missing file is a no-op) and its manifest
    entry.
  - `readManifest(ws)` / `writeManifest(ws, manifest)`. The manifest is
    `{ version: 1, documents: { [id]: { json, html, jsonHash } } }`.
  - `recordImported(ws, docId, jsonRelPath): void`. Sets the entry's `json`
    and `jsonHash` to the file's current hash; used by sync.
  - `writeFileAtomic(path, data)`. Creates parent dirs.
  - `renderTabs`: the group name is `ts-<hash>`, where `<hash>` is the first
    6 hex characters of sha1 of the tab labels joined with `\u0000`, plus
    the tab count. Two identical tab blocks in one document may share a
    name; accepted.

- [ ] **Step 1: Write the failing tests** against a temp site
  (`resolveWorkspace({ site: tmp })`), with docs built from
  `test/fixtures/simple-post.json` and overridden `meta`:
  - **Publish** writes `content/posts/<slug>.json` (parsed JSON equal to the
    doc) and `src/posts/<slug>.html`. The HTML starts with the front matter
    and contains the bare rendered body, with no `<article data-doc`.
  - **Draft** writes the JSON only. Exporting a published doc and then the
    same doc as a draft removes the HTML, and `removed` lists it.
  - **Rename:** export, then change the slug, then export. The old JSON and
    HTML are gone, the new ones exist, and the manifest has one entry.
  - **Conflict:** export, then edit the JSON by hand (change the title).
    `changedOnDisk` is true, and exporting again throws
    `ExportConflictError` whose `.path` ends with `.json`, with the file
    unchanged.
    - After `recordImported`, `changedOnDisk` is false and export succeeds.
    - A JSON that exists with no manifest entry also counts as changed.
  - **Foreign file:** with `src/about.html` written by hand, exporting a
    published `pages/about` throws "Refusing to overwrite", and the file is
    unchanged.
  - **Missing file:** `removeExport` after the HTML was deleted by hand
    doesn't throw.
  - **Deterministic:** exporting the same doc twice gives byte-identical
    HTML, using `test/fixtures/ks-components.json`, which has tabs.
  - In `html.test.js`: rendering the tabs block twice gives equal output.
- [ ] **Step 2:** Run `node --test test/export/export.test.js test/renderers/html.test.js`.
  Expected: FAIL.
- [ ] **Step 3:** Implement. Atomic writes go through `writeFileAtomic`.
  Read the conflict check's existing JSON with `JSON.parse`; unreadable JSON
  counts as a conflict.
- [ ] **Step 4:** Run `node --test test/export/ test/renderers/` and then
  `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(export): export one document with manifest, conflicts and removals`

---

### Task 4: Sync from committed JSON (`import:content`)

**Files:**
- Create: `src/export/sync.js`
- Test: `test/export/sync.test.js`

**Interfaces:**
- Consumes: `Workspace`, the store's `saveDocument` / `getDocument` /
  `deleteDocument`.
- Produces:
  - `syncFromContent(ws, db, { replace?: boolean }): { imported: string[], skipped: string[], removed: string[] }`.
    - Reads `content/**/*.json`, but not `media.json` or
      `.vp-manifest.json`.
    - A document is imported when it isn't in the store, or when
      `changedOnDisk` is true for its file.
    - Each import calls `recordImported`.
  - `importOne(ws, db, docId): Object`. Imports that document's JSON
    unconditionally and records it; returns the saved doc. This backs "Load
    the version on disk".
  - With `replace`, store documents with no JSON file are deleted (listed in
    `removed`).
  - Without `replace`, they are kept.
  - A file that fails `validate` is skipped with a warning.

- [ ] **Step 1: Write the failing tests**:
  - New file → imported.
  - A file changed on disk (title edited after export) → imported, and the
    store's title is updated.
  - An unchanged exported file → skipped.
  - `importOne` → the store matches the file and `changedOnDisk` becomes
    false.
  - Without `replace`, a store-only doc is kept; with `replace`, it's
    removed.
  - Invalid JSON content is skipped and doesn't throw.
- [ ] **Step 2:** Run `node --test test/export/sync.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement. Save through the store's `saveDocument` with
  the file's `meta` unchanged.
- [ ] **Step 4:** Run `node --test test/export/` and then `npm test`.
  Expected: PASS.
- [ ] **Step 5: Commit** `feat(export): sync store from committed content JSON`

---

### Task 5: Wire export into the API, server, CLI and editor

**Files:**
- Modify:
  - `src/server/api.js`:
    - document POST, PUT and DELETE
    - `POST /api/publish`
    - media upload
    - `PUT /api/config/:key`
    - new `GET /api/workspace`
  - `src/server/index.js` (sync on startup)
  - `src/cli/run.js` (`export`, `import:content`; `publish`/`unpublish`/
    `delete` export)
  - `editor/assets/js/components/meta-panel.js`
  - `editor/index.html` or `editor-shell.js` (show the site)
- Create: `src/export/site-files.js`. Provides
  `writeMediaJson(ws, db): void` (all media rows → `content/media.json`) and
  `writeVpConfig(ws, db): void` (`{ theme }` → `config/vp.json`).
- Test: `test/server/export-api.test.js`, plus a CLI case in
  `test/cli/run.test.js`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - **API with `workspace.exportEnabled`:**
    - Before saving a document (PUT, and POST with an existing id): if
      `changedOnDisk(ws, id, outputPaths(existing).json)`, respond `409`
      `{ error: 'This document changed on disk (e.g. git pull).', path }`
      **without saving**.
    - After a successful save, call
      `exportDocument(ws, saved, { collectionsConfig })`, where
      `collectionsConfig` is `JSON.parse(getConfig(db,'collections') || '{}')`.
    - New `POST /api/documents/:id/reload` → `importOne`, returning the doc.
    - DELETE calls `removeExport`.
    - `POST /api/publish` re-exports every document, plus `writeMediaJson`
      and `writeVpConfig`, and returns `{ ok, exported: n }`.
    - Media upload writes into `ws.mediaDir` and calls `writeMediaJson`.
    - `PUT /api/config/theme` calls `writeVpConfig`.
  - **API without export:** behaves as today, minus the publisher.
    `POST /api/publish` returns `{ ok: true, exported: 0 }`.
  - `GET /api/workspace` → `{ site: string|null, exportEnabled: boolean }`.
  - **Server:** when export is enabled, `syncFromContent(ws, db)` runs before
    listening, and the counts are logged.
  - **CLI:**
    - `vp export --site <path>`: the same as `POST /api/publish`.
    - `vp import:content --site <path> [--replace]`: calls
      `syncFromContent` and prints the counts.
    - `publish`, `unpublish` and `delete` export when a site is set.
  - **Editor:**
    - The meta panel's publish flow shows "Exported" instead of
      "Building…/Build complete".
    - On a 409 from any save (auto-save included), the editor shows the
      message with a **Load the version on disk** button. The button calls
      reload and then reloads the document. Auto-save pauses for that
      document until the button is used.
    - The sidebar shows `Site: <basename>`, or "Demo content (not
      exported)".

- [ ] **Step 1: Write the failing API tests.** Mount the API against a temp
  site workspace, following `test/server/api.test.js`'s setup.
  - POST a published doc → `src/posts/<slug>.html` exists.
  - PUT status draft → the HTML is gone and the JSON remains.
  - PUT after hand-editing the JSON → 409 with `path`, and GET shows the
    store unchanged. `POST /api/documents/:id/reload` returns the on-disk
    title, and a following PUT succeeds.
  - DELETE → both files gone.
  - Media upload → the file is in `<site>/src/media/`, and
    `content/media.json` lists it.
  - `PUT /api/config/theme` with `amber` → `config/vp.json` deep-equals
    `{theme:'amber'}`.
  - `GET /api/workspace` → `exportEnabled: true`.
  - In fixture mode, POST writes nothing outside the repo and
    `/api/workspace` gives `exportEnabled: false`.
- [ ] **Step 2: Write the failing CLI test.** Run
  `vp import:content --site <tmp>` with one JSON file; then `vp list`
  (same site) shows that doc.
- [ ] **Step 3:** Run `node --test test/server/export-api.test.js test/cli/run.test.js`.
  Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run `npm test`. Expected: PASS.
- [ ] **Step 6: Browser check.** Run `node src/server/index.js --site <tmp site>`.
  In the editor:
  - create a post, publish it, and confirm `src/posts/<slug>.html` appears;
  - unpublish it and confirm the HTML is gone;
  - check the sidebar shows the site.
- [ ] **Step 7: Commit** `feat: editor, API and CLI export to the site on every change`

---

### Task 6: Retire the publisher; end-to-end with Cook

**Files:**
- Delete:
  - `src/build/publish.js` and `src/build/templates.js`
  - the `src/build/` dir if empty
  - `test/build/publish.test.js`
  - the `_site` fallback in `src/server/index.js`
  - the CLI `build`, `deploy` and `_site` serve paths
  - the `build` and `setup` npm scripts that call the publisher (`setup`
    becomes `npm run seed`)
- Modify: `CLAUDE.md` and `README.md`, if present. Add a short "Using
  Vanilla Press with a Cook site" section covering `--site`, the file
  layout, `vp export` and `vp import:content`.
- Modify: `package.json`. Add devDependency `cook-ssg@^2.4.0`.
- Test: `test/e2e/cook-site.test.js`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the failing end-to-end test.** In a temp dir, create a
  minimal Cook site:
  - `config/main.js`:
    `{ buildOnlyPaths:['layouts'], collections:{ html:true }, formats:{ feed:{ collection:'posts' }, json:false, markdown:false, llmsTxt:false } }`
  - `config/data.js`: `{ siteUrl:'https://example.com', siteTitle:'T' }`
  - `src/layouts/post.html` and `src/layouts/page.html`
  - `src/index.html` listing `collections.posts`

  Then:
  - Through `exportDocument`, export two published posts (different
    `published` dates, one with a tabs block) and one draft.
  - Run `node node_modules/cook-ssg/bin/cook.js build` with `cwd` = the
    temp site.
  - Assert:
    - `dist/index.html` lists the two published titles, newest first, and
      not the draft;
    - `dist/feed.xml` has two entries;
    - the post page contains `<tab-set>` and its layout's markup.
- [ ] **Step 2:** Run `node --test test/e2e/cook-site.test.js`. Expected:
  PASS if Tasks 1–5 are right. If it fails, debug before deleting anything.
- [ ] **Step 3:** Delete the publisher files and wiring listed above. Fix
  any imports `npm test` reports.
- [ ] **Step 4:** Run `npm test`. Expected: PASS, with the publisher tests
  gone and everything else green.
- [ ] **Step 5:** Run `grep -rn "publish.js\|templates.js\|_site" src bin editor`.
  Expected: no hits, except the gitignore entry and any doc mention of the
  old preview.
- [ ] **Step 6: Commit** `refactor!: retire the built-in publisher; Cook builds the site`
