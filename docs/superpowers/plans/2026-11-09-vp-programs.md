# Programs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hand-written programs (folders of HTML/CSS/JS) live in
configurable areas of a Cook site. Cook copies them untouched and lists
their cards. Vanilla Press adds, updates, lists, sandboxes, opens and
removes them.

**Architecture:**
- **Cook** gains a built-in programs feature:
  - it reads `config/programs.json`;
  - an "inside a program folder" check that every copying or walking
    pass consults;
  - `programs` / `programAreas` data;
  - `_headers` sandbox rules.
- **Vanilla Press** gains:
  - pure modules in `src/programs/` (config, import, usage, view);
  - routes in `src/app/program-routes.js`;
  - a separate-origin program server for **Open**;
  - a Programs screen.
- **thomasapowell.com** gets a `/programs/` page and two test programs.

**Tech Stack:**
- Node 20+ ESM, `node --test`, no new dependencies.
- Cook: linkedom.
- Vanilla Press: better-sqlite3 and the vanilla JS app (no framework).

**Spec:** `docs/superpowers/specs/2026-11-09-vp-programs-design.md` (in
~/src/vanilla-press). Every task reads the spec section it names.

## Repos and branches

| Repo | Branch | Test command |
|---|---|---|
| `~/src/cook` | `master` (local commits only) | `npm test` |
| `~/src/vanilla-press` | `feat/programs` from `main` | `npm test` |
| `~/src/thomasapowell.com` | `main` (local commits only) | `npm run build` |

## Global Constraints

- **Programs are untouched:** every file under `src/<area>/<slug>/`
  reaches `dist/<area>/<slug>/` byte for byte. Cook never processes
  program folders.
- **Area path:** one lowercase segment, the media slug rules
  (`[a-z0-9]+(-[a-z0-9]+)*`). It may not be `media`, `assets`,
  `layouts` or `includes`, a `buildOnlyPaths` entry, or an existing
  `src/` entry that isn't that area.
- **Program URL:** `/<area>/<slug>/`. The slug uses the same rules and is
  fixed after adding.
- **`config/programs.json` shape:**
  - `{ "areas": [{ "path", "title", "sandbox" }], "programs": [{ "area", "slug", "title", "description", "date", "tags", "image", "listed" }] }`
  - optional program keys: `sandbox`, `previewClass`, `order`;
  - written as 2-space JSON with a trailing newline.
- **Sandbox header value (exact):** `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-pointer-lock allow-modals`
- **Sandboxed iframe attribute (exact):** `sandbox="allow-scripts allow-forms allow-popups allow-pointer-lock allow-modals"`
- **Import limits:**
  - 50 MB total (`52_428_800`), 2,000 files, 25 MB per file (`MAX_BYTES`
    from `src/media/limits.js`);
  - the large note (`LARGE_NOTE`) over 10 MB (`10_485_760`).
- **Import skips:**
  - silently: `.git/`, `node_modules/`, `.DS_Store`;
  - other dotfiles and dot-folders: skipped and listed.
- **Import refuses** the whole copy:
  - symlinks and other non-regular files;
  - paths escaping the folder;
  - names with control characters;
  - names differing only by case;
  - no top-level `index.html`;
  - likely secrets: names `*.pem`, `*.key`, `*.p12`, `id_rsa*`, or any
    file containing `-----BEGIN` … `PRIVATE KEY-----`.
- **Program writes go live:**
  - Every write commits and pushes at once, inside
    `backup.exclusive(() => writes(...))`.
  - Commit messages have **no** `[CI Skip]`: `Programs: <what>`.
  - A new program starts with `listed: false`.
- **Browser rules:**
  - No browser `alert`/`confirm`/`prompt`.
  - CSS uses Vanilla Breeze tokens only.
  - Semantic markup, keyboard and screen-reader use as in the Media
    screen.
- **Commits and outward actions:**
  - Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never push or publish; never touch `~/src/retro-fun` except to read
    and copy demos.
  - Never kill processes you didn't start; never use port 4100.
- **Browser checks:** time-limited Node Playwright scripts only:
  `perl -e 'alarm 120; exec @ARGV' node script.mjs`, importing
  `/Users/tpowell/src/vanilla-breeze/node_modules/playwright/index.mjs`.

## Review Focus

1. **Picked folder wrapper:** a folder chosen with
   `<input webkitdirectory>` arrives with every relative path under the
   folder's own name (`plasma/index.html`). Expected: the single common
   top folder is stripped, so `index.html` is top-level. Pinned in
   Task 8.
2. **Update after the source folder moved or vanished:** expected 422,
   "The source folder … is gone", and the live copy untouched. Pinned in
   Task 8.
