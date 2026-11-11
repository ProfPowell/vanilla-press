# Web Image Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Search Openverse, Pexels, Pixabay and Unsplash from the media
picker and the Media screen. A chosen image is kept as a credited copy, or
linked for Unsplash, with an optional edit first. The credit shows in the
figure caption. Keys are set on a grouped Services screen.

**Architecture:**
- The browser talks only to Vanilla Press's own server.
- An app-level services layer holds the keys
  (`~/.config/vanilla-press/services.json`, mode 0600). It runs per-source
  search adapters, caches the results it returns, and serves image bytes
  same-origin for a cached result only, by source and id, never by an
  arbitrary URL.
- Per-site media routes import a cached result, or take an uploaded blob
  (edited or downsized in the browser), and store credit columns.
- The figure block gains a `credit` attr that the HTML and Markdown
  renderers print after the caption.

**Tech Stack:**
- Node (built-in `fetch`, `node:test`) and better-sqlite3.
- Vanilla JS front end and Vanilla Breeze.
- ProseMirror in the editor (browser only).
- `@profpowell/image-editor` ^0.2.0.

**Spec:** `docs/superpowers/specs/2026-11-10-vp-web-image-search-design.md`

## Global Constraints

- No new runtime dependency, apart from upgrading `@profpowell/image-editor`
  to `^0.2.0`. No server-side image library.
- **Keys:**
  - They never reach the browser, a site, or a published page.
  - They're stored in `join(configDir(env), 'services.json')`, written with
    mode `0o600`.
  - API responses expose only `hasKey`.
- **Errors:**
  - A source that isn't ready (missing key, or turned off) is skipped
    silently.
  - A source that fails or times out (8 seconds) becomes an entry in
    `errors`, and never fails the whole search.
- **Licenses and size:**
  - Openverse searches only `license=by,cc0,pdm`. No NC, ND or SA.
  - A copy is at most 2,400px on the long edge, or Pixabay's
    `largeImageURL` as is. Copies obey `MAX_BYTES` (25 MiB) and the accepted
    types (`src/media/limits.js`, `src/media/inspect.js`).
- **Pixabay caching:** search responses are cached for 24 hours. Other
  sources are cached for 1 hour.
- **Unsplash:**
  - Results have `mode: 'link'`. They're never copied or edited, and appear
    in the picker only (`for=picker`).
  - Inserting one pings its `download_location`.
  - Credit links carry `utm_source=vanilla_press&utm_medium=referral`.
