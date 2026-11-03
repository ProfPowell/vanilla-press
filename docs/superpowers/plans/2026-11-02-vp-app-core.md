# Vanilla Press App: Core (Step 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `vp` opens a local app that manages several Cook sites. For each site you can list posts, write in a distraction-free editor, preview on a dev server VP starts itself, and click Publish to take a post live. Publish runs a build check, commits, pushes to GitHub, and Cloudflare deploys.

**Architecture:**
- One app server (`src/app/server.js`) owns a registry of sites (`~/.config/vanilla-press/sites.json`).
- Each site gets a workspace and store opened on demand. The existing per-site API (`mountApi`) is mounted under `/api/sites/:siteId`.
- Git (`src/git/git.js`), child processes (`src/app/site-process.js`, `src/app/preview.js`) and the publish flow (`src/app/publish.js`) are separate modules with injected dependencies, so they can be tested without network or Cook.
- The UI is static pages in `app/` (sites list, site screen) plus the existing editor, made site-aware.

**Tech Stack:**
- Node ≥ 22, `node:http`, `node:child_process`, `node:test`.
- better-sqlite3, ProseMirror (existing).
- The system `git` CLI and the site's own `npm` scripts.
- Vanilla Breeze for the app UI.

**Spec:** `docs/superpowers/specs/2026-11-02-vp-app-core-design.md`

## Global Constraints

- No new npm dependencies. Use Node built-ins, the `git` CLI and `npm`.
- The app server listens on `127.0.0.1` only. Port 3007, or the next free port.
- The registry file lives at `${VP_CONFIG_DIR}/sites.json`.
  - `VP_CONFIG_DIR` defaults to `~/.config/vanilla-press`.
  - Tests always set `VP_CONFIG_DIR` to a temp dir.
- A folder is a site when its `package.json` has `cook-ssg` in `dependencies` or `devDependencies`.
- Every git child process runs with `GIT_TERMINAL_PROMPT=0`.
- VP stages only VP-owned paths:
  - `content/`;
  - `src/<dir>/` for each collection's output dir. `src/` itself when a dir is `''`, as for pages, but then only `*.html` files whose front matter has `vp_id`;
  - `config/vp.json`.

  It never runs `git add -A` or `git add .` on the whole tree.
- Draft-only commits are titled `Draft: <title>` and end with ` [CI Skip]`. Several drafts become `Draft: <title>, <title>` (up to three titles, then `and N more`).
- Publish commits are `Publish: <title>`; unpublish commits are `Unpublish: <title>`. Neither has a skip marker.
- Draft backup timing:
  - push 30 s after the last save;
  - at most 120 s after the first unpushed save.
- Live check: the client polls every 10 s and gives up after 300 s with the message `Still deploying, check Cloudflare`.
- The vocabulary from CLAUDE.md is kept:
  - **sync:** VP writes files into the site;
  - **publish:** a post's status;
  - **build:** Cook;
  - **deploy:** hosting.
- These keep working unchanged: `vp serve --site`, every existing CLI command, and fixture mode.
- Test files go in `test/<area>/*.test.js`, one level deep. `npm test` runs `node --test test/**/*.test.js`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The user's own uncommitted work outside VP paths** must never be committed or pushed by VP, whether it is an agent-written `src/programs/x/index.html` or an edit to `config/main.js`. This is tested in Task 2 (`commitPaths ignores files outside the given paths`) and in Task 5 (`publish leaves unrelated changes uncommitted`).
2. **A remote that moved** because another machine pushed:
   - VP rebases and pushes.
   - If the rebase conflicts, VP aborts it, the local repo is exactly as before, and the error names the files.

   Tested in Task 2 (`push rebases when the remote moved`, `push aborts a conflicting rebase`).
3. **A Cook build that fails on Publish** must leave the post a draft: status reverted, no HTML page left behind, nothing committed or pushed. Tested in Task 5 (`build failure reverts to draft and pushes nothing`).
4. **Two sites open in one app:** a save through site A's API writes only into A's folder and store. Tested in Task 4 (`two sites are isolated`).
5. **No network exposure:** the server's address is `127.0.0.1`, and the folder browser and per-site API reject unknown site ids with 404. Tested in Task 4 (`listens on 127.0.0.1`, `unknown site id is 404`).

