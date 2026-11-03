# Component System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any VB-family web component can be put in a post, edited live in the editor, switched on per site, and loads on the live site only on the pages that use it.

**Architecture:**
- **Cook** gets a `package-components` plugin. For every dependency of the site that ships a `custom-elements.json`, it copies the package's built files into the output, and it adds a module `<script>` only to the pages that use one of its tags.
- **Vanilla Press:**
  - A catalog of editor hints plus each package's manifest becomes a list of component descriptors.
  - One generic `component` content node (block and inline) is validated and rendered from those descriptors.
  - A site's enabled components are simply the catalog packages in its `package.json` dependencies.
  - The editor renders the real element, with a settings panel generated from the descriptor.

**Deviation from the spec, recorded:** the spec suggested extending `autoComponents`. This plan adds a separate Cook plugin instead. `autoComponents` is off by default, and turning it on also strips VB's bundle from pages, a behavior change the user's sites didn't ask for. `package-components` is on by default and acts only on dependencies that ship a manifest.

**Tech Stack:**
- Node 22, `node:test`, better-sqlite3, ProseMirror (via esm.sh in the editor), Vanilla Breeze.
- Cook SSG (jsdom-based plugins).
- Component packages from npm: `@profpowell/*`.

**Spec:** `docs/superpowers/specs/2026-11-03-vp-components-design.md`. Step 1's spec, `2026-11-02-vp-app-core-design.md`, and its rulings, `docs/superpowers/followups/2026-11-03-vp-app-core.md`, still hold.

**Repos:**
- `~/src/cook` (branch `feat/package-components` off `master`): Task 1 only.
- `~/src/vanilla-press` (branch `feat/components` off `main`): every other task.

## Global Constraints

- Node with no front-end framework. The UI uses VB. The app listens on localhost only, behind the existing Host/Origin guard.
- VP stages only its own paths. The site's files in git are the source of truth.
- Post JSON stays readable without VP. A block component is `{ "type": "component", "tag": "...", "attrs": {...} }`, plus `value` or `children`. Its HTML output is the plain element.
- Sites get component code from npm only, at the versions in their lockfile.
- The editor uses the site's installed copy of a package when the site has it (`<site>/node_modules/<pkg>`), else VP's own install.
- Existing hand-built blocks (callout, collapsible, card, tabs, steps, figure, embed, code_block) are not changed or migrated.
- No browser `alert()` or `confirm()` anywhere new. Remove any found in code this plan touches.
- Every failure the user can see says what happened and what to do.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Pushing, merging and `npm publish` are the controller's to ask about. Implementers only commit.
- **First catalog: packages**
  - `@profpowell/code-block`, `@profpowell/browser-window`, `@profpowell/terminal-window`, `@profpowell/code-playground`, `@profpowell/pdf-viewer`, `@profpowell/bg-wc`, `@profpowell/border-wc`, `@profpowell/marquee-wc`, `@profpowell/blink-wc`, `@profpowell/image-editor`.