- **Credit copy:**
  - `Photo by {name}`, then ` on {site}`, then `, {license}` (only when
    there's a license), then `, adapted` (only when adapted).
  - With no name: `Photo from {site}`.
  - Every part with a URL is a link.
- **Rules carried over from earlier work:**
  - Pure modules tested in Node may import only `prosemirror-state` and
    `prosemirror-model` from ProseMirror. The browser gets the rest from
    the esm.sh import map.
  - No `alert`, `confirm` or `prompt`.
  - Never touch `~/src/vanilla-breeze`.
  - Never stage `CLAUDE.md`.
  - Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Tests:** unit tests never touch the network. Adapters and routes take
  an injected `fetch`.

## Review Focus

1. **A key with spaces or a newline pasted in.** The key is trimmed. An
   empty key clears it. A wrong key shows that source's error ("Pexels
   didn't accept the key") in the results, not a broken search. *Tests in
   Tasks 1 and 2.*
2. **An import or proxy request for a result that's no longer cached**
   (after a restart, or past its TTL). It answers 404 with "Search again —
   this result has expired". It never fetches a URL the client supplies.
   *Test in Task 3.*
3. **An Openverse original that's huge (6,000px or 30 MB).** The flow
   downsizes it in the browser before uploading. Nothing over `MAX_BYTES`
   is stored, and the server refuses an oversized direct import with 413.
   *Tests in Tasks 3 and 5.*
4. **The writer's own caption plus a credit, saved and reopened.** The
   credit survives, isn't editable text, and isn't duplicated. Deleting
   all of the caption text leaves the credit. *Tests in Task 4.*
5. **A filename from a web result with odd characters or none.** The
   stored filename comes from the source and id
   (`pexels-12345.jpg`), never from raw remote text. *Test in Task 3.*

---

### Task 1: Services settings: catalog, key store, and API

**Files:**
- Create: `src/services/catalog.js`, `src/services/store.js`, `src/app/service-routes.js`
- Modify: `src/app/server.js` (mount the routes next to `/api/sites`, ~line 366)
- Test: `test/services/store.test.js`, `test/app/service-routes.test.js`

**Interfaces:**
- Produces:
  - `SERVICE_GROUPS`:
    `[{ id: 'image-search', label: 'Image search' }, { id: 'sound-video', label: 'Sound and video' }, { id: 'ai', label: 'AI generation' }]`.
  - `SERVICES`: entries of
    `{ id, label, group, needsKey, signupUrl, mode: 'copy'|'link' }`:
    - `openverse`: "Openverse", no key, copy.
    - `pexels`: "Pexels", key, `https://www.pexels.com/api/`, copy.
    - `pixabay`: "Pixabay", key, `https://pixabay.com/api/docs/`, copy.
    - `unsplash`: "Unsplash", key, `https://unsplash.com/developers`, link.
  - `readServices(env) -> { [id]: { key?: string, enabled?: boolean } }`.
  - `updateService(id, { key?, enabled? }, env) -> ServiceState`.
  - `serviceKey(id, env) -> string|null`.
  - `servicesState(env) -> { groups: [{ id, label, services: ServiceState[] }] }`.
  - `ServiceState` is `{ id, label, needsKey, hasKey, enabled, ready, signupUrl }`, where
    `ready = enabled && (!needsKey || hasKey)`.
  - Routes: `GET /api/services` gives `servicesState`.
    `PUT /api/services/:id` takes `{ key?: string|null, enabled?: boolean }` and
    gives `ServiceState`. An unknown id gives 404; a bad body gives 400.

- [ ] **Step 1: Write the failing tests.** Use a temp `VP_CONFIG_DIR`.
  - `updateService('pexels', { key: '  abc\n' })` stores `abc`.
  - `{ key: '' }` and `{ key: null }` remove the key.
  - The file mode is `0o600`.
  - `servicesState()` lists 3 groups in order. Image search has 4 services.
    No key appears anywhere in its JSON.
    `openverse.ready === true` with no file at all.
  - `enabled: false` makes `ready` false.
  - Route tests: `GET` shape; `PUT` for an unknown id → 404; `PUT` with
    `{ key: 5 }` → 400; the `PUT` response never contains the key.
- [ ] **Step 2:** Run `node --test test/services/store.test.js test/app/service-routes.test.js`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement. `store.js` writes atomically, reusing `src/sync/atomic-write.js` where it fits, then `chmodSync(0o600)`.
- [ ] **Step 4:** Run the tests again. Expected: PASS. Then run `npm test`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(services): grouped services settings with a machine-local key store`.

### Task 2: Image search adapters and the search route

**Files:**
- Create: `src/services/image-sources/openverse.js`, `pexels.js`, `pixabay.js`, `unsplash.js`, `src/services/image-search.js`
- Modify: `src/app/service-routes.js`
- Test: `test/services/image-sources.test.js` (fixture JSON in `test/fixtures/image-sources/`), `test/services/image-search.test.js`

**Interfaces:**
- Consumes: `serviceKey`, `servicesState` and `SERVICES` (Task 1).
- Produces:
  - `WebImage`:
    - `{ source, id, mode, thumb, url, width, height, description }`;
    - `credit: Credit` (the shape is in Task 4);
    - `downloadLocation?` (Unsplash only).
  - Each adapter exports `request(query, { page, key }) -> { url, headers }`
    and `normalize(json) -> { results: WebImage[], hasMore: boolean }`.
  - `createImageSearch({ env, fetch, now }) -> { search(q, { page, for }), get(source, id) -> WebImage|null, image(source, id) -> Promise<{ data: Buffer, contentType }> }`.
    - `search` returns `{ results, errors: [{ source, label, message }], hasMore }`.
    - Results are interleaved round-robin across sources.
    - `for: 'library'` drops `mode: 'link'` sources.
  - Route: `GET /api/web-images?q=&page=&for=picker|library`. An empty `q` gives 400.

**Adapter mapping (exact):**
- **Openverse:**
  - Request:
    `GET https://api.openverse.org/v1/images/?q=&page=&page_size=20&license=by,cc0,pdm&mature=false`.
    No auth.
  - `url` = `url`, `thumb` = `thumbnail`.
  - `credit = { name: creator, url: creator_url, site: TitleCase(source), siteUrl: foreign_landing_url, license, licenseUrl: license_url }`.
  - License text: `CC BY {version}` for `by`. Empty for `cc0` and `pdm`,
    and then `licenseUrl` is empty too.
- **Pexels:**
  - Request: `GET https://api.pexels.com/v1/search?query=&page=&per_page=20`,
    with header `Authorization: <key>`.
  - `url` = `src.large2x`, `thumb` = `src.medium`, `description` = `alt`.
  - `credit = { name: photographer, url: photographer_url, site: 'Pexels', siteUrl: url }`.
- **Pixabay:**
  - Request:
    `GET https://pixabay.com/api/?key=&q=&page=&per_page=20&image_type=photo&safesearch=true`.
  - `url` = `largeImageURL`, `thumb` = `webformatURL`, `description` = `tags`.
  - `credit = { name: user, url: 'https://pixabay.com/users/' + user + '-' + user_id + '/', site: 'Pixabay', siteUrl: pageURL }`.
- **Unsplash:**
  - Request: `GET https://api.unsplash.com/search/photos?query=&page=&per_page=20`,
    with header `Authorization: Client-ID <key>`.
  - `mode: 'link'`.
  - `url` = `urls.raw + '&w=2400&fit=max&q=80&auto=format'`, `thumb` = `urls.small`.
  - `description` = `alt_description || description`.
  - `downloadLocation` = `links.download_location`.
  - `credit = { name: user.name, url: user.links.html + UTM, site: 'Unsplash', siteUrl: links.html + UTM }`.
- **Width and height:** each source gives them for its original. Scale them
  to `url`'s size where the source documents it (Pexels `large2x` is 940
  CSS px at 2× density). Otherwise keep the original's size and let Task 5
  downsize.

