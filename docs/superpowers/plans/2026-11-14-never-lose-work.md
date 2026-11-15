# Never Losing Work (Page Mode, Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every edit in the post editor and the layout editor is kept in the browser before any save, offered back after a crash or failed save, and a failed or paused save is shown loudly until resolved.

**Architecture:** A small client-side draft store (IndexedDB in the browser, an in-memory backend in Node tests) holds one local copy per open post or layout plus the last 20 confirmed versions of each post. Pure controllers decide when to record, when to clear, and what to offer on open; the editors call them from their existing dispatch, save and load paths. Two DOM components show the loud save state and the restore offer. No server change: the stored document's `meta.updated` is already returned on GET, POST and PUT and serves as the revision.

**Tech Stack:** Vanilla JS ES modules, ProseMirror, IndexedDB, BroadcastChannel, `node:test` + linkedom for tests.

**Spec:** `docs/superpowers/specs/2026-11-14-page-mode-design.md` (Phase 1 and "Settled after the builder check" items 4 and 5)

## Global Constraints

- Branch `feat/never-lose-work` from `fix/layout-editor-polish` (HEAD b7d4110). Never push or merge to a remote.
- Never stage `CLAUDE.md`; stage files by name. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: `node --test test/editor/*.test.js` for the editor, `npm test` for the whole suite (2273 pass, 0 fail, 1 skipped before this plan).
- Phase 1 must work with the block editor alone; nothing may assume page mode exists.
- The local copy for a post is cleared only after the server confirms a save of a version at least as new.
- Storage failing (private window, quota, IndexedDB missing or throwing) must not break editing: one-line warning "Unsaved work isn't protected in this browser", editing carries on.
- Keep the last **20** server-confirmed versions per post.
- No browser `alert`/`confirm`/`prompt`. Notices use plain, short words.
- Browser checks: time-limited Node Playwright only (`perl -e 'alarm N; exec @ARGV' node script`, chromium from `/Users/tpowell/src/vanilla-breeze/node_modules/playwright/index.mjs`). Against thomasapowell.com, route `**/api/**` and abort non-GET requests (fulfill a fake PUT where a save must succeed); never write to `~/src/thomasapowell.com`.
- Don't start servers on 3017, 3007 or 4180 (the session's own app on 3017 may be used).

## Review Focus

1. **A save that fails with no HTTP status (network down, app stopped)** — today `handleSaveError` sets a quiet "Unsaved"; the person expects a loud "Can't reach Vanilla Press — your changes are kept in this browser" bar and auto-save retrying. Test in Task 5.
2. **Edits made while a save is in flight** — the local copy must survive the confirmation of the earlier save. Test in Task 2 (`saveConfirmed` with a newer `seq` keeps the copy).
3. **A brand-new post that is never saved, then the tab dies** — the copy is under a temporary key; reopening the editor on a new post must offer it. Test in Task 2 (`pendingNew`) and Task 5.
4. **Restoring a local copy whose base is older than the file** — must never silently overwrite; offer "Restore as a new draft". Test in Task 2 (`restoreOffer` → `stale`).
5. **IndexedDB throwing on every call** — editing continues, one warning shown once. Test in Task 1 (failing backend) and Task 4 (save bar shows the storage line).

---

## File Structure

- Create `editor/assets/js/drafts/draft-store.js` — storage: `createDraftStore(backend)`, `memoryBackend()`, `idbBackend()`.
- Create `editor/assets/js/drafts/draft-logic.js` — pure decisions: keys, restore offer, differences in words.
- Create `editor/assets/js/drafts/post-drafts.js` — the post editor's controller over the store (record, save tokens, confirm, re-key, versions).
- Create `editor/assets/js/drafts/tab-lock.js` — one editing tab per post via BroadcastChannel.
- Create `editor/assets/js/components/save-bar.js` — `<save-bar>`: loud save state and the restore offer.
- Create `editor/assets/js/components/versions-list.js` — `<versions-list>`: recent versions in post settings.
- Modify `editor/assets/js/editor.js` (dispatch ~L301-325, `loadDocument` ~L495, `saveDocument` ~L577, `createFromEditor` ~L615, `handleSaveError` ~L656), `editor/index.html` (bar under the header, ~L51), `editor/assets/js/components/meta-panel.js` (versions section), `editor/assets/js/layout-editor/main.js` (load ~L362, save ~L404, dirty ~L180), `editor/layout.html`, CSS in `editor/assets/css/` beside the save pill styles.
- Tests in `test/editor/`: `draft-store.test.js`, `draft-logic.test.js`, `post-drafts.test.js`, `tab-lock.test.js`, `save-bar-dom.test.js`, `versions-list-dom.test.js`, `layout-drafts.test.js`.