3. **Area path that collides** with an existing page (`src/about.html`
   → `about`) or folder (`src/posts`): refused by VP with the reason;
   Cook warns and ignores it. Pinned in Tasks 1 and 3.
4. **File names needing URL encoding** (spaces, `é`, `#`): copied byte
   for byte by Cook and served by the program server at their encoded
   URLs. Pinned in Tasks 2 and 6.
5. **No git repo, or a failed commit or push:** the files stay. The
   response says `committed: false` with a note, like the theme
   library, and nothing is half-installed. Pinned in Task 7.

---

## Cook (`~/src/cook`)

### Task 1: Programs config, data and the program-path check

Spec: "Cook: built-in programs", Card data and Area paths.

**Files:**
- Create: `scripts/plugins/programs.js`
- Modify: `scripts/utils/config/config.js` (add `getPrograms()`, next to `getTheme()`)
- Modify: `scripts/build.js` (call `programsData` right after `htmlCollections`)
- Test: `test/programs.test.js`

**Interfaces:**
- Produces:
  - `getPrograms(): unknown`: parsed `config/programs.json`, or
    `undefined`. Re-read every call. A parse error logs
    `[programs] config/programs.json: <msg>` and returns `undefined`.
  - `normalizePrograms(raw, { srcEntries: string[], buildOnlyPaths: string[], hasIndex: (area, slug) => boolean }) -> { areas: Array<{path,title,sandbox:boolean}>, programs: Array<card & {url:string, sandbox:boolean}>, warnings: string[] }`.
    - Each program has its effective `sandbox`.
    - `programs` keeps every valid card, listed or not.
  - `RESERVED_AREAS = ['media','assets','layouts','includes']`.
  - `programAreaPaths(): string[]`: valid area paths from the current
    config (uses `getPrograms` and `normalizePrograms`).
  - `isInProgram(relPath: string): boolean`.
    - True when `relPath`, relative to `src` or `dist` with `/`
      separators, is inside `<area>/<sub>/` for a configured area.
    - A file directly in `<area>/` is false.
    - The area list is computed once per build, by
      `loadProgramAreas()`, which `programsData` calls.
  - `programsData({ data }) -> Promise<void>` sets:
    - `data.programs`: listed programs whose folder has `index.html`,
      sorted by date descending, then `order` ascending, then title;
    - `data.programAreas`: a null-prototype object keyed by area path,
      each value the same filter for that area.
    - It prints warnings in yellow with a `[programs] ` prefix.

- [ ] **Step 1: Write the failing tests** in `test/programs.test.js`:
  - `normalizePrograms` keeps a valid area and card, with
    `url === '/demos/plasma/'` and `sandbox` inherited from the area.
    `sandbox: true` on the card overrides the area's `false`.
  - Each of these area paths is dropped with a warning that names it:
    - `'Demos'`;
    - `'a/b'`;
    - `'media'`;
    - `'about'` when `srcEntries` has `about.html`;
    - `'posts'` when `srcEntries` has `posts`;
    - `'layouts'` when it's in `buildOnlyPaths`.
  - A card in an unknown area, a bad slug (`'../x'`), or a duplicate
    `area/slug` is dropped with a warning. A non-string tag is dropped
    from `tags`.
  - Same-date ordering: `order: 1` sorts before `order: 2`.
  - `isInProgram`, with area `demos`:
    - `'demos/plasma/index.html'` is true;
    - `'demos/plasma/js/a.js'` is true;
    - `'demos/index.html'` is false;
    - `'demosx/a/b.html'` is false;
    - `'posts/a/index.html'` is false.
  - A build test with the `project()` helper style from
    `test/theme-build.test.js`:
    - `config/programs.json` has area `demos`, two listed cards and one
      unlisted card;
    - `src/demos.html` contains
      `<li data-repeat="programAreas.demos as p"><a href="${p.url}">${p.title}</a></li>`.
    - Expect two `<li>`s, newest first.
    - An unlisted card, or a card whose folder lacks `index.html`, does
      not appear.

- [ ] **Step 2: Run** `node --test test/programs.test.js`. Expected:
  FAIL (module missing).

- [ ] **Step 3: Implement** `programs.js` and `getPrograms`. Use
  `SAFE_ID`-style regexes as in `theme.js` and null-prototype maps
  (`Object.create(null)`). Read `srcEntries` with
  `fs.readdirSync(srcPath)`, stripping `.html` and `.md` extensions.
  Wire `programsData` into `build.js` after `htmlCollections`.

- [ ] **Step 4: Run** `node --test test/programs.test.js`, then
  `npm test`. Expected: all PASS.