- [ ] **Step 1: Write the failing tests.**
  - Each adapter's `normalize` on its fixture gives the exact `WebImage`
    fields above. The Openverse `cc0` item has `license: ''`.
  - Each `request` builds the exact URL and header.
  - `search`:
    - skips sources that aren't ready, so the fake `fetch` is never called
      for them;
    - a source returning 401 gives the error entry
      `{ source: 'pexels', label: 'Pexels', message: "Pexels didn't accept the key" }`;
    - a timeout (fake `fetch` never resolves; the timeout is injectable)
      gives `"Pexels didn't answer in time"`;
    - other sources' results still come back;
    - a second identical Pixabay query within 24 hours doesn't call
      `fetch`, while a Pexels query after 1 hour does (injected `now`);
    - `for: 'library'` drops Unsplash.
  - `get(source, id)` returns a result from an earlier search and `null`
    for an unknown one.
- [ ] **Step 2:** Run `node --test test/services/`. Expected: FAIL.
- [ ] **Step 3:** Implement. The cache is in memory, keyed by
  `source|query|page`, and also indexes results by `source|id` for `get`.
  `image()` fetches only `get(source, id).url`.
- [ ] **Step 4:** Run `node --test test/services/` and then `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(services): image search across Openverse, Pexels, Pixabay and Unsplash`.

### Task 3: Credited media: columns, import, the image proxy, and the Unsplash ping

**Files:**
- Create: `src/media/credit.js`
- Modify:
  - `src/store/schema.sql` and `src/store/migrate.js` (add columns);
  - `src/sync/site-files.js:20` and `src/sync/media-library.js` (mirror the
    columns to `media.json`);
  - `src/server/api.js` (`mediaItem`, `POST /api/media`, `PUT /api/media/:id`, new
    `POST /media/import`);
  - `src/app/service-routes.js` (proxy and Unsplash routes);
  - `src/app/server.js` (pass `webImages` into `mountApi`).
- Test: `test/media/credit.test.js`, `test/server/media-import.test.js`, `test/app/web-image-routes.test.js`