---

### Task 1: Draft store

**Files:**
- Create: `editor/assets/js/drafts/draft-store.js`
- Test: `test/editor/draft-store.test.js`

**Interfaces:**
- Produces:
  - Backend shape: `{ get(store, key) → Promise<any>, set(store, key, value) → Promise<void>, delete(store, key) → Promise<void>, keys(store) → Promise<string[]> }`; stores are `'drafts'` and `'versions'`.
  - `memoryBackend() → Backend`
  - `idbBackend({ name = 'vp-drafts' } = {}) → Backend` (opens DB version 1 with object stores `drafts` and `versions`; rejects when `indexedDB` is missing)
  - `createDraftStore(backend, { onUnavailable } = {}) → DraftStore` with `get(key)`, `put(key, record)`, `remove(key)`, `rekey(from, to)`, `keys(prefix)`, `pushVersion(key, version, { limit = 20 })`, `versions(key) → newest first`, and `available` (boolean). Every method resolves; a backend throw resolves to `null`/`false`/`[]`, sets `available = false` and calls `onUnavailable(err)` once.

- [ ] **Step 1: Write the failing tests** — `put`/`get`/`remove` round-trip; `rekey('post:s:new-1','post:s:doc_9')` moves the record and its versions; `keys('post:s:')` filters by prefix; `pushVersion` 25 times keeps 20, newest first; with a backend whose every method throws: `get` → `null`, `put` → `false`, `onUnavailable` called exactly once, `available === false`.
- [ ] **Step 2: Run** `node --test test/editor/draft-store.test.js` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `draft-store.js` per the interface. `idbBackend` is a thin promise wrapper (not unit-tested; covered by Task 8's browser check).
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit** `feat(editor): draft store for local copies`.

### Task 2: Draft logic and the post controller

**Files:**
- Create: `editor/assets/js/drafts/draft-logic.js`, `editor/assets/js/drafts/post-drafts.js`
- Test: `test/editor/draft-logic.test.js`, `test/editor/post-drafts.test.js`

**Interfaces:**
- Consumes: `createDraftStore`, `memoryBackend` (Task 1).
- Produces:
  - `postKey(siteId, docId) → 'post:<siteId|local>:<docId>'`; `newPostKey(siteId, stamp) → 'post:<site>:new-<stamp>'`.
  - Record shape: `{ docId: string|null, meta, blocks, regions, baseUpdated: string|null, seq: number, at: string (ISO) }`.
  - `restoreOffer(local, serverDoc) → null | { kind: 'restore'|'stale', at }` — `null` when no local copy or its content equals the server's (`meta` title/slug/tags/description/layout, `blocks`, `regions` compared as JSON); `'stale'` when `local.baseUpdated` differs from `serverDoc.meta.updated`; else `'restore'`.
  - `describeDifferences(local, serverDoc) → string[]` — plain lines, e.g. `'Title changed'`, `'Body: 2 blocks changed, 1 added'`, `'Aside: 1 block removed'`, `'Tags changed'`; at most 6 lines then `'…and more'`.
  - `createPostDrafts({ store, siteId, now = () => new Date().toISOString() }) → PostDrafts`:
    - `open(docId|null, serverDoc|null)` → sets the current key (a new post gets `newPostKey`), returns `restoreOffer(...)`.
    - `pendingNew() → Promise<Record|null>` — the newest `new-*` copy for this site.
    - `edited(snapshot{meta,blocks,regions})` → bumps `seq`, writes the record (coalesced: at most one write in flight; the last snapshot always lands).
    - `saveStarted() → token` (the current `seq`).
    - `saveConfirmed(token, { docId, updated, meta, blocks, regions })` → re-keys a new post to its id; pushes a version; clears the copy only if no edit came after `token`, otherwise updates `baseUpdated`.
    - `discard()` → removes the copy and pushes it as a version tagged `discarded: true`.
    - `versions() → Promise<Version[]>`.

- [ ] **Step 1: Write the failing tests**
  - `restoreOffer` returns `null` for equal content, `{kind:'restore'}` for same base and changed blocks, `{kind:'stale'}` when `baseUpdated` ≠ `meta.updated`.
  - `describeDifferences` names title, body counts and a region by its name; caps at 6 lines + `'…and more'`.
  - **edits during a save** (Review Focus 2): `edited` → `saveStarted` (token) → `edited` → `saveConfirmed(token, …)` leaves the copy present with the second edit and `baseUpdated` updated.
  - `saveConfirmed` with no later edit removes the copy and adds one version.
  - **new post** (Review Focus 3): `open(null, null)`, `edited(...)`; a fresh controller's `pendingNew()` returns it; `saveConfirmed(token,{docId:'doc_9',…})` moves it to `post:s:doc_9`.
  - **stale** (Review Focus 4): covered by `restoreOffer` above.
  - `discard()` removes the copy and `versions()[0].discarded === true`.
- [ ] **Step 2: Run** `node --test test/editor/draft-logic.test.js test/editor/post-drafts.test.js` — Expected: FAIL (modules not found).
- [ ] **Step 3: Implement** both modules per the interfaces.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(editor): decide when local copies are kept, cleared and offered`.

### Task 3: One editing tab per post

**Files:**
- Create: `editor/assets/js/drafts/tab-lock.js`
- Test: `test/editor/tab-lock.test.js`

**Interfaces:**
- Produces: `createTabLock({ key, channel = new BroadcastChannel('vp-edit-lock'), onLocked, onUnlocked }) → { claim(), takeOver(), release(), get owner }`. `claim()` announces `{type:'open', key, tab}`; an owner replies `{type:'owned'}` and the claimer calls `onLocked()` (read-only). `takeOver()` sends `{type:'take'}`; the previous owner calls `onLocked()`, the taker `onUnlocked()`. `release()` on `pagehide` lets a locked tab get `onUnlocked()`.

- [ ] **Step 1: Write the failing tests** using two real `BroadcastChannel` instances (Node global): second claimer locked; `takeOver` swaps; `release` unlocks the waiting tab; different keys don't interact.
- [ ] **Step 2: Run** `node --test test/editor/tab-lock.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `tab-lock.js` (tab id `crypto.randomUUID()`; wait 150 ms for an `owned` reply before considering the claim won).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(editor): one editing tab per post`.

### Task 4: The save bar

**Files:**
- Create: `editor/assets/js/components/save-bar.js`
- Modify: `editor/index.html` (a `<save-bar hidden>` directly after the header, before `<main class="editor-pane">`), editor CSS beside `.save-pill`
- Test: `test/editor/save-bar-dom.test.js`

**Interfaces:**
- Produces: `<save-bar>` with `show({ tone: 'error'|'warn'|'info', text, actions: [{ label, run }] })`, `clear()`, and `showRestore(offer, { differences: string[], onRestore, onRestoreAsNew, onDiscard })`. `role="status"` for info/warn, `role="alert"` for error. Show differences toggles a `<ul>` of the lines. For `offer.kind === 'stale'` the actions are **Restore as a new draft** and **Discard**, with text "Unsaved changes from <time>, made before this post was changed elsewhere". For `'restore'`: "Unsaved changes from <time>" with **Restore**, **Show differences**, **Discard**. Time formatted with `Intl.RelativeTimeFormat` ("2 minutes ago").

- [ ] **Step 1: Write the failing tests** (linkedom, as `media-picker-dom.test.js` does): error tone sets `role="alert"` and stays until `clear()`; restore offer shows three buttons and clicking Restore calls `onRestore` once and hides the bar; stale offer shows exactly "Restore as a new draft" and "Discard"; Show differences reveals the lines; `show({tone:'warn', text:"Unsaved work isn't protected in this browser"})` renders that text (Review Focus 5).
- [ ] **Step 2: Run** `node --test test/editor/save-bar-dom.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the element and its styles (full-width strip under the header; error uses the existing error token colours; buttons `class="secondary"`). User strings via `textContent` only.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(editor): a save bar that stays until a save problem is resolved`.

### Task 5: Wire the post editor

**Files:**
- Modify: `editor/assets/js/editor.js`, `editor/assets/js/site-mode.js` (only if the save pill text must defer to the bar)
- Test: `test/editor/post-drafts.test.js` (extend), `test/editor/save-errors.test.js` (new)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: `saveFailureMessage(err) → { tone, text } | null` exported from a new small module `editor/assets/js/drafts/save-failure.js` (pure), used by `handleSaveError`.

Behaviour to wire (each item is one edit in `editor.js`):
- On init: `createDraftStore(await idbBackend(), { onUnavailable: () => bar.show({ tone:'warn', text:"Unsaved work isn't protected in this browser" }) })`; if `idbBackend` rejects, use `memoryBackend()` and show the same warning.
- `dispatchTransaction`: where it now calls `debouncedSave()`, also `drafts.edited({ meta: metaToSave(getCurrentMeta()), blocks: toBlockAst(doc), regions: toRegionsAst(doc) })`. `metaEdited()` does the same.
- `saveDocument`/`createFromEditor`: `const token = drafts.saveStarted()` before the request; on success `drafts.saveConfirmed(token, saved)`; then `bar.clear()` if the bar shows a save failure.
- `handleSaveError`: keep the 409 and 400/422 paths; replace the quiet `setSaveStatus('unsaved')` fallback with `bar.show(saveFailureMessage(err))` and a retry every 10 s while offline (stop when a save succeeds). Conflict and `saveHold` also show the bar (tone `warn`, text from the existing messages) in addition to today's pill.
- `loadDocument`: after the doc is shown, `const offer = await drafts.open(doc.id, doc)`; if an offer, `bar.showRestore(offer, …)`. Restore replaces the editor doc in **one undoable transaction** (`tr.replaceWith(0, doc.content.size, fromBlockAst(...).content)` with meta set via `setCurrentMeta`), then saves. Restore as a new draft: `api.createDocument({ meta: { ...local.meta, slug: 'untitled-' + Date.now().toString(36), title: `${local.meta.title || 'Untitled'} (restored)`, status: 'draft' }, blocks, regions })` and load it. Discard: `drafts.discard()`.
- New post page (`doc_new`): `drafts.pendingNew()`; if one, offer it the same way (kind `'restore'`).
- `window.addEventListener('beforeunload', …)` prevents unload while `saveStatus` is not `'saved'`.
- Tab lock: after load, `createTabLock({ key: postKey(...) , onLocked: () => { view.setProps({ editable: () => false }); bar.show({ tone:'info', text:'This post is open in another tab', actions:[{ label:'Edit here instead', run: lock.takeOver }] }) }, onUnlocked: () => { view.setProps({ editable: () => true }); bar.clear() } })`; release on `pagehide` and when another post is loaded.

- [ ] **Step 1: Write the failing tests** — `save-errors.test.js`: `saveFailureMessage(new TypeError('Failed to fetch'))` → `{ tone:'error', text:"Can't reach Vanilla Press. Your changes are kept in this browser and will save when it's back." }` (Review Focus 1); a status-less error returns the same; a 500 returns `{tone:'error'}` with the server's message. Extend `post-drafts.test.js`: a restore of a `'restore'` offer followed by `saveConfirmed` leaves no copy.
- [ ] **Step 2: Run** `node --test test/editor/save-errors.test.js test/editor/post-drafts.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `save-failure.js` and the wiring above.
- [ ] **Step 4: Run** `node --test test/editor/*.test.js` — Expected: all pass (666 + the new ones).
- [ ] **Step 5: Commit** `feat(editor): keep every post edit in the browser and offer it back`.

### Task 6: Recent versions in post settings

**Files:**
- Create: `editor/assets/js/components/versions-list.js`
- Modify: `editor/assets/js/components/meta-panel.js` (a "Versions" `<details>` section after Appearance), `editor/assets/js/editor.js` (export `restoreVersion(version)`)
- Test: `test/editor/versions-list-dom.test.js`

**Interfaces:**
- Consumes: `PostDrafts.versions()` (Task 2), the Task 5 restore path.
- Produces: `<versions-list>` with `render(versions, { onLook, onRestore })`. Each row: relative time, `discarded` marked "Discarded copy", **Look** (shows `describeDifferences(version, current)` lines inline) and **Restore**. Restore is a normal undoable edit, saved as usual.

- [ ] **Step 1: Write the failing tests**: renders newest first with relative times; "Discarded copy" label; Restore calls `onRestore` with that version; empty list says "No earlier versions in this browser yet".
- [ ] **Step 2: Run** `node --test test/editor/versions-list-dom.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the element and the meta-panel section (rendered when the panel renders for a post; refreshed after each confirmed save).
- [ ] **Step 4: Run** `node --test test/editor/*.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(editor): recent versions of a post, kept in this browser`.

### Task 7: Layout editor local copy

**Files:**
- Modify: `editor/assets/js/layout-editor/main.js`, `editor/layout.html` (a `<save-bar hidden>` under the bar)
- Create: `editor/assets/js/drafts/layout-drafts.js`
- Test: `test/editor/layout-drafts.test.js`

**Interfaces:**
- Consumes: Tasks 1, 2 (`restoreOffer`-style logic), 4.
- Produces: `createLayoutDrafts({ store, siteId, kind, name })` with `open(serverHash) → null|{kind:'restore'|'stale', at}`, `edited({ tree, meta })`, `saveStarted()`, `saveConfirmed(token, newHash)`, `discard()`. Key `layout:<site>:<kind>:<name>`; record `{ tree, meta, baseHash, seq, at }`; stale when `baseHash` ≠ the file's hash.

- [ ] **Step 1: Write the failing tests**: offer `null` with no copy; `'restore'` on same hash; `'stale'` on a different hash; edit during save keeps the copy (as Task 2).
- [ ] **Step 2: Run** `node --test test/editor/layout-drafts.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** and wire: record on every edit where `main.js` sets `dirty = true`; token around `save()`; on `load()` show the offer — Restore mounts the copy's tree and marks dirty; stale offers only **Discard** and **Keep my copy** (mounts it, marked dirty; the next save then gets the existing 409 "changed on disk" path, so nothing is overwritten silently).
- [ ] **Step 4: Run** `node --test test/editor/*.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(layout-editor): keep unsaved layout edits in the browser`.

### Task 8: Browser check, README, full suite

**Files:**
- Modify: `README.md` (one paragraph: unsaved changes are kept in this browser, offered back on reopen; Versions in settings)
- Script (not committed): the session scratchpad, `never-lose-work-check.mjs`

- [ ] **Step 1: Browser check** against the app on 3017, site `thomasapowell-com`, with `**/api/**` non-GET aborted:
  1. Open a post, type "kept locally"; every PUT aborts → the bar says "Can't reach Vanilla Press…".
  2. Close the page; open the same post in a new page → "Unsaved changes from … ago" with Restore; Restore → the text "kept locally" is in the editor.
  3. Open the same post in two pages → the second shows "This post is open in another tab" and typing does nothing; Edit here instead → the first becomes read-only.
  4. Layout editor: edit `thomas`, abort its PUT, reload → restore offer appears.
  5. `git -C ~/src/thomasapowell.com status --short` unchanged.
  Expected: all five hold; record the output in the ledger.
- [ ] **Step 2: Run** `npm test` — Expected: 0 fail.
- [ ] **Step 3: Commit** `docs: unsaved changes are kept in this browser`.