- [ ] **Step 5: Commit** `feat: programs setting (config/programs.json) and programs/programAreas data`.

### Task 2: Program folders untouched, `_headers` sandbox rules, docs, 2.7.0

Spec: "Program folders are untouched", the byte-for-byte test, Live
sandbox, Docs.

**Files:**
- Modify: every pass listed in the spec, each skipping paths where
  `isInProgram(rel)` is true:
  - `scripts/plugins/copy-src.js` (copy `.md` inside programs);
  - `process-markdown.js`;
  - `create-dir-from-file.js`;
  - `html-collections.js`;
  - `optimize-images.js` (both the generate scan and `findImages`);
  - `scripts/utils/get-src/get-src.js` (`getSrcFiles`, `getSrcImages`);
  - `scripts/utils/site-pages/site-pages.js` (`collectSitePages`);
  - `generate-sitemap-xml.js`;
  - `fingerprint-assets.js` (neither renames program files nor rewrites
    references inside them);
  - `apply-base-path.js`;
  - the dev single-page rebuild path in `scripts/dev.js` (a change
    inside a program copies the file and runs no page build).
- Create: `programHeaders` in `scripts/plugins/programs.js`.
- Modify: `scripts/build.js` (write `_headers` after `applyBasePath`).
- Create: `docs-site/src/docs/programs.md`.
- Modify: `package.json` version `2.7.0`, `CHANGELOG.md` if present.
- Test: `test/programs-build.test.js`.

**Interfaces:**
- Consumes: `isInProgram`, `normalizePrograms` and `programAreaPaths`
  from Task 1.
- Produces:
  - `programHeaders(programs, existing: string|null) -> string|null`;
  - `null` when no program is sandboxed;
  - otherwise `existing` (if any), then a newline, then one block per
    sandboxed program, in program order:
    ```
    /<area>/<slug>/*
      Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-pointer-lock allow-modals
    ```
  - It covers listed and unlisted programs alike.

- [ ] **Step 1: Write the failing test** `test/programs-build.test.js`.

  The build site:
  - `main.js` sets `basePath: '/base'` and turns fingerprinting on (the
    option name from `docs-site/src/docs/configuration.md`);
  - areas `demos` and `apps`, with list pages `src/demos.html` and
    `src/apps.html`;
  - program `demos/plasma`, unlisted, `sandbox: true`, containing:
    - `index.html` with front matter-like text `---\ntitle: x\n---`;
    - `${x}` and `<div data-include="nav.html"></div>`;
    - `<img src="a.png">`;
    - `page two.html`, so the name has a space;
    - `README.md`;
    - `css/s.css`, `js/a.js` with `` `${1+1}` ``, `a.png` and `é.txt`;
  - program `apps/tool`, `index.html` only, sandbox off;
  - `src/_headers` containing `/*\n  X-Frame-Options: DENY\n`.

  Assertions:
  - every file under `dist/demos/plasma/` and `dist/apps/tool/` equals
    its source byte for byte, and no file was added;
  - no `dist/demos/plasma/page two/` directory exists;
  - the sitemap has no `/demos/plasma` URL;
  - no `_fragment.html` exists under the program;
  - `dist/demos/index.html` is a built page;
  - `dist/_headers` starts with the site's own rule and contains the
    `/demos/plasma/*` block, but no `/apps/tool/*`;
  - a second build with no sandboxed program and no `src/_headers`
    writes no `dist/_headers`.

- [ ] **Step 2: Run** `node --test test/programs-build.test.js`.
  Expected: FAIL, listing the changed files.

- [ ] **Step 3: Implement** the skips, pass by pass, re-running the test
  after each. Add `programHeaders` and write `dist/_headers`.

- [ ] **Step 4: Write `docs-site/src/docs/programs.md`.** Cover:
  - areas;
  - card fields;
  - `programs` and `programAreas` with a `data-repeat` example;
  - the untouched rule;
  - `basePath` needing relative URLs;
  - sandbox and `_headers`, and which hosts read the file.

  Bump the version to `2.7.0`.

- [ ] **Step 5: Run** `npm test`. Expected: all PASS.

- [ ] **Step 6: Commit** `feat: program folders ship untouched; sandboxed programs get _headers rules (2.7.0)`.

---

## Vanilla Press (`~/src/vanilla-press`, branch `feat/programs`)

### Task 3: Programs config module

Spec: "On disk, in the site repo", Area paths, "Card and folder
disagree".

**Files:**
- Create: `src/programs/config.js`
- Test: `test/programs/config.test.js`