**Interfaces:**
- Consumes: `createImageSearch().get` and `.image` (Task 2).
- Produces:
  - `Credit`: `{ name?, url?, site?, siteUrl?, license?, licenseUrl?, adapted?: boolean }`.
    Strings are trimmed, and empty strings are dropped.
  - `normalizeCredit(x) -> Credit|null`.
  - `creditParts(credit) -> Array<{ text, href? }>`, following the Global
    Constraints copy.
  - `creditText(credit) -> string`.
  - `validCredit(x) -> boolean`.
  - Media columns: `source TEXT` (`openverse|pexels|pixabay|manual|null`),
    `credit TEXT` (a JSON `Credit`).
  - `mediaItem` gains `source` and `credit: Credit|null`.
  - `POST /api/media` accepts multipart fields `credit` (a JSON string) and
    `source`.
  - `PUT /api/media/:id` takes `{ alt?, credit? }`. At least one is
    required. `credit: null` clears it and sets `source` to `manual`,
    unless the image already has a web source.
  - `POST {prefix}/media/import` takes `{ source, id, alt? }` and gives
    201 `MediaItem`.
    - It answers 404 `"Search again — this result has expired"` for an
      unknown result.
    - It answers 400 for a `link` source.
    - It answers 413 when the bytes are over `MAX_BYTES`.
    - The filename is `mediaFilename(`${source}-${id}`, ext, …)`.
    - The alt is `alt ?? description`.
  - `GET /api/web-images/:source/:id/image` streams the cached result's
    bytes with its content type (404 when unknown).
  - `POST /api/web-images/unsplash/:id/download` calls `downloadLocation`
    with the key (204, or 404 when unknown).
  - `mountApi` option: `webImages: { get, image }`.

- [ ] **Step 1: Write the failing tests.**
  - `creditParts`:
    - for `{ name: 'Jane', url: 'u1', site: 'Pexels', siteUrl: 'u2' }`, it
      gives `[{ text: 'Photo by ' }, { text: 'Jane', href: 'u1' }, { text: ' on ' }, { text: 'Pexels', href: 'u2' }]`;
    - with a license and `adapted`, the text ends with
      `, CC BY 4.0, adapted`, and the license part links to `licenseUrl`;
    - with no name, it gives `Photo from Pexels`.
  - The migration adds `source` and `credit` to an existing database.
  - `media.json` round-trips `credit`.
  - Import (fake `webImages`):
    - it stores `pexels-123.jpg` with `source: 'pexels'` and the credit;
    - an unknown id → 404 with the exact message;
    - a link source → 400;
    - oversized bytes → 413, and no file is left behind;
    - a remote description with `../` or slashes doesn't affect the
      filename.
  - Multipart upload with a `credit` field stores it. `adapted: true`
    survives.
  - `PUT` with a credit updates it. `PUT` with neither alt nor credit → 400.
  - The proxy route returns the bytes for a cached result, and 404
    otherwise. No route accepts a URL parameter.