---

### Task 1: Site registry and folder browsing

**Files:**
- Create: `src/app/registry.js`
- Test: `test/app/registry.test.js`

**Interfaces:**
- Produces:
  - `configDir(env = process.env) -> string`
  - `listSites({ env }) -> Site[]`
  - `getSite(id, { env }) -> Site | null`
  - `addSite({ path, name? }, { env }) -> Site`
  - `removeSite(id, { env }) -> boolean`
  - `isCookSite(dir) -> boolean`
  - `listFolders(dir) -> { path, parent, folders: { name, path, isSite }[] }`

  where `Site = { id: string, name: string, path: string, addedAt: string }`. Paths are absolute. `name` defaults to the folder's basename.
- `addSite` throws `Error('Not a Cook site: <path>')` when `isCookSite` is false, and `Error('Already added: <path>')` for a duplicate path.
- `addSite` creates `<path>/.vp/` and appends `.vp/` to `<path>/.gitignore` when that file lacks a `.vp/` line, creating the file if needed.
- `id` is the basename lowercased, with non `[a-z0-9]` runs turned into `-`. It gets suffixes `-2`, `-3`, … when taken.

- [ ] **Step 1: Write the failing tests** in `test/app/registry.test.js`. Use a temp `VP_CONFIG_DIR` and temp site folders, each with a `package.json`.
  - `addSite registers a Cook site and lists it`: `listSites()` deep-equals one entry with `id: 'my-site'` for folder `My Site`, the absolute `path`, and an ISO `addedAt`.
  - `addSite rejects a folder without cook-ssg`: throws `/Not a Cook site/`.
  - `addSite rejects a duplicate path`: throws `/Already added/`.
  - `ids are unique`: two folders named `blog` in different parents get ids `blog` and `blog-2`.
  - `addSite creates .vp and git-ignores it once`: `.gitignore` gets exactly one `.vp/` line, and adding a site whose `.gitignore` already has `.vp/` leaves it unchanged.
  - `removeSite forgets the site but leaves its folder`: returns true, `listSites()` is empty, and the folder still exists.
  - `listFolders lists subfolders and marks sites`: the returned `folders` are sorted by name, exclude dotfolders, and mark `isSite: true` on the Cook site. `parent` is the parent dir.
  - `registry survives a missing or corrupt sites.json`: a missing file gives `[]`. Corrupt JSON throws `/sites.json/` and does not overwrite the file.
- [ ] **Step 2: Run** `node --test test/app/registry.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `src/app/registry.js`. Write `sites.json` atomically, reusing `writeFileAtomic` from `src/sync/atomic-write.js`.
- [ ] **Step 4: Run** `node --test test/app/registry.test.js`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(app): site registry and folder browsing`.

### Task 2: Git operations

**Files:**
- Create: `src/git/git.js`
- Test: `test/git/git.test.js`

**Interfaces:**
- Produces:
  - `gitStatus(dir) -> Promise<{ isRepo, branch, hasRemote, hasUpstream }>`
  - `commitPaths(dir, paths: string[], message) -> Promise<string|null>`. It stages with `git add -A -- <paths that exist or are tracked>`, commits only if something is staged, and returns the new sha or null.
  - `push(dir) -> Promise<{ pushed: boolean, rebased: boolean }>`
  - `cloneRepo(url, dest) -> Promise<void>`
- Produces errors:
  - `class GitConflictError extends Error { files: string[] }`
  - `class GitNotConnectedError extends Error`, thrown when there is no remote or no upstream.
  - `class GitError extends Error { stderr: string }`
- `push`:
  1. Runs `git push`.
  2. If rejected as non-fast-forward, runs `git pull --rebase --autostash`.
     - On conflict: `git rebase --abort`, then throw `GitConflictError` with the conflicting paths from `git diff --name-only --diff-filter=U`.
     - Otherwise push again and return `{ pushed: true, rebased: true }`.
- All git calls go through one `runGit(dir, args)` that uses `execFile` with `env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }`.