**Interfaces:**
- Produces:
  - `PROGRAMS_FILE = 'config/programs.json'`.
  - `class ProgramError extends Error { constructor(status, message, body = {}) }`.
  - `readPrograms(siteDir) -> { areas, programs }`. A missing file gives
    empty arrays. Bad JSON throws `ProgramError(422, 'config/programs.json is not valid JSON: …')`.
  - `writePrograms(siteDir, value)`: the exact format from Global
    Constraints, with keys in the spec's order.
  - `SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`.
  - `checkSlug(s) -> string|null` (an error message, or null).
  - `checkAreaPath(siteDir, path, { areas, buildOnlyPaths = [] }) -> string|null`.
    Messages name the clash, e.g.
    `"about" is already a page on this site (src/about.html).`
  - `cardFromInput(input, { area, slug }) -> { card, errors: string[] }`. Rules:
    - title: 1–120 chars after trim; default from the slug,
      e.g. `div-vaders` → `Div Vaders`;
    - description: ≤ 500 chars;
    - date: `YYYY-MM-DD`, defaulting to the local date;
    - tags: ≤ 10 strings of ≤ 30 chars, trimmed, unique;
    - image: `''` or a `/media/<file>` URL;
    - listed: boolean, default `false`;
    - sandbox: `true`, `false`, or absent, which means the area default;
    - previewClass: absent or `^[a-z][a-z0-9-]*$`;
    - order: absent or an integer.
  - `effectiveSandbox(config, area, slug) -> boolean`.
  - `programsState(siteDir) -> { areas: Array<area & { count }>, programs: Array<card & { url, hasCard, status: 'ok'|'missing-folder'|'no-index' }> }`.
    - Stray folders under an area appear with `hasCard: false`,
      `listed: false` and a default title.
    - `status` checks for the folder and its top-level `index.html`.
  - `buildOnlyPaths(siteDir) -> Promise<string[]>`: imports
    `config/main.js` with a cache-busting query, as `readSiteUrl` does.
    Returns `[]` when it's absent.

- [ ] **Step 1: Write the failing tests:**
  - round-trip `readPrograms`/`writePrograms`, comparing the exact file
    text;
  - every `checkAreaPath` refusal from Global Constraints plus Review
    Focus 3, each asserting its message;
  - the `cardFromInput` defaults and each rule;
  - `programsState` on a temp site with:
    - a carded `ok` program;
    - a card with no folder (`missing-folder`);
    - a stray folder with an index (`hasCard: false`, `ok`);
    - a stray folder without an index (`no-index`).

- [ ] **Step 2: Run** `node --test test/programs/config.test.js`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(programs): config/programs.json model, area and card rules, folder state`.

### Task 4: Import: scan, stage, install, diff

Spec: Security §4 and §5, "Copying is all or nothing".

**Files:**
- Create: `src/programs/import.js`
- Test: `test/programs/import.test.js`

**Interfaces:**
- Consumes: `ProgramError` (Task 3), `MAX_BYTES` (`src/media/limits.js`).
- Produces:
  - `LIMITS = { totalBytes: 52_428_800, files: 2000, fileBytes: MAX_BYTES, largeBytes: 10_485_760 }`.
  - `scanFolder(dir) -> Promise<{ files: Array<{ rel, size }>, skipped: string[], total: number, large: boolean }>`.
    - It walks with `lstat` and does not follow symlinks.
    - Refusals throw `ProgramError(422, message, { refused: rel })`. For
      example, a private key gives
      `This folder has a private key (id_rsa). Programs go live in public, so nothing was copied.`
    - The private-key check reads only files ≤ `fileBytes`, looking for
      `-----BEGIN` followed by `PRIVATE KEY-----` on the same line.
  - `stageFromFolder(siteDir, source) -> Promise<{ tmpDir, scan }>`.
    - The source must be an existing directory. If it's missing:
      `ProgramError(422, 'The source folder <source> is gone or moved.')`.
    - It copies into `<siteDir>/.vp/tmp/<random>/`.
  - `stageFromUpload(siteDir, files: Array<{ rel, data: Buffer }>) -> Promise<{ tmpDir, scan }>`.
    - It strips a single common top folder (Review Focus 1).
    - It applies the same rules as a folder, by staging and then
      scanning.
  - `installStaged(siteDir, tmpDir, area, slug, { replace = false }) -> Promise<void>`.
    - It uses renames only.
    - When not replacing, an existing target is
      `ProgramError(409, '"<slug>" already exists in /<area>/.')`.
    - When replacing:
      1. rename the old folder to `.vp/tmp/<random>-old`;
      2. rename the new one into place;
      3. remove the old folder.

      On failure it renames the old folder back.
  - `diffFolders(currentDir, scan, stagedDir) -> Promise<{ added: string[], changed: string[], removed: string[] }>`:
    compares by size, then by bytes.
  - `scanToken(scan) -> string`: a sha256 of the sorted `rel:size` lines.
  - `clearTmp(siteDir) -> void`: removes `.vp/tmp/`.

- [ ] **Step 1: Write the failing tests.**
  - One per refusal and skip in Global Constraints, built in a temp
    dir. Symlinks come from `fs.symlinkSync`. For case duplicates, write
    `A.txt` and `a.txt`, and skip that test when the filesystem is
    case-insensitive.
  - The limits, using small overrides: `scanFolder(dir, { limits })`
    takes an optional second argument for tests.
  - Upload top-folder stripping: `plasma/index.html` →
    `index.html`. Mixed tops are not stripped.
  - `installStaged` refuses an existing target, and replace swaps the
    folders. A simulated failure (the rename target's parent made
    read-only) leaves the old folder.
  - `diffFolders` reports added, changed and removed files.

- [ ] **Step 2: Run** `node --test test/programs/import.test.js`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(programs): import rules: scan, stage, all-or-nothing install, update diff`.