- [ ] **Step 2:** Run `node --test test/media/credit.test.js test/server/media-import.test.js test/app/web-image-routes.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement. `src/media/credit.js` is pure, with no Node
  imports, because the editor imports it from `/src/media/credit.js`.
- [ ] **Step 4:** Run the same tests and then `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(media): credited media, import from a search result, same-origin image proxy`.

### Task 4: Figure credit in content, renderers and editor

**Files:**
- Modify:
  - `src/schema/content-schema.js:51` (figure `credit: { type: 'credit' }`);
  - `src/schema/validate.js:252` (type `credit` checked with `validCredit`);
  - `src/renderers/html.js:219` and `src/renderers/markdown.js:123`;
  - `editor/assets/js/schema.js:314` (figure attr `credit`, default `null`;
    `parseDOM` reads the credit from `small.credit` and doesn't feed it to
    the caption content);
  - `editor/assets/js/ast.js:209,467` (round-trip `credit`);
  - `editor/assets/js/blocks/figure-view.js` (show the credit after the
    caption, `contenteditable=false`).
- Test: `test/renderers/figure-credit.test.js`, `test/editor/figure-credit.test.js`, `test/schema/validate.test.js` (add cases)

**Interfaces:**
- Consumes: `normalizeCredit`, `creditParts` and `validCredit` (Task 3).
- Produces:
  - Figure block attr `credit: Credit` (optional).
  - HTML: `<figure><img …/>\n<figcaption>{caption} <small class="credit">{parts}</small></figcaption></figure>`.
    - Links are `<a href="…" rel="noopener">`.
    - The leading space is there only when a caption exists.
    - With no caption, the output is `<figcaption><small class="credit">…</small></figcaption>`.
  - Markdown: the same `<small class="credit">…</small>` HTML on its own
    line after the caption line, or after the image when there's no
    caption.

- [ ] **Step 1: Write the failing tests.**
  - The HTML render with a caption "Harbor at dawn" and a Pexels credit is
    exactly
    `<figure>\n<img src="/media/a.jpg" alt="Boats"/>\n<figcaption>Harbor at dawn <small class="credit">Photo by <a href="u1" rel="noopener">Jane</a> on <a href="u2" rel="noopener">Pexels</a></small></figcaption>\n</figure>`.
  - With no caption: `<figcaption><small class="credit">…</small></figcaption>`.
  - Credit text is HTML-escaped: a name of `<b>` renders as `&lt;b&gt;`.
    A `javascript:` URL is dropped and rendered as plain text.
  - Markdown cases mirror the HTML ones.
  - `validate` accepts a figure with a valid credit and rejects
    `credit: { name: 5 }`.
  - The editor (Node, `fromBlockAst`/`toBlockAst`) round-trips the credit
    unchanged.
  - A figure with a credit and empty caption text still has its credit
    after a round trip.
  - Parsing the rendered HTML back in (schema `parseDOM`) gives the same
    credit, and caption text without the credit words. This guards
    against a duplicated credit.
- [ ] **Step 2:** Run `node --test test/renderers/figure-credit.test.js test/editor/figure-credit.test.js test/schema/`. Expected: FAIL.
- [ ] **Step 3:** Implement. The figure view renders `creditParts` as text
  and links, inside a `contenteditable=false` element after the caption
  content hole.
- [ ] **Step 4:** Run the same tests and then `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(editor): figure credit, rendered after the caption and kept out of its text`.

### Task 5: The web search panel and import flow in the media picker

**Files:**
- Create: `editor/assets/js/components/web-image-search.js` (a custom element, `<web-image-search>`), `editor/assets/js/web-image-flow.js`, `editor/assets/js/image-fit.js` (pure)
- Modify:
  - `editor/assets/js/components/media-picker.js` (add "Your library" and
    "From the web" tabs);
  - `editor/assets/js/api-client.js` (`searchWebImages`, `importWebImage`,
    `pingUnsplash`, `uploadMedia` with credit);
  - `editor/assets/js/media-insert.js` (a figure from an item carries
    `credit`);
  - `package.json` (`@profpowell/image-editor` `^0.2.0`, then `npm install`).
- Test: `test/editor/image-fit.test.js`, `test/editor/media-insert.test.js` (add cases)

**Interfaces:**
- Consumes:
  - the routes from Tasks 2 and 3;
  - `creditParts` (Task 3);
  - the figure `credit` attr (Task 4).
- Produces:
  - `fitWithin(width, height, max = 2400) -> { width, height, scaled: boolean }`.
  - `<web-image-search for="picker|library">`:
    - it fires `web-image-choose` with `{ result, edit: boolean }`;
    - each result card shows the thumbnail, `creditText`, and buttons
      "Insert" (or "Add" when `for=library`) and "Edit first" (hidden for
      `mode: 'link'`);
    - the per-source `errors` show as one line each above the grid;
    - search is debounced by 400ms;
    - "Load more" uses `page + 1` while `hasMore`.
  - `chooseWebImage(result, { edit, site }) -> Promise<MediaItem | { src, alt, credit }>`:
    - **Link (Unsplash):** call `pingUnsplash`, then return
      `{ src: result.url, alt: result.description, credit }`.
    - **Edit:** load `/api/web-images/:source/:id/image` into
      `<image-editor>`. On Save, call `getBlob`, downsize with `fitWithin`,
      then upload with `credit: { ...credit, adapted: true }` and the source.
    - **Too big** (`fitWithin(...).scaled`): canvas-downsize the proxied
      image, then upload with the credit, with `adapted` false.
    - **Otherwise:** `importWebImage`.
  - After a copy is stored, the picker runs its existing alt-text step
    (media-picker.js:181-207), with the alt pre-filled from the result's
    description, before resolving.
  - The picker resolves with the `MediaItem`, or with the link object for
    Unsplash. `media-insert` builds a figure `{ src, alt, credit }` from
    either.
  - The featured image and component pickers get the same tabs and use
    `src` only.

- [ ] **Step 1: Write the failing tests.**
  - `fitWithin(6000, 4000)` gives `{ width: 2400, height: 1600, scaled: true }`.
  - `fitWithin(1280, 853)` gives `{ width: 1280, height: 853, scaled: false }`.
  - Portrait: `fitWithin(3000, 6000)` gives `{ width: 1200, height: 2400, scaled: true }`.
  - The `media-insert` figure from an item with a credit carries it, and
    one without a credit has no `credit` attr.
- [ ] **Step 2:** Run `node --test test/editor/image-fit.test.js test/editor/media-insert.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement the element, the flow and the picker tabs. The
  library tab is today's picker unchanged.