- [ ] **Step 1: Write the failing tests** in `test/git/git.test.js`. Each test builds a temp bare repo `remote.git` and clones `a` and `b`, with user.name and user.email set locally in each clone.
  - `gitStatus reports branch and upstream`: a clone gives `{ isRepo: true, branch: 'main', hasRemote: true, hasUpstream: true }`. A plain `git init` dir gives `hasRemote: false`. A non-repo gives `isRepo: false`.
  - `commitPaths commits only the given paths`: create `content/x.json` and `src/programs/p/index.html`, then `commitPaths(a, ['content'], 'Draft: X [CI Skip]')`. The commit contains only `content/x.json` (`git show --name-only`), and `src/programs/p/index.html` is still untracked.
  - `commitPaths stages deletions`: a tracked `content/x.json` is deleted, and the commit removes it.
  - `commitPaths returns null when nothing changed`.
  - `push pushes to the upstream`: after commit and push, `git -C remote.git log` has the commit.
  - `push rebases when the remote moved`: `b` pushes a change to `README.md`, `a` commits `content/x.json`, then `push(a)` returns `{ pushed: true, rebased: true }` and the remote has both commits.
  - `push aborts a conflicting rebase`: `b` and `a` both change `content/x.json` differently. `push(a)` rejects with `GitConflictError` whose `files` is `['content/x.json']`. Afterwards `a`'s HEAD sha equals its pre-push sha, and `git status --porcelain` shows no rebase in progress.
  - `push without upstream throws GitNotConnectedError`.
  - `git never prompts`: `cloneRepo('https://127.0.0.1:9/none.git', dest)` rejects with `GitError` within 10 s.
- [ ] **Step 2: Run** `node --test test/git/git.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/git/git.js`.
- [ ] **Step 4: Run** `node --test test/git/git.test.js`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(git): commit VP paths only, push with rebase, clear errors`.

### Task 3: Running the site's npm scripts and the preview server

**Files:**
- Create: `src/app/site-process.js`, `src/app/preview.js`
- Test: `test/app/site-process.test.js`, `test/app/preview.test.js`

**Interfaces:**
- Produces from `site-process.js`:
  - `ensureInstalled(dir) -> Promise<void>`: runs `npm install` when `node_modules` is missing.
  - `runBuild(dir) -> Promise<{ ok: boolean, log: string }>`: runs `npm run build` with `NODE_ENV=production`. `log` is the last 4000 chars of stdout and stderr together.
  - `freePort(start = 4100) -> Promise<number>`
- Produces from `preview.js`:
  - `createPreviews({ spawn? }) -> { start(site) -> Promise<{ url }>, stop(siteId), stopAll() }`
  - `start`:
    1. Calls `ensureInstalled`.
    2. Picks `freePort()`.
    3. Spawns `npm run dev -- --port <port>` in `site.path`.
    4. Waits until `http://127.0.0.1:<port>/` answers any HTTP status, polling every 250 ms. After 60 s it throws `Error('Preview server did not start: <log tail>')`.
  - A second `start` for a running site returns the same url without spawning again.
  - `stopAll` kills every child process.

- [ ] **Step 1: Write the failing tests.** Use temp site folders with a hand-written `package.json` and stand-in scripts, and no Cook.
  - `runBuild reports success`: the `build` script is `node -e "require('fs').mkdirSync('dist');require('fs').writeFileSync('dist/ok','1')"`, giving `{ ok: true }` and `dist/ok` exists.
  - `runBuild reports failure with the log tail`: the `build` script is `node -e "console.error('boom');process.exit(1)"`, giving `ok: false` and `log` includes `boom`.
  - `ensureInstalled skips when node_modules exists`: inject a `run` spy (export `ensureInstalled(dir, { run })`) and assert it is not called.
  - `freePort skips a busy port`: listen on 4100, and `freePort(4100)` returns a port other than 4100.
  - `preview starts the dev server and reuses it`: the `dev` script is a tiny `node:http` server reading `--port` from argv. `start(site)` resolves `{ url: 'http://127.0.0.1:<port>' }` and a GET returns 200. A second `start` returns the same url. After `stopAll()` the port refuses connections.
  - `preview reports a dev server that exits`: the `dev` script is `node -e "process.exit(1)"`, and `start` rejects with `/Preview server did not start/` well before 60 s, because an exited child fails fast.