### Task 5: Fetch-metadata guard and the GET audit

Spec: Security §1.

**Files:**
- Modify: `src/server/guard.js` (`checkRequest`).
- Test: `test/server/guard.test.js`, `test/app/get-routes.test.js` (new).

**Interfaces:**
- Produces: `checkRequest(req, port)` also returns false when
  `req.url` starts with `/api/` and `Sec-Fetch-Site` is `cross-site` or
  `same-site`. Absent, `same-origin` and `none` pass.

- [ ] **Step 1: Write the failing tests.**
  - In `guard.test.js`: GET `/api/sites` with
    `sec-fetch-site: same-site` is refused; `same-origin` is allowed;
    `cross-site` on `/app/index.html` is allowed (pages, not the API).
  - In `get-routes.test.js`:
    - start `startApp` with a temp site, as `test/app/server.test.js`
      does;
    - snapshot the site folder (a file list with mtimes) and `git log`;
    - call every GET route registered on the app router and on a site
      router. Read them from the routers' route tables, adding a
      read-only `routes()` accessor to `createRouter` if none exists;
    - fill parameters with the fixture's ids;
    - assert nothing changed.

- [ ] **Step 2: Run** both. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(security): API refuses cross-site and same-site fetches; no GET route changes state`.

### Task 6: Program server

Spec: "Program server, for Open", Security §2.

**Files:**
- Create: `src/programs/program-server.js`.
- Modify: `src/app/server.js`:
  - `startApp` starts it at the app's port + 1, with the same
    fallback;
  - it returns `programsUrl`;
  - `close` and `shutdown` close it.
- Test: `test/programs/program-server.test.js`.

**Interfaces:**
- Consumes: `readPrograms` and `effectiveSandbox` (Task 3), `MIME_TYPES`
  (`src/server/static.js`), `allowedHosts` logic from `guard.js`.
- Produces:
  - `startProgramServer({ port, resolveSite: (siteId) => ({ siteDir }) | null }) -> Promise<{ server, port, url, close }>`.
    It binds `127.0.0.1`.
  - Routes: `GET`/`HEAD` `/<siteId>/<area>/<slug>/<rest>`, where an
    empty `<rest>` means `index.html`.
    - `/<siteId>/<area>/<slug>` redirects (301) to the trailing slash.
    - The path is percent-decoded.
    - It serves a file only when all of these hold:
      - the area is configured;
      - the slug matches `SLUG`;
      - no segment starts with `.`;
      - the resolved real path stays inside `src/<area>/<slug>/`;
      - it isn't a symlink.
    - Anything else is 404 with a plain-text body.
  - Headers on every response:
    - `X-Content-Type-Options: nosniff`;
    - `Referrer-Policy: no-referrer`;
    - `Cross-Origin-Resource-Policy: same-origin`;
    - `Cache-Control: no-store`;
    - the sandbox CSP header (exact, from Global Constraints) when
      `effectiveSandbox` is true.
  - Methods other than GET or HEAD get 405. A bad `Host` gets 403.

- [ ] **Step 1: Write the failing tests.**
  - It serves an index and a nested file with the right types.
  - `é.txt` and `a b.html` are served via encoded URLs (Review Focus 4).
  - Each of these is 404:
    - `..%2f`;
    - a dotfile;
    - a symlink inside the program;
    - an unknown area or site;
    - a stray path under `src/` outside any area.
  - POST gets 405. A foreign Host gets 403.
  - The CSP header is present only for the sandboxed program.
  - `startApp` exposes `programsUrl` on a different port.
- [ ] **Step 2: Run** `node --test test/programs/program-server.test.js`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(programs): separate-origin program server for Open`.