- [ ] **Step 4:** Run the same tests and `npm test`. Expected: PASS.
- [ ] **Step 5: Browser check.** Write a time-limited Playwright script in
  the scratchpad. Stub `/api/web-images*` with `page.route`, using a local
  PNG as the image bytes.
  - Picker → From the web → search → Insert. The figure shows the image
    and "Photo by … on Pexels" after the caption.
  - The same with "Edit first": the editor opens, Save inserts, and the
    credit ends with ", adapted".
  - An Unsplash result has no "Edit first", and inserts by link.
  - A per-source error line shows while other results still appear.
  - No page errors. Save screenshots.
- [ ] **Step 6:** Commit: `feat(editor): search the web from the media picker; insert, or edit first`.

### Task 6: Media screen: Add from web, and editing the credit

**Files:**
- Modify: `app/assets/js/media-page.js` (an "Add from web" button opening a `<dialog>` with `<web-image-search for="library">`), `app/assets/js/media-detail.js` (credit fields), `app/assets/js/app-api.js`
- Test: `test/app/media-detail.test.js` (add cases; follow the file's existing pure-model pattern)

**Interfaces:**
- Consumes: `<web-image-search>` and `chooseWebImage` (Task 5); `PUT /api/media/:id` with `credit` (Task 3).
- Produces:
  - The detail panel has a "Credit" fieldset: creator, creator link,
    site, site link, license, license link, and an "Adapted" checkbox.
  - Save sends `PUT { credit }`.
  - A note under the fieldset reads: "Changes apply to new uses of this
    image. Posts that already use it keep their credit."
  - A web image shows its source ("From Pexels").

- [ ] **Step 1: Write the failing tests.**
  - The credit form model, from a `MediaItem` with a credit, fills every
    field.
  - Clearing every field gives `credit: null`.
  - A `javascript:` link is refused with the message
    "Links must start with http:// or https://".
- [ ] **Step 2:** Run `node --test test/app/media-detail.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same test and `npm test`. Expected: PASS.
- [ ] **Step 5: Browser check.** Stub the web routes as in Task 5.
  - Media → Add from web → Add. The image appears in the grid, and its
    detail panel shows "From Pexels" and the credit.
  - Edit the credit name and save, then reload: the change has persisted.
  - Run axe on the dialog: no serious or critical violations.
- [ ] **Step 6:** Commit: `feat(app): add images from the web on the Media screen; edit an image's credit`.

### Task 7: The Services screen

**Files:**
- Create: `app/services.html`, `app/assets/js/services-page.js`
- Modify: `app/index.html` (a "Services" link in the top bar), `app/site.html` (a "Services" link in the rail, under the sections, opening `/app/services.html`)
- Test: `test/app/services-page.test.js` (the pure view model)

**Interfaces:**
- Consumes: `GET /api/services` and `PUT /api/services/:id` (Task 1).
- Produces:
  - A page with one section per group, in `SERVICE_GROUPS` order.
  - Groups with no services show "Coming in a later update".
  - **Each service row has:**
    - its label;
    - a status of "Ready", "Needs a key" or "Turned off";
    - when it needs a key: a password-type key field with "Save key", and
      "Remove key" once set;
    - a "Get a key" link (`signupUrl`, `target=_blank rel=noopener`);
    - an "On" switch.
  - The key field never shows the stored key. When a key is set, its
    placeholder reads "Key saved — enter a new one to replace it".

- [ ] **Step 1: Write the failing tests.** The view model from a
  `servicesState` fixture:
  - Sound and video and AI generation each show the "Coming in a later
    update" text.
  - Openverse shows "Ready" and no key field.
  - Pexels without a key shows "Needs a key".
  - Pixabay with `enabled: false` shows "Turned off".
- [ ] **Step 2:** Run `node --test test/app/services-page.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement, styled with the app's brand chrome like the
  other app pages.
- [ ] **Step 4:** Run the same test and `npm test`. Expected: PASS.
- [ ] **Step 5: Browser check.** On the real app with a temp `VP_CONFIG_DIR`:
  - Save a Pexels key. The status turns "Ready", and the page source and
    network responses never contain the key.
  - Remove it.
  - Turn Openverse off, then on.
  - Check light and dark screenshots, and run axe with no serious or
    critical violations.
- [ ] **Step 6:** Commit: `feat(app): Services screen for image search keys, grouped by purpose`.