- [ ] **Step 2: Run** `node --test test/app/site-process.test.js test/app/preview.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run** the same command. Expected: all pass.
- [ ] **Step 5: Commit** `feat(app): run site builds and a preview server per site`.

### Task 4: The multi-site app server

**Files:**
- Create: `src/app/server.js`
- Modify: `src/server/api.js` (accept `prefix`, default `'/api'`; accept `onSynced`)
- Modify: `src/sync/paths.js` (add `postUrlPath`)
- Modify: `src/server/index.js` (listen on `127.0.0.1`)
- Test: `test/app/server.test.js`, `test/sync/paths.test.js`

**Interfaces:**
- Consumes: the registry (Task 1); `resolveWorkspace`, `openWorkspaceDb`, `syncFromSite`, `mountApi`.
- Produces:
  - `startApp({ port = 3007, env = process.env, previews?, git?, siteProcess? }) -> Promise<{ server, port, url, close() }>`
  - `postUrlPath(doc, collectionsConfig) -> string`, for example `'/posts/hello/'`. Pages with path `''` give `'/hello/'`.
  - `mountApi(router, db, { ..., prefix, onSynced })`. Every route pattern becomes `${prefix}/…`. After every successful sync (create, update, delete, reload), it calls `onSynced?.({ docId, title, status })`.
- App routes:
  - `GET /api/sites` → `Site[]`, each plus `{ git: { connected, branch } }`.
  - `POST /api/sites { path }` → 201 `Site`, or 422 `{ error }`.
  - `POST /api/sites/clone { url, dest }` → 201 `Site`, or 422 `{ error }`.
  - `DELETE /api/sites/:siteId` → `{ ok: true }`.
  - `GET /api/folders?path=` → `listFolders`. `path` defaults to the home dir.
  - Every other `/api/sites/:siteId/...` goes to that site's router.
    - The site's router is created on first use: `resolveWorkspace({ site: path })`, `openWorkspaceDb`, `syncFromSite`, then `mountApi` with `prefix: /api/sites/<id>`.
    - Open sites are cached for the life of the server.
    - An unknown id is 404 `{ error: 'Unknown site' }`.
- Static routes:
  - `/` → `app/index.html`;
  - `/app/` → `app/`;
  - the existing `/editor/`, `/src/` and `/assets/vb/` mounts.

  A static path containing `..` after decoding is 404.
- `startApp` tries `port`, `port+1`, … up to 20 times, and listens on `127.0.0.1`.

- [ ] **Step 1: Write the failing tests.**
  - In `test/sync/paths.test.js`: `postUrlPath gives the page URL` for posts (`/posts/hello/`), for pages (`/hello/`), and for a custom collection path from the config.
  - In `test/app/server.test.js` (temp `VP_CONFIG_DIR`, two temp Cook sites, `startApp({ port: 0 })`; with port 0 the OS assigns one and there is no fallback):
    - `listens on 127.0.0.1`: `server.address().address === '127.0.0.1'`.
    - `adds and lists sites`.
    - `rejects a non-Cook folder with 422`.
    - `per-site API creates and syncs a post`: `POST /api/sites/<a>/documents` writes `<a>/content/posts/<slug>.json`.
    - `two sites are isolated`: a post created on site A appears in A's `GET …/documents` and not in B's, and no files change in B.
    - `opening a site syncs from its files`: put a valid post JSON in `content/posts/` before first use, and the first `GET /api/sites/<a>/documents` lists it.
    - `unknown site id is 404`.
    - `static path traversal is 404`: `GET /app/..%2fpackage.json` returns 404.
    - `falls back to the next port`: hold port P, and `startApp({ port: P })` listens on P+1.
    - `onSynced fires after a save`: a spy passed to `mountApi` through the test server receives `{ docId, title: 'Hello', status: 'draft' }`.
  - Keep the existing `test/server/*.test.js` green. They use the default prefix `/api`.
- [ ] **Step 2: Run** `node --test test/app/server.test.js test/sync/paths.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** The editor's preview code currently computes the URL itself. Change it to import `postUrlPath`; it is shared code served from `/src/`.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(app): one app server for many sites`.

### Task 5: Draft backup, Publish and Unpublish, live check

**Files:**
- Create: `src/app/site-git.js` (owned paths, draft backup), `src/app/publish.js`
- Modify: `src/app/server.js` (wire routes and `onSynced`)
- Test: `test/app/publish.test.js`, `test/app/site-git.test.js`

**Interfaces:**
- Consumes:
  - from Task 2: `commitPaths`, `push`, `gitStatus` and the git errors;
  - from Task 3: `runBuild`;
  - from Task 4: `postUrlPath`;
  - from existing code: `syncDocument`, `getDocument`, `saveDocument`.
- Produces from `site-git.js`:
  - `ownedPaths(ws, collectionsConfig) -> string[]`.
  - `createBackup({ site, ws, git, now?, setTimer?, clearTimer? }) -> { noteSaved({ title, status }), flush() -> Promise<BackupResult>, state() }`
    - `BackupResult` and `state()` are `{ pending: number, lastPushAt: string|null, error: string|null, connected: boolean }`.
    - Timing: push 30 s after the last `noteSaved`, at most 120 s after the first unpushed one. The timer functions are injected for tests.
    - `flush` commits the owned paths with the Draft message format from Global Constraints and pushes.
    - On `GitNotConnectedError`, `state().connected` becomes false and saves keep working.
    - Other git errors set `state().error` and are retried on the next flush.
- Produces from `publish.js`:
  - `setPublished({ site, ws, db, docId, publish: boolean, deps }) -> Promise<{ status: 'pushed'|'saved', url: string|null, sha: string|null }>`
  - `deps = { ensureInstalled, runBuild, commitPaths, push, gitStatus, collectionsConfig }`.
  - Order:
    1. Save the status change (`published` set to now on first publish) and sync it.
    2. Run `ensureInstalled`, then `runBuild` (both from Task 3, injected through `deps`). On failure, restore the previous stored version, re-sync it, and throw `BuildError { log }`.
    3. Commit the owned paths as `Publish: <title>` or `Unpublish: <title>`.
    4. Push. Without a remote, return `status: 'saved'`.

    `url` is `siteUrl` + `postUrlPath`, or null when unpublishing or when `siteUrl` is unset.
  - `readSiteUrl(siteDir) -> Promise<string|null>`: imports `<site>/config/data.js` (with a cache-busting query) and returns `default.siteUrl`.
  - `checkLive({ url, expectedText, fetch? }) -> Promise<boolean>`: true when the page answers 200 and its text equals `expectedText` (tags stripped, whitespace collapsed).
- App routes, all under `/api/sites/:siteId`:
  - `POST /documents/:id/publish` and `POST /documents/:id/unpublish` → 200 `{ status, url }`.
    - 422 `{ error: 'Build failed', log }` on `BuildError`.
    - 409 `{ error, files }` on `GitConflictError`.
    - 502 `{ error }` on other git errors. The post stays published locally and the push retries on the next flush.
  - `GET /status` → backup `state()`.
  - `GET /documents/:id/live` → `{ live: boolean, url }`. The server compares the live page with the text of the locally built `dist/<postUrlPath>index.html`.
  - `POST /backup` → `flush()`.
- Wiring: `onSynced` from each site's API calls that site's `backup.noteSaved`. Quitting the app (SIGINT or SIGTERM) runs `flush()` on every open site, then `previews.stopAll()`.

- [ ] **Step 1: Write the failing tests.** Use a temp Cook-shaped site that is a clone of a temp bare remote, with a stand-in `build` script that copies `src/**/*.html` to `dist/` so tests need no Cook.
  - `ownedPaths lists content and collection dirs`: posts → `['content', 'src/posts', 'config/vp.json']`. Order is not significant; compare sorted.
  - `draft backup commits with CI Skip after the pause`: call `noteSaved`, advance the fake timer 30 s, and the remote's last commit message is `Draft: Hello [CI Skip]`.
  - `draft backup batches titles`: three saves of different posts give one commit, `Draft: A, B, C [CI Skip]`.
  - `draft backup without a remote keeps working`: `state().connected === false`, and no throw.
  - `publish writes, builds, commits and pushes`: the remote's last commit is `Publish: Hello` and includes `src/posts/hello.html`, the result is `status: 'pushed'`, and `url` is `https://example.com/posts/hello/`.
  - `build failure reverts to draft and pushes nothing`: with a failing `build` script, it rejects with `BuildError` whose `log` contains the script's stderr. The stored doc's status is `draft`, `src/posts/hello.html` does not exist, and the remote has no new commits.
  - `publish leaves unrelated changes uncommitted`: an untracked `src/programs/p/index.html` and a modified `config/main.js` are still uncommitted after publish.
  - `unpublish removes the page and pushes`: the commit is `Unpublish: Hello`, the HTML is gone, the JSON stays, and the status is `draft`.
  - `conflicting remote change is a 409`: after a conflicting push to the same JSON from a second clone, the route returns 409 with `files: ['content/posts/hello.json']`.
  - `checkLive compares page text`: an injected fetch returning the expected HTML gives true; a different body gives false; a 404 gives false.