### Task 7: Program routes: state, areas, cards, add from a folder, remove, Used in

Spec: VP "Server", Going live, "Used in".

**Files:**
- Create: `src/programs/usage.js`, `src/app/program-routes.js`.
- Modify:
  - `src/app/live-media.js`: `createLiveMedia(siteDir, git, { refs = liveMediaRefs } = {})`;
    the map keys come from `refs(html)`.
  - `src/store/schema.sql`: add `program_sources`.
  - `src/store/content.js`: add the source helpers.
  - `src/app/site-git.js`: add `programMessage`.
  - `src/app/server.js`: in `openSite`, mount the routes and call
    `clearTmp(ws.siteDir)`.
- Test: `test/programs/usage.test.js`, `test/app/program-routes.test.js`.

**Interfaces:**
- Consumes: Tasks 3, 4 and 6 (`programsUrl` from `startApp`).
- Produces:
  - `programRefs(html) -> Set<string>`:
    - the `'<area>/<slug>'` keys for every `href` or `src` pointing at
      `/<area>/<slug>`, `/<area>/<slug>/` or `/<area>/<slug>/<file>`;
    - same-site absolute URLs count when the host equals the site URL's
      host. `programRefs(html, { areas, siteHost })` takes them.
  - `programUsage({ docs, live, area, slug }) -> Array<{ title, path }>`:
    - `docs`: saved documents with their HTML bodies, from the store's
      body query (the same one as the media usage map);
    - `live`: `Map` from `createLiveMedia(…, { refs })`.
  - `CREATE TABLE IF NOT EXISTS program_sources (area TEXT NOT NULL, slug TEXT NOT NULL, source TEXT NOT NULL, PRIMARY KEY (area, slug));`
    with these helpers:
    - `getProgramSource(db, area, slug) -> string|null`;
    - `setProgramSource(db, area, slug, source)`;
    - `deleteProgramSource(db, area, slug)`.
  - `programMessage(text) -> string`: `Programs: ${commitTitle([text])}`,
    with no `[CI Skip]`.
  - `mountProgramRoutes(router, prefix, { site, ws, db, backup, writes, deps: { commitPaths, push, gitStatus }, liveRefs, programsUrl })`.
    The routes:

    | Method and path | Body | Answer |
    |---|---|---|
    | `GET …/programs` | | 200 `{ areas, programs: [...state, source], runBase: programsUrl + '/' + site.id, limits: LIMITS }` |
    | `POST …/programs/areas` | `{ path, title, sandbox }` | 201 |
    | `PATCH …/programs/areas/:path` | `{ title?, sandbox?, path? }` | 200; a `path` change is refused 409 unless the area is empty |
    | `DELETE …/programs/areas/:path` | | 200; 409 unless empty |
    | `POST …/programs` | `{ area, source, slug }` | 201 `{ program, skipped, large, committed, note? }` |
    | `PATCH …/programs/:area/:slug` | card fields | 200 `{ program, committed, note? }`; saving a stray creates its card |
    | `DELETE …/programs/:area/:slug` | | 200; 409 `{ error, usedIn: [{ title, path }] }` when used; removes the folder, card and source |

  - **Every write:**
    - runs as `backup.exclusive(() => writes(async () => { change; commit; push }))`;
    - commits `config/programs.json` and `src/<area>/<slug>`;
    - uses the message `programMessage('add plasma')` and so on;
    - pushes with `deps.push`.
    - With no repo, or when the commit or push fails, it answers like
      `commitLibrary` in `src/app/theme-routes.js`: the change stays on
      disk, `committed: false`, plus a `note` (Review Focus 5).
    - Card validation errors give 422 `{ error, errors }`.

- [ ] **Step 1: Write the failing tests.**
  - `usage.test.js`: all three URL forms, a lookalike
    `/demosx/plasma/` (not a use), and an absolute same-host URL.
  - `program-routes.test.js`: use the `fakeGit` and temp-site helpers
    from `test/app/server.test.js`, with `commitPaths` and `push`
    recorded.
    - Area add, edit and delete, and every 409.
    - Add from a folder: files installed, the card has
      `listed: false`, the source is stored, the commit message is
      `Programs: add plasma` with no skip marker, and push is called.
    - Add with a taken slug gives 409, with nothing changed.
    - Remove while a saved post links `/programs/plasma/` gives 409 with
      `usedIn`.
    - Remove when unused deletes everything.
    - A non-repo site gives `committed: false` with a note, and the
      files stay.
    - A failing `push` gives `committed: false` with a note.