- **First catalog: VB elements** (always on, loaded by the site's VB bundle)
  - `audio-player`, `video-player`, `image-gallery`, `youtube-player`, `social-embed`, `foot-notes`, `accordion-wc`, `carousel-wc`, `diagram-wc`, `geo-map`, `qr-code`.
  - `chart-wc` is left out: it lives in VB's separate charts bundle.
- **Content kinds:**
  - `none`, `text`, `code` and `blocks` for block display;
  - `inline` for inline display.

## Review Focus

1. **Attribute values with `"`, `<`, `&`, or a newline** render escaped and come back unchanged. Only catalog tags that match the custom-element name pattern are ever emitted, so a crafted `tag` like `img onerror=…` or `script` is rejected. Tests: Task 3, `escapes attribute values` and `rejects unsafe tag`.
2. **The site's installed version of a package differs from VP's,** for example the site's copy lacks an attribute VP's copy declares. The descriptors, and so the form and validation, follow the site's manifest. Test: Task 2, `site copy wins over VP copy`.
3. **Turning a component off while only a draft uses it** is refused, and the draft is named. Turning off checks every post, not only published ones. Test: Task 4, `refuses disable while a draft uses it`.
4. **The package was removed by hand outside VP** while a post still uses it:
   - the editor shows "not on for this site";
   - Publish refuses with the element's name and changes nothing.

   Test: Task 4, `publish refuses a post using a component that is off`.
5. **Enabling when `package.json` has the user's uncommitted edits,** or when `npm install` fails (offline):
   - nothing changes, and `package.json` and `package-lock.json` are byte-identical afterwards;
   - the message says why.

   Tests: Task 4, `refuses enable when package.json is dirty` and `failed install restores package files`.

---

### Task 1: Cook `package-components` plugin (repo `~/src/cook`)

**Files:**
- Create: `scripts/plugins/package-components.js`
- Modify:
  - `scripts/build.js`: copy once in the pre-loop next to `optimizeImagesGenerate`; per-page injection right after `autoComponents`.
  - `scripts/utils/config/config.js`: add `packageComponents` defaults and export it.
  - `package.json`: version `2.5.0`.
- Create: `docs-site/src/docs/package-components.md`. Link it from `docs-site/src/docs/auto-components.md` and the docs nav in `docs-site/config/main.js`.
- Test: `test/package-components.test.js`, end to end through `bin/cook.js` in a temp project, in the style of `test/html-collections-build.test.js`.

**Interfaces:**
- Produces config `packageComponents: { enabled: true, exclude: ['vanilla-breeze', 'cook-ssg'], path: 'assets/components' }`. On by default: it only acts on dependencies that ship a manifest.
- **Package discovery:**
  - The packages are the keys of `dependencies` in the project's `package.json`, minus `exclude`.
  - Each package is resolved at `node_modules/<name>`.
  - Its manifest is the file named by `customElements` in its `package.json`, else `custom-elements.json`.
  - Its entry is `exports['.'].import`, else `exports['.'].default`, else `exports['.']` when it is a string, else `module`, else `main`.
- **Copy:** the entry's whole directory (e.g. `dist/`, so chunk files come along) is copied to `<distPath>/<path>/<name>/`, for example `dist/assets/components/@profpowell/browser-window/browser-window.js`.
- **Tag map:** every `tagName` in the manifest maps to `/<path>/<name>/<entry path relative to its directory>`.
- **Per page:** for each custom-element tag on the page that is in the map, append one `<script type="module" src="…">` to `<head>`. A package appears once per page even when several of its tags are used. Tags are skipped when their script is already on the page.
- A dependency with no manifest, no `node_modules` folder, or no entry is skipped with one log line. It never fails the build.

- [ ] **Step 1: Write the failing tests** in `test/package-components.test.js`. The temp project has:
  - `package.json` dependencies `{ "x-widgets": "1.0.0", "no-manifest": "1.0.0", "vanilla-breeze": "1.0.0" }`;
  - `node_modules/x-widgets/` with `package.json` (`"exports": { ".": { "import": "./dist/x.js" } }`), `custom-elements.json` declaring `x-one` and `x-two`, `dist/x.js` and `dist/chunk-a.js`;
  - `node_modules/no-manifest/` with a package.json and `index.js`;
  - `node_modules/vanilla-breeze/` with a manifest declaring `x-vb`;
  - pages `src/uses.html` (contains `<x-one></x-one><x-two></x-two><x-one></x-one>`), `src/plain.html` (no custom elements) and `src/vb.html` (contains `<x-vb>`).

  ```js
  test('copies the package dist, chunks included', async () => {
    assert.ok(await exists('dist/assets/components/x-widgets/x.js'));
    assert.ok(await exists('dist/assets/components/x-widgets/chunk-a.js'));
  });
  test('a page using two tags of one package gets one script', async () => {
    const html = await read('dist/uses.html');
    assert.equal(html.match(/<script type="module" src="\/assets\/components\/x-widgets\/x\.js"><\/script>/g).length, 1);
  });
  test('a page with no package tags gets no component script', async () => {
    assert.doesNotMatch(await read('dist/plain.html'), /assets\/components/);
  });
  test('excluded and manifest-less dependencies are ignored', async () => {
    assert.ok(!(await exists('dist/assets/components/vanilla-breeze')));
    assert.ok(!(await exists('dist/assets/components/no-manifest')));
    assert.doesNotMatch(await read('dist/vb.html'), /assets\/components/);
  });
  test('enabled: false does nothing', async () => { /* rebuild with config/main.js packageComponents: { enabled: false } */
    assert.ok(!(await exists('dist/assets/components')));
    assert.doesNotMatch(await read('dist/uses.html'), /assets\/components/);
  });
  ```
- [ ] **Step 2: Run** `node --test test/package-components.test.js`. Expected: FAIL, because nothing is copied.
- [ ] **Step 3: Implement** `packageComponentsCopy({ store })`, which runs once, fills `store.packageComponentsMap` (tag → URL), and copies the files. Implement `packageComponentsInject({ file, store, allowType })`, which works per page. Wire both into `scripts/build.js` at the points named above, so `cook dev` (which calls `runBuild`) gets them too. Use `Util.fileDom` and `Util.commitDom`, like `auto-components.js`.
- [ ] **Step 4: Run** `node --test test/package-components.test.js`, then `npm test`. Expected: all PASS.
- [ ] **Step 5: Docs.** `package-components.md` covers what it does, the config table, and how it differs from `autoComponents`, which handles VB's own bundle. Add a dated `2.5.0` entry wherever Cook keeps release notes (`ROADMAP.md` or the docs changelog page, whichever the repo uses). Bump `package.json` to `2.5.0` and run `npm install --package-lock-only`.
- [ ] **Step 6: Commit**
  ```bash
  git add scripts/plugins/package-components.js scripts/build.js scripts/utils/config/config.js test/package-components.test.js docs-site package.json package-lock.json ROADMAP.md
  git commit -m "feat: package-components loads npm web components per page (2.5.0)"
  ```
  **Controller stop after this task:** merging to Cook `master`, pushing, and `npm publish` of 2.5.0 are the user's call (`! npm publish --otp=<code>`). Tasks 2–7 don't need the release. Task 8 does.

---

### Task 2: Component catalog and descriptors

**Files:**
- Create:
  - `src/components/catalog.js`: editor hints, static data, no fs.
  - `src/components/manifest.js`: reads a `custom-elements.json`.
  - `src/components/describe.js`: catalog plus manifests → descriptors, per site.
- Modify: `package.json` dependencies.
  - Add the packages from Global Constraints at their current npm versions: `@profpowell/browser-window ^1.4.7`, `@profpowell/terminal-window ^2.1.0`, `@profpowell/code-playground ^0.2.0`, `@profpowell/pdf-viewer ^0.2.0`, `@profpowell/bg-wc ^0.4.0`, `@profpowell/border-wc ^0.2.0`, `@profpowell/image-editor ^0.1.0`.
  - Bump `@profpowell/code-block` to `^2.9.0`.
  - Add `@profpowell/marquee-wc ^1.7.0` and `@profpowell/blink-wc ^1.5.0` (now on npm).
- Test: `test/components/manifest.test.js`, `test/components/catalog.test.js`, `test/components/describe.test.js`, plus fixture packages under `test/fixtures/components/`.

**Interfaces:**
- Produces, in `catalog.js`:
  ```js
  /** @typedef {'none'|'text'|'code'|'blocks'|'inline'} ContentKind */
  /** @typedef {{ tag: string, label: string, icon: string, description: string, group: string,
   *   kind: ContentKind, codeWrap?: 'text'|'template'|'script', codeLanguage?: string,
   *   defaults: Record<string, string|number|boolean>, advanced: string[] }} ElementHint */
  /** @typedef {{ package: string, bundled?: boolean, elements: ElementHint[] }} CatalogEntry */
  export const CATALOG; // CatalogEntry[]: 10 @profpowell packages + one { package: 'vanilla-breeze', bundled: true, elements: [11 VB tags] }
  export const CONTENT_KINDS = ['none', 'text', 'code', 'blocks', 'inline'];
  ```
  `kind: 'inline'` means inline display; every other kind is block display. `codeWrap` is required when `kind === 'code'`. The implementer sets each element's kind, codeWrap and defaults from the package's README and demo. `<code-block>` is `kind: 'code', codeWrap: 'text'`. `<blink-wc>` is `inline`. `<marquee-wc>` is `text`. `<terminal-window>` is `none` unless its README shows content.
- Produces, in `manifest.js`:
  ```js
  /** @typedef {{ name: string, type: 'string'|'number'|'boolean', enum?: string[], description?: string, default?: string }} AttrDef */
  export function parseCemType(text /* string|undefined */) /* -> { type, enum? } */;
  export function readManifest(pkgDir) /* -> Map<tag, { attributes: AttrDef[], description?: string }>; empty Map when the file is missing */;
  ```
  `parseCemType` rules:
  - `boolean` → boolean.
  - `number` → number.
  - A union of only quoted string literals (`'a' | "b"`) → string with `enum`.
  - A union containing `undefined` or `null` drops those members.
  - Anything else, or missing → string.
- Produces, in `describe.js`:
  ```js
  /** @typedef {ElementHint & { package: string, attributes: AttrDef[], bundled: boolean,
   *   scriptPath: string|null /* entry path inside the package, e.g. 'dist/browser-window.js'; null when bundled * / }} ComponentDescriptor */
  /** @typedef {{ package: string, bundled: boolean, enabled: boolean, siteVersion: string|null,
   *   vpVersion: string|null, source: 'site'|'vp'|null, elements: ComponentDescriptor[] }} PackageState */
  export function describeComponents({ siteDir /* string|null */, vpRoot /* string */ }) /* -> PackageState[] */;
  export function componentIndex(states /* PackageState[] */, { enabledOnly = true } = {}) /* -> Map<tag, ComponentDescriptor> */;
  export function packageDir(pkg, { siteDir, vpRoot }) /* -> { dir, source } | null */;
  ```
  - `enabled` is true when `bundled`, or when `pkg` is a key of the site's `package.json` `dependencies`.
  - The manifest and version come from `<siteDir>/node_modules/<pkg>` when present (`source: 'site'`), else `<vpRoot>/node_modules/<pkg>` (`'vp'`), else null with empty attributes.
  - The VB elements read `vanilla-breeze`'s manifest the same way.
  - `siteDir: null` (fixture mode) treats every package as enabled.

- [ ] **Step 1: Write the failing tests.**
  ```js
  // manifest.test.js
  it('parses CEM types', () => {
    assert.deepEqual(parseCemType('boolean'), { type: 'boolean' });
    assert.deepEqual(parseCemType('number'), { type: 'number' });
    assert.deepEqual(parseCemType(`'light' | "dark" | undefined`), { type: 'string', enum: ['light', 'dark'] });
    assert.deepEqual(parseCemType('string | HTMLElement'), { type: 'string' });
    assert.deepEqual(parseCemType(undefined), { type: 'string' });
  });
  it('reads attributes per tag, empty map when missing', () => { /* fixture x-widgets: x-one has attrs mode ('a'|'b'), count (number), open (boolean) */ });
  // catalog.test.js — runs against VP's installed packages
  it('every catalog tag exists in its package manifest', () => { /* for each element: readManifest(packageDir(...).dir).has(tag) */ });
  it('defaults and advanced name only declared attributes', () => {});
  it('kinds are valid and code kinds have codeWrap', () => {});
  it('tags are unique across the catalog', () => {});
  // describe.test.js — temp site dirs with fixture packages copied into node_modules
  it('a package in site dependencies is enabled, others are not', () => {});
  it('VB elements are always enabled and bundled', () => {});
  it('site copy wins over VP copy', () => { /* site's x-widgets manifest lacks `count`; descriptor attributes omit count; source === 'site' */ });
  it('componentIndex skips disabled packages unless enabledOnly is false', () => {});
  ```
- [ ] **Step 2: Run** `node --test test/components/`. Expected: FAIL, the modules are missing.
- [ ] **Step 3: Implement** the three modules. Run `npm install` for the new dependencies. If a catalog tag is absent from its package's manifest, the catalog test fails; fix the catalog, not the test.
- [ ] **Step 4: Run** `node --test test/components/`, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add src/components test/components test/fixtures/components package.json package-lock.json
  git commit -m "feat: component catalog and descriptors from custom-elements manifests"
  ```

---

### Task 3: Content model: schema, validation, rendering

**Files:**
- Modify:
  - `src/schema/content-schema.js`: add `component` to `blockTypes` (category `component`; `children` handled specially) and to `inlineTypes`. `categorizedBlocks` skips it, because the palette lists components from descriptors.
  - `src/schema/validate.js`: `validate(doc, { components } = {})`.
  - `src/renderers/html.js`: block and inline `component` cases.
  - `src/renderers/markdown.js`: render a component as its HTML (Markdown allows raw HTML blocks; inline as raw inline HTML).
- Create: `src/components/normalize.js`.
- Test: `test/schema/component.test.js`, `test/renderers/component.test.js`.

**Interfaces:**
- Consumes: `ComponentDescriptor` and `componentIndex` from Task 2.
- **AST shapes:**
  - block: `{ type: 'component', tag, attrs, value?, wrap?, children? }`. `value` (string) is used for `text` and `code` kinds; `wrap` (`'text'|'template'|'script'`) only for `code`; `children` (Block[]) for `blocks`.
  - inline: `{ type: 'component', tag, attrs, children: Inline[] }`.
  - `attrs` values are string, number or boolean.
- **`validate(doc, { components })`:**
  - **Always:**
    - `tag` matches `/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/` and is not a reserved name (`annotation-xml`, `color-profile`, `font-face`, `font-face-src`, `font-face-uri`, `font-face-format`, `font-face-name`, `missing-glyph`).
    - Each attr name matches `/^[a-z][a-z0-9-]*$/`, and no name starts with `on`.
    - Values are string, number or boolean.
  - **With `components`** (a `Map<tag, ComponentDescriptor>`):
    - The tag is in the map. Otherwise the error is `` `${path}: component "${tag}" is not on for this site` ``.
    - Block vs inline placement matches the kind.
    - Each attr is declared, and its value matches the declared type and enum.
    - The content matches the kind: `none` has no value or children; `text`/`code` have a string `value`; `blocks` has `children`; `inline` has inline `children`.
- **Normalize:** `normalizeComponents(doc, components) -> { doc, dropped: Array<{ path: string, tag: string, attr: string }> }`. It returns a copy with undeclared attrs removed. Tags not in the map are left for `validate` to report.
- **HTML for a block component:**
  - The output is `<${tag}${attrs}>…</${tag}>`.
  - Attrs are in name order:
    - `true` → bare name;
    - `false` → omitted;
    - otherwise ` name="${escapeAttr(String(v))}"`.
  - The content is:
    - none → empty;
    - text → `escapeHtml(value)`;
    - code with `codeWrap: 'text'` → `escapeHtml(value)`;
    - code with `'template'` → `<template>${escapeHtml(value)}</template>`;
    - code with `'script'` → `<script type="text/plain">${value with "</script" replaced by "<\/script"}</script>`;
    - blocks → rendered children joined by `\n`.
  - The renderer reads `wrap` from the block, which the editor copies from the descriptor's `codeWrap`. That keeps the renderer pure: it needs no descriptors. A missing `wrap` means `'text'`.
- **HTML for an inline component:** `<${tag}${attrs}>${renderInline(children)}</${tag}>`.

- [ ] **Step 1: Write the failing tests.**
  ```js
  // test/renderers/component.test.js
  it('renders a none-kind block with typed attrs', () => {
    assert.equal(render({ type: 'component', tag: 'pdf-viewer', attrs: { src: '/media/a.pdf', toolbar: true, hidden: false, page: 2 } }, { scope: 'block' }),
      '<pdf-viewer page="2" src="/media/a.pdf" toolbar></pdf-viewer>');
  });
  it('escapes attribute values', () => {
    assert.equal(render({ type: 'component', tag: 'browser-window', attrs: { title: `a"b<c&d\ne` } }, { scope: 'block' }),
      '<browser-window title="a&quot;b&lt;c&amp;d\ne"></browser-window>');
  });
  it('renders text, code and blocks content', () => { /* marquee-wc value "Hi <b>" → escaped; code wrap template; code wrap script containing "</script>" stays inside; blocks children rendered */ });
  it('renders inline components inside a paragraph', () => {
    // paragraph children: [text 'a ', { type:'component', tag:'blink-wc', attrs:{}, children:[{type:'text', value:'new'}] }]
    // → '<p>a <blink-wc>new</blink-wc></p>'
  });
  // test/schema/component.test.js
  it('rejects unsafe tag', () => {
    for (const tag of ['script', 'img onerror=x', 'font-face', 'X-Y', 'a-']) assert.equal(validate(docWith({ type: 'component', tag, attrs: {} })).valid, false);
  });
  it('rejects on* and malformed attr names', () => {});
  it('with descriptors: unknown tag is "not on for this site"', () => {
    const r = validate(docWith({ type: 'component', tag: 'x-zz', attrs: {} }), { components: new Map() });
    assert.match(r.errors[0], /component "x-zz" is not on for this site/);
  });
  it('with descriptors: type, enum, kind and placement checked', () => {});
  it('normalize drops undeclared attrs and reports them', () => {
    const { doc, dropped } = normalizeComponents(docWith({ type: 'component', tag: 'x-one', attrs: { mode: 'a', bogus: 'z' } }), fixtureIndex);
    assert.deepEqual(doc.blocks[0].attrs, { mode: 'a' });
    assert.deepEqual(dropped, [{ path: 'blocks[0]', tag: 'x-one', attr: 'bogus' }]);
  });
  it('existing fixtures still validate without descriptors', () => { /* every test/fixtures/*.json */ });
  ```
- [ ] **Step 2: Run** `node --test test/schema/component.test.js test/renderers/component.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** Validation without `components` stays structural, so `vp sync`, the CLI and `from-site.js` keep working on component posts with no descriptors.
- [ ] **Step 4: Run** the two files, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add src/schema src/renderers src/components/normalize.js test/schema test/renderers
  git commit -m "feat: generic component node in the content model"
  ```

---

### Task 4: Site components API, publish guard, editor asset serving

**Files:**
- Create: `src/app/components.js`, the per-site component operations.
- Modify:
  - `src/app/server.js`: mount the routes in `mountSiteGit`, serve component files, and pass descriptors to the site's API.
  - `src/server/api.js`: `mountApi` accepts `components: () => Map` and uses it in POST/PUT documents (normalize, then validate, then respond with `notices`).
  - `src/app/publish.js`: refuse before the build.
  - `editor/assets/js/api-client.js`: `listComponents()`, `setComponent(pkg, enabled)`.
- Test: `test/app/components.test.js`, plus additions to `test/app/server.test.js` and `test/app/publish.test.js`.

**Interfaces:**
- Consumes:
  - from Task 2: `describeComponents`, `componentIndex`, `packageDir`;
  - from Task 3: `validate`, `normalizeComponents`;
  - from step 1: `runNpm(dir, args)`, `git.commitPaths`, `git.gitStatus`, `backup.flush()`, the site's `writes` queue.
- **Routes**, under `/api/sites/:siteId`:
  - `GET /components` → `{ cookSupportsPackages: boolean, packages: PackageState[] }`. `cookSupportsPackages` is true when the site's installed `cook-ssg` version is ≥ 2.5.0.
  - `PUT /components/:pkg` with body `{ enabled: boolean }` (`:pkg` URL-encoded) → 200 with the new `PackageState`, or one of these errors:
    - 404 for a package not in the catalog;
    - 409 `{ error, posts: [{ id, title, status }] }` when disabling a package that a post uses;
    - 409 when `package.json` or `package-lock.json` has uncommitted changes. The message: "package.json has changes that aren't committed. Commit or discard them, then try again.";
    - 502 when npm fails, with npm's last lines of output;
    - 400 for a bundled VB entry.
  - `GET /sites/:siteId/components/<pkg>/<path>` serves `packageDir(pkg).dir/<path>`. It uses the same static server and traversal protection as media, and sends `X-Content-Type-Options: nosniff`. It returns 404 when the package is not in the catalog.
- **Operations** in `components.js`:
  - `setComponent({ ws, pkg, enabled, deps })`. In order:
    1. Check `package.json` and the lock are clean.
    2. Snapshot both files.
    3. Run `npm install <pkg>@<vp's version range> --save`, or `npm uninstall <pkg>`.
    4. On failure, restore both files byte for byte, then throw.
    5. On success, `commitPaths(siteDir, ['package.json', 'package-lock.json'], 'Components: turn on <pkg> [CI Skip]')`, or `turn off`.
    6. `backup.flush()` pushes it.

    It runs inside the site's `writes` queue.
  - `postsUsing(db, tags)` → `[{ id, title, status }]`. It scans every document's blocks recursively, inline children included, for `component` nodes whose tag is in `tags`.
- **Publish:** `setPublished` gets `deps.components()` (a Map of enabled descriptors). Before saving or building, it throws `PublishRejectedError` with `` `This post uses <${tag}>, which is not on for this site. Turn it on under Components, or remove it from the post.` `` when any component tag in the post is not in the map.
- **Documents API:** POST and PUT of documents in the app normalize with the enabled index. The response includes `notices: string[]`, e.g. `Removed "bogus" from <x-one>: this version of the component doesn't have it.`, then validate with `{ components }`. `vp serve` (no `components` option) is unchanged.

- [ ] **Step 1: Write the failing tests** (`test/app/components.test.js`). Use a temp git site from `test/app/git-site-fixture.js`, with a stub `runNpm` that edits `package.json` like npm would, or fails.
  ```js
  it('enable adds the dependency, commits only package files with [CI Skip]', async () => {});
  it('refuses enable when package.json is dirty', async () => { /* 409; package.json bytes unchanged; no commit */ });
  it('failed install restores package files', async () => { /* stub npm exits 1 after writing package.json; 502; both files byte-identical to before */ });
  it('refuses disable while a draft uses it', async () => { /* 409 with posts: [{ title: 'Draft With Window', status: 'draft' }] */ });
  it('postsUsing finds inline and nested components', () => {});
  it('GET components reports enabled, source and cookSupportsPackages', async () => {});
  it('serves component files and refuses traversal and unknown packages', async () => {});
  // publish.test.js
  it('publish refuses a post using a component that is off', async () => { /* PublishRejectedError message names <x-one>; no commit, no build run */ });
  // server.test.js
  it('PUT document drops undeclared component attrs and returns a notice', async () => {});
  ```
- [ ] **Step 2: Run** `node --test test/app/components.test.js test/app/publish.test.js test/app/server.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** those files, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add src/app src/server/api.js editor/assets/js/api-client.js test/app
  git commit -m "feat: per-site components API, publish guard, component file serving"
  ```

---

### Task 5: Components section on the site screen

**Files:**
- Modify:
  - `app/site.html`: add `<li><button type="button" data-section="components">Components</button></li>` after Media, and a `#components-section`.
  - `app/assets/js/site-page.js`: render the section.
  - `app/assets/app.css`
- Test: browser verification by the controller (step 1 pattern), plus a pure helper test.
- Create: `app/assets/js/components-view.js`, with pure functions only, tested in `test/app/components-view.test.js`.

**Interfaces:**
- Consumes: `GET` and `PUT /components` from Task 4.
- **Produces, in `components-view.js`:**
  - `packageRows(packages) -> Array<{ package, label, version, enabled, canToggle, note }>`:
    - `label` is the first element's label, or the package name when there are several elements;
    - `canToggle` is false for bundled VB;
    - `note` is "Part of Vanilla Breeze" for bundled entries, and "Not installed" when `source === null`.
  - `toggleOutcome(status, body) -> { kind: 'ok'|'in-use'|'dirty'|'npm'|'error', text, posts? }`.
- **Screen behavior:**
  - Each package is a row with a switch, its version, and its elements' labels and descriptions. A "Try it" disclosure renders the element live with its catalog defaults, using the Task 7 loader once that exists; until then, the description only.
  - While a toggle runs, the row shows "Installing…" or "Removing…" and the other switches are disabled.
  - In-use refusals list the posts as links to their editor.
  - When `cookSupportsPackages` is false, a notice at the top says: "This site's Cook is older than 2.5.0, so turned-on components won't load on the live site yet. Update cook-ssg in the site to ^2.5.0."
  - There are no browser dialogs.

- [ ] **Step 1: Write the failing test** for `packageRows` and `toggleOutcome` (all five kinds), then run `node --test test/app/components-view.test.js`. Expected: FAIL.
- [ ] **Step 2: Implement** `components-view.js` and the section. Run the test. Expected: PASS.
- [ ] **Step 3: Controller browser check** against a temp git site:
  - turn browser-window on: the row is on, and `git log -1` is `Components: turn on @profpowell/browser-window [CI Skip]`;
  - turn it off while a draft uses it: the refusal names the draft;
  - a dirty `package.json` gives the dirty message.
- [ ] **Step 4: Commit**
  ```bash
  git add app test/app/components-view.test.js
  git commit -m "feat: Components section on the site screen"
  ```

---

### Task 6: Editor content model for components

**Files:**
- Modify:
  - `editor/assets/js/schema.js`: three nodes:
    - `component_leaf` (group block, atom, attrs `{ tag, attrs, value, wrap }`) for the none, text and code kinds;
    - `component_blocks` (group block, content `block+`, attrs `{ tag, attrs }`);
    - `component_inline` (group inline, inline, content `text*`, attrs `{ tag, attrs }`).
  - `editor/assets/js/ast.js`: map all three to and from AST `component`, using `children` or `value` by node type.
  - `editor/assets/js/components/block-palette.js`: entries from descriptors.
  - `editor/assets/js/menu.js`: a "Wrap in component" select listing the enabled inline components, enabled only when the selection is non-empty text.
- Create: `editor/assets/js/component-model.js`, with pure functions and no ProseMirror imports.
- Test: `test/editor/component-model.test.js`; the ProseMirror wiring is browser-verified.

**Interfaces:**
- Consumes: the descriptors from `api.listComponents()` (Task 4). Only enabled packages are offered.
- **Produces, in `component-model.js`:**
  ```js
  export function nodeTypeFor(descriptor) /* -> 'component_leaf'|'component_blocks'|'component_inline' */;
  export function initialAttrs(descriptor) /* -> { tag, attrs: {...defaults}, value: '' (leaf only), wrap: codeWrap (code only) } */;
  export function formFields(descriptor) /* -> Array<{ name, label, control: 'text'|'number'|'checkbox'|'select', options?, advanced: boolean, description? }> — URL-like names (src, url, href, poster) get control 'text' with inputmode url */;
  export function coerce(attrDef, raw /* string|boolean */) /* -> string|number|boolean|undefined — '' → undefined; number parse fails → undefined */;
  export function paletteEntries(descriptors) /* -> Array<{ id: `component:${tag}`, label, description, icon, category: group, tag }> sorted by group then label, inline kinds excluded */;
  ```
- The AST round-trip must be lossless: `toBlockAst(fromBlockAst(blocks))` deep-equals `blocks` for every kind.

- [ ] **Step 1: Write the failing tests** for each function:
  - `coerce` turns `'3'` into 3 for a number, `'x'` into undefined for a number, `true` into true for a boolean, and `''` into undefined;
  - `formFields` marks advanced attributes and builds a select for an enum;
  - `paletteEntries` excludes inline kinds.

  Run `node --test test/editor/component-model.test.js`. Expected: FAIL.
- [ ] **Step 2: Implement** `component-model.js`. Run the test. Expected: PASS.
- [ ] **Step 3: Wire up the schema, AST, palette and menu.** Palette entries insert `schema.nodes[nodeTypeFor(d)].create(initialAttrs(d), …)`. For `component_blocks` the content is one empty paragraph.
- [ ] **Step 4: Controller browser check** in `vp serve` fixture mode, where every package is enabled. Insert one of each kind from `/`, wrap a word in `<blink-wc>`, save, and reload. The Tools → Export JSON output matches the AST shapes from Task 3.
- [ ] **Step 5: Commit**
  ```bash
  git add editor/assets/js test/editor/component-model.test.js
  git commit -m "feat: editor nodes, palette and inline wrap for components"
  ```

---

### Task 7: Live components in the editor

**Files:**
- Create:
  - `editor/assets/js/blocks/component-view.js`: the NodeView for `component_leaf` and `component_blocks`, plus an inline view for `component_inline`.
  - `editor/assets/js/components/component-settings.js`: the `<component-settings>` panel.
  - `editor/assets/js/component-loader.js`: `loadComponent(descriptor) -> Promise<'ready'|'failed'>`.
- Modify:
  - `editor/assets/js/editor.js`: register the node views.
  - `editor/index.html`: load the VB bundle JS (`/assets/vb/vanilla-breeze.js`, `type="module"`) so the VB catalog elements are live.
  - `editor/assets/css/editor.css`
- Test: `test/editor/component-loader.test.js` for the URL logic; the rest is browser-verified.

**Interfaces:**
- Consumes: `formFields` and `coerce` (Task 6), descriptors (Task 4), and the asset route `/sites/:siteId/components/<pkg>/<scriptPath>` (Task 4).
- **Loading:**
  - `componentScriptUrl(descriptor, siteId) -> string|null` is null for bundled VB. With no site (fixture mode) it is `/components/<pkg>/<scriptPath>`. Add that static mount to `src/server/index.js`, from VP's own `node_modules`.
  - `loadComponent` dynamic-imports the URL once per package and caches the promise.
  - A failed import resolves `'failed'`. It never throws into ProseMirror.
- **Display:**
  - The NodeView renders the real element: `document.createElement(tag)` with the attributes set, `value` as its text or code content (matching the renderer's wrap), and `contentDOM` for the blocks kind.
  - Attribute changes from the settings panel `setNodeMarkup` the node and update the element in place, without recreating it, unless the tag changes.
  - A `failed` load or an off component shows a labeled frame: "<label> couldn't load" or "<label> is not on for this site". The frame keeps the node's data, so nothing is lost on save.
  - Selecting the node (click, or arrow onto it) opens `<component-settings>` beside the writing area. Basic fields show first, with advanced fields under a `<details>`. Text and code kinds get a textarea for `value`.
  - The settings panel is part of the editor chrome, not the themed content pane. The element itself sits in the themed pane, so it takes the site's theme from the existing theme picker's `data-theme`.
  - Element errors are caught: `window.onerror` and `unhandledrejection` from component scripts are logged to the console, and the node shows the "couldn't load" frame when its `loadComponent` failed. The editor keeps working.

- [ ] **Step 1: Write the failing test** for `componentScriptUrl`: bundled → null; with a site id the URL is encoded per segment (`@profpowell/browser-window` stays readable); with no site → `/components/...`. Run `node --test test/editor/component-loader.test.js`. Expected: FAIL.
- [ ] **Step 2: Implement** the loader and its URL helper. Run the test. Expected: PASS.
- [ ] **Step 3: Implement** the NodeView, the settings panel and the CSS.
- [ ] **Step 4: Controller browser check** in the app against a temp site with browser-window, marquee-wc and border-wc on:
  - each renders live;
  - changing a setting updates it immediately;
  - a border-wc holds typed paragraphs;
  - switching the theme picker re-skins them;
  - removing marquee-wc from the site's `package.json` by hand and reloading shows "is not on for this site", and Publish shows the Task 4 refusal;
  - an import failure (rename the package's dist in `node_modules`) shows "couldn't load" while the rest of the editor works.
- [ ] **Step 5: Commit**
  ```bash
  git add editor src/server/index.js test/editor/component-loader.test.js
  git commit -m "feat: live components with a settings panel in the editor"
  ```

---

### Task 8: End to end on a real Cook build, gallery check, docs

**Gate:** needs `cook-ssg@2.5.0` on npm (Task 1, published by the user). Bump VP's `devDependencies.cook-ssg` to `^2.5.0` and run `npm install` first. If 2.5.0 isn't published yet, the controller asks the user before starting this task.

**Files:**
- Create:
  - `test/e2e/components-build.test.js`;
  - `editor/components-gallery.html`: every catalog element rendered once, with a VB theme switcher, for the check below.
- Modify: `package.json` (devDependency), `README.md`, `CLAUDE.md` (an App → Components paragraph), `docs/EDITOR.md`.
- Create: `docs/superpowers/followups/2026-11-03-vp-components.md`: per-package follow-ups from the gallery check (manifests without slots, packages that ignore VB tokens), plus the outstanding npm publish of bg-wc 0.5.0.

- [ ] **Step 1: Write the e2e test.**
  - The temp site has `node_modules` symlinked to VP's (as in `test/e2e/cook-site.test.js`).
  - Its `package.json` lists `@profpowell/browser-window` and `vanilla-breeze` in `dependencies`.
  - One published post contains a block `browser-window`, a `blocks` kind with a paragraph, a `code-block`, and an inline `blink-wc` in a paragraph.
  - A second post uses no components.

  It syncs with `syncDocument` and runs `cook build`. It asserts:
  - the first post's page has exactly one `<script type="module" src="/assets/components/@profpowell/browser-window/browser-window.js">`;
  - the page contains `<browser-window` with the escaped attributes;
  - the second post's page has no `/assets/components/` script;
  - `dist/assets/components/@profpowell/browser-window/browser-window.js` exists;
  - `vanilla-breeze` was not copied.

  `blink-wc` is not in this site's dependencies, so the page has its markup but no script for it; assert exactly that. A post can still hold it, because sync doesn't check the site's components.
- [ ] **Step 2: Run** `node --test test/e2e/components-build.test.js`. Expected: PASS. This task integrates finished work, so a failure points at an earlier task.
- [ ] **Step 3: Controller gallery check.** Open `/editor/components-gallery.html` in the browser, switch through VB's base themes, and record each element that doesn't render or doesn't change with the theme in the follow-ups file.
- [ ] **Step 4: Docs.** README: Components in the app. CLAUDE.md: the catalog, descriptors, `component` node, and the site enabled = dependency rule. EDITOR.md: inserting, settings, inline wrap.
- [ ] **Step 5: Run** `npm test`. Expected: all PASS.
- [ ] **Step 6: Commit**
  ```bash
  git add test/e2e/components-build.test.js editor/components-gallery.html package.json package-lock.json README.md CLAUDE.md docs
  git commit -m "test: components end to end through Cook; docs and follow-ups"
  ```

After the final review: the thomasapowell.com change (`cook-ssg` ^2.5.0) is a site commit and push, so it is the user's call. The controller offers it.