- [ ] **Step 2: Run** `node --test test/app/site-git.test.js test/app/publish.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** and wire into `src/app/server.js`.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(app): draft backup to GitHub and one-click Publish`.

### Task 6: `vp` starts the app

**Files:**
- Modify: `src/cli/run.js` (no command, or `app`, starts the app; help text)
- Test: `test/cli/run.test.js`

**Interfaces:**
- Consumes: `startApp` (Task 4).
- `vp` and `vp app [--port N]` call `startApp`, print `Vanilla Press is running at <url>`, and open the browser:
  - `open` on darwin, `xdg-open` on linux, `start` on win32;
  - skipped when `VP_NO_OPEN=1`.
- `vp --help` and `vp help` still print help. The help text lists `vp` / `vp app` first.

- [ ] **Step 1: Write the failing tests.**
  - `vp with no command starts the app`: spawn `bin/vp.js` with `VP_NO_OPEN=1`, a temp `VP_CONFIG_DIR` and `--port 0`. Stdout matches `/Vanilla Press is running at http:\/\/127\.0\.0\.1:\d+/` within 10 s; kill the process.
  - `vp --help lists the app first`.
- [ ] **Step 2: Run** `node --test test/cli/run.test.js`. Expected: the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(cli): vp opens the app`.

### Task 7: Sites screen and site screen

**Files:**
- Create:
  - `app/index.html`: the Sites screen.
  - `app/site.html`: one site, with `?site=<id>`.
  - `app/assets/app.css`
  - `app/assets/js/sites-page.js`
  - `app/assets/js/site-page.js`
  - `app/assets/js/app-api.js`
- Test: browser verification by the controller (Ruling H pattern), plus `test/app/static.test.js` for routing.

**Interfaces:**
- Consumes: the app routes (Tasks 4 and 5).
- The pages use Vanilla Breeze from `/assets/vb/` and its layout elements, with no framework.
- **Sites screen:**
  - One card per site: name, path, post counts (drafts and published, from `GET /api/sites/:id/documents`), and git status (`Connected to GitHub (main)` or `Not connected to GitHub`).
  - **Add site** opens a panel with a path field and a folder browser using `GET /api/folders`. Folders that are sites are marked "Cook site". It shows the server's 422 message on failure.
  - **Clone from GitHub** takes a URL and a destination folder.
- **Site screen:**
  - Header: `← Sites`, the site name, **View site** (its `siteUrl`, when set) and **Preview**.
  - Sidebar: Posts (active), then Media, Theme, Programs, Analytics and Social, each showing "Coming soon" when clicked.
  - The Posts list is newest first by `updated`, with title, status and date, plus **New post**.
  - Clicking a post opens `/editor/?site=<id>#doc-<docId>`. **New post** creates the post through the API, then opens it.
  - The backup status line comes from `GET /status`: `Backed up <time>`, `Not connected to GitHub`, or the error.