- [ ] **Step 2: Run** both. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(programs): routes for areas, cards, add from a folder, remove (Used in)`.

### Task 8: Upload and Update from source

Spec: Goals (Upload, Update from source), Security §4 and §5.

**Files:**
- Modify: `src/app/program-routes.js`.
- Test: `test/app/program-routes.test.js` (new describe blocks).

**Interfaces:**
- Consumes: `stageFromUpload`, `stageFromFolder`, `diffFolders`,
  `scanToken`, `installStaged` (Task 4); the multipart parser in
  `src/server/api.js`. Export it as `parseMultipart` if it isn't
  exported.
- Produces:
  - `POST …/programs/upload`: multipart with an `area` field, a `slug`
    field, and file parts whose filename is the relative path. Each
    file part's field name is `files`, and its `filename` holds
    `webkitRelativePath`.
    - The raw body is limited to `LIMITS.totalBytes + 1 MB` while it
      streams. The router's `readRawBody` limit gives 413
      `{ error: 'This program is larger than 50 MB.' }`.
    - The answer is 201, the same shape as add from a folder.
  - `POST …/programs/:area/:slug/refresh`:
    - `{ confirm: false }` answers 200
      `{ preview: { added, changed, removed, total, skipped, large }, token }`.
    - `{ confirm: true, token }` re-stages. If `scanToken` differs from
      `token`, it answers 409
      `{ error: 'The source folder changed since the preview. Look again.' }`.
      Otherwise it installs with `replace: true`, commits
      `Programs: update <slug>` and pushes.
    - With no stored source: 422
      `{ error: 'This program was uploaded, so it has no source folder. Upload it again to update it.' }`.

- [ ] **Step 1: Write the failing tests:**
  - upload of a wrapped folder (Review Focus 1);
  - an over-limit upload gives 413 with nothing staged left behind;
  - an upload containing `id_rsa` gives 422 with nothing installed;
  - refresh preview lists the added, changed and removed files;
  - confirm with a stale token gives 409;
  - confirm installs and commits;
  - refresh after the source folder was deleted gives 422 with the
    "gone or moved" message, and the live copy is unchanged (Review
    Focus 2);
  - refresh on an uploaded program gives 422.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(programs): upload a folder; Update from source with preview and confirm`.

### Task 9: Programs screen

Spec: "Programs screen", "Write a post about it", Open,
`docs/design/README.md` (tokens, Media screen patterns).

**Files:**
- Create:
  - `src/programs/programs-view.js` (pure, tested in Node);
  - `app/assets/js/programs-page.js`;
  - `app/assets/js/programs-detail.js`;
  - `app/assets/js/programs-add.js`.
- Modify:
  - `app/assets/js/site-nav.js`: `SECTIONS` gains `'programs'` after
    `'media'`, and `LATER` becomes `['Analytics', 'Social']`;
  - `app/site.html`: add the `programs-section`;
  - `app/assets/js/site-page.js`: init the section;
  - `app/assets/app.css`: programs rules under the existing layers;
  - `README.md`: a Programs section;
  - `docs/design/README.md`: add Programs to the screens table, with
    "No mockup; follows Media".
- Test: `test/programs/programs-view.test.js`, `test/app/site-nav.test.js` (update).
- Browser check: `scratchpad/programs/t9-programs.mjs`, in the session
  scratchpad, not committed.

**Interfaces:**
- Consumes: the Task 7 and 8 routes, plus `POST /api/sites/:id/documents`
  for the post (check its body shape in `src/server/api.js:216`).
- Produces, in `programs-view.js`:
  - `filterPrograms(programs, { area, filter: 'all'|'listed'|'unlisted'|'no-card'|'sandboxed', q })`;
  - `headerText(state) -> 'N programs in M areas · K unlisted'`, with
    the singular forms `1 program` and `1 area`;
  - `tileModel(program) -> { title, path: '/<area>/<slug>/', badges: string[] }`.
    Badges: `'Unlisted'`, `'Sandboxed'`, `'Missing folder'`,
    `'Not a program (no index.html)'`, `'No card'`.
  - `sandboxChoiceText(areaDefault: boolean) -> Array<{ value: 'default'|'on'|'off', label, hint }>`.
    - Labels: `Area default (off)` or `(on)`, `On`, `Off`.
    - The On hint (exact): "The program can't use the site's storage or
      cookies, and its own saved data won't work."
  - `postFromProgram(program) -> { title, description, image, html }`,
    where `html` is
    `<p>Try it: <a href="/<area>/<slug>/">Title</a></p>` with the
    title HTML-escaped.

**Screen behavior (spec):**
- The header and the Add program panel: area, "From a folder on this
  computer" with the folder browser, "Upload a folder"
  (`<input type=file webkitdirectory>` plus drop), and slug.