- [ ] **Step 1: Write the failing test** `test/app/static.test.js`:
  - `/` serves the Sites page (200, contains `<title>Sites`);
  - `/app/site.html` serves (200).
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** the pages.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Browser check** (controller):
  - add a temp Cook site by path;
  - the card appears;
  - open it;
  - **New post** opens the editor;
  - placeholders say "Coming soon";
  - the console has no errors.
- [ ] **Step 6: Commit** `feat(app): sites screen and site screen`.

### Task 8: Distraction-free, site-aware editor

**Files:**
- Modify:
  - `editor/index.html`
  - `editor/assets/js/api-client.js`: the base becomes `/api/sites/<site>` when `?site=` is present, else `/api`.
  - `editor/assets/js/components/editor-shell.js`
  - `editor/assets/js/components/meta-panel.js`
  - `editor/assets/js/editor.js`
- Test: browser verification by the controller.

**Interfaces:**
- Consumes: the Task 5 routes (`publish`, `unpublish`, `live`, `status`) and `POST /api/sites/:id/preview` → `{ url }`, which uses `previews.start` (Task 3; add the route in this task).
- **With `?site=`:**
  - The doc browser sidebar, block inspector and Export JSON live behind a **Tools** toggle, closed by default.
  - The header shows `← Posts` (to `/app/site.html?site=<id>`), the save state, **Preview** and **Publish** / **Unpublish**.
  - The post-settings panel can be hidden and remembers that in `localStorage`.