- An Areas panel: list, add, edit, delete while empty.
- Filters and search. Tiles.
- A detail panel: fields saved on change, the sandbox radio group, path
  with Copy, source and Update from source, Used in, Write a post about
  it, Open, View live ↗, Remove….
- Update shows its preview in the page; Apply confirms.
- Remove confirms in the page.
- **Open** shows an `<iframe>` of `runBase/<area>/<slug>/`:
  - its `title` is the program's title;
  - it carries the exact sandbox attribute only when the program is
    sandboxed;
  - a Close button returns focus to Open.
- **Write a post about it** creates the draft, then opens
  `/editor/?site=<id>&doc=<docId>`, using the link the Posts section
  already uses for opening a post.
- Errors and notes are shown as text with `role="status"`/`alert`, like
  `media-page.js`.

- [ ] **Step 1: Write the failing tests** for each
  `programs-view.js` export, with exact strings, and for the updated
  `SECTIONS`/`LATER`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the view module, then the page modules and
  markup.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Browser check.** The script starts `startApp` on a
  temp copy of a Cook site with a git repo and a fake push. It then:
  - adds area `programs`;
  - adds a program from a fixture folder;
  - edits the title and lists it;
  - sets sandbox On;
  - opens it: the iframe loads from `programsUrl` with the sandbox
    attribute;
  - turns sandbox Off: the attribute is gone and `localStorage` works
    inside the frame;
  - runs Update from source with a changed file, checking the preview
    shows it;
  - runs Write a post about it, which lands in the editor with the
    link;
  - tries Remove: refused with the post named;
  - takes screenshots at 1280 and 390 wide;
  - runs axe as in earlier checks (`scratchpad/axe.mjs` pattern).

  Expected: every step logs OK, there are no 4xx except the expected
  409, and axe shows no serious or critical issues.
- [ ] **Step 6: Commit** `feat(programs): Programs screen (areas, add, card, sandbox, Open, Update, post, Remove)`.

---

## thomasapowell.com (`~/src/thomasapowell.com`, `main`)

### Task 10: Programs on the test site

Spec: "thomasapowell.com (the test site)".

**Files:**
- Create: `config/programs.json` (through VP), `src/programs.html`,
  `src/programs/plasma/…` and `src/programs/div-vaders/…` (through VP).
- Modify: the site's nav include or layout ("Programs" link),
  `package.json` (`cook-ssg ^2.7.0`), site CSS for the cards (VB tokens).

**Steps:**
- [ ] **Step 1: Link the local Cook.** Run `npm link` in `~/src/cook`,
  then `npm link cook-ssg` in the site. Don't commit a `file:`
  dependency. Set `cook-ssg` to `^2.7.0` in `package.json`.
- [ ] **Step 2: Add the page.** Write `src/programs.html` with the
  site's layout and
  `data-repeat="programAreas.programs as program"`. Each card shows:
  - the image (when set);
  - the title linking to `${program.url}`;
  - the date;
  - the description;
  - the tags.

  Add the nav link.
- [ ] **Step 3: Add the programs through VP.** Start `startApp` with
  this site, using a scratch `VP_CONFIG_DIR` and **no push**. Pass
  `git: { ...realGit, push: async () => {} }`, where `realGit` is the
  module `startApp` uses by default (`src/git/git.js`). Commits are real
  and pushes are no-ops. Through the API:
  - add area `programs` ("Programs", sandbox off);
  - add `plasma` from `~/src/retro-fun/src/demos/plasma`, with title,
    description, date and tags, listed;
  - add `div-vaders`, listed, with sandbox **on**.
- [ ] **Step 4: Build and check.** Run `npm run build`. A browser script
  against `dist/` served by a scratch static server checks:
  - `/programs/` lists both cards, newest first;
  - `/programs/plasma/` runs, with no console errors;
  - `dist/programs/**` equals `src/programs/**` byte for byte;
  - `dist/_headers` has the `/programs/div-vaders/*` sandbox block;
  - `/programs/div-vaders/` served with that header shows a
    `localStorage` `SecurityError`, which is the expected, documented
    cost.

  Take a screenshot of `/programs/`.
- [ ] **Step 5: Commit** the site changes. VP made its own commits in
  Step 3; check that `git log` shows them unpushed. The message is
  `feat: programs page and two demo programs (cook-ssg ^2.7.0)`.
- [ ] **Step 6: Leave the link in place.** Leave the `npm link` as it
  is. Don't run `npm install` (it can't resolve `^2.7.0` until the user
  publishes). Leave `package-lock.json` unstaged. Report both: after
  publishing, the user runs `npm install` in the site, which replaces
  the link.