- **Without `?site=`**, as in `vp serve`, the editor behaves exactly as today.
- **Save states**, shown in the header: `Saving…`, `Saved`, `Backed up`, `Publishing…`, `Live`, `Still deploying, check Cloudflare`, and errors.
  - `Backed up` comes from `GET /status` after a save, once `lastPushAt` is newer.
  - **Publish:**
    1. Shows `Publishing…`.
    2. Calls `POST …/publish`.
    3. Shows `Build failed` with the log in a details panel (422), or `Couldn't push: GitHub has changes that conflict with yours` with the file names (409).
    4. On success, polls `GET …/live` every 10 s for up to 300 s, then shows `Live` with a link or `Still deploying, check Cloudflare`.
- **Preview** calls `POST …/preview` (inside the click, using the open-tab-first pattern already in `meta-panel.js`).
  - It saves first, then opens `url + postUrlPath(doc)`.
  - It shows the error message if the server didn't start.
  - Drafts have no HTML page, so previewing a draft shows `Preview shows published pages: publish first`, as today.

- [ ] **Step 1: Write the failing test.** In `test/app/server.test.js`, `preview route starts the site's dev server`: inject a `previews` stub into `startApp`, and `POST /api/sites/<a>/preview` returns its `{ url }`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the route and the editor changes.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Browser check** (controller, against a temp site cloned from a temp bare remote, with the stand-in build script):
  1. Typing saves, and `Backed up` appears after the pause. The remote has a `[CI Skip]` commit.
  2. Publish shows `Publishing…`, then `Still deploying…` or `Live`. The remote has `Publish: …`.
  3. A failing build shows `Build failed` with the log.
  4. Tools is closed by default, and the settings panel hides.
  5. `vp serve --site` still shows the old layout.
- [ ] **Step 6: Commit** `feat(editor): distraction-free, site-aware editor with Publish to live`.

### Task 9: End to end with Cook, and docs

**Files:**
- Create: `test/e2e/app-publish.test.js`
- Modify: `CLAUDE.md`, `README.md`, `docs/EDITOR.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the test** `app publish builds a real Cook site and pushes the page`:
  - a temp site: Cook `config/main.js` like `test/e2e/cook-site.test.js`, layouts, a `package.json` with `"build": "cook build"` and `node_modules` symlinked to VP's (as in the existing e2e test), cloned from a temp bare remote;
  - `startApp({ port: 0 })`, then add the site, create a post and publish through the API.

  Assertions:
  - status 200;
  - the remote's `Publish: …` commit contains `src/posts/<slug>.html`;
  - `dist/posts/<slug>/index.html` exists locally;
  - `GET …/live` with an injected fetch returning that dist file's HTML gives `live: true`.
- [ ] **Step 2: Run** `node --test test/e2e/app-publish.test.js`. Expected: PASS. (This is integration over finished tasks; a failure means an earlier task is wrong.)
- [ ] **Step 3: Docs.**
  - CLAUDE.md: the app, the registry location, VP-owned paths, the commit message formats and why draft commits carry `[CI Skip]`.
  - README: start with `vp`.
  - EDITOR.md: the new routes.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `test: app publish end to end with Cook; docs for the app`.
