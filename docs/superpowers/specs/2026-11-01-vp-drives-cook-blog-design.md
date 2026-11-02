# Vanilla Press drives Cook: thomasapowell.com blog

Status: approved direction (Thomas, 2026-11-01); builder-check answers folded in

## Intent

Thomas wants a personal blog at thomasapowell.com that he writes in an
editor, not by hand-editing files. It should be built entirely on his own
stack: **Vanilla Press** (the editor), **Cook** (the site builder) and
**Vanilla Breeze** (CSS and web components). The site should be published as
static files to Cloudflare Pages.

The division of labor is his call: **"Cook needs to do the rest. The editor
should just edit."**
- Vanilla Press stops being a site generator.
- It owns content: the block model, the editor, the store, and turning each
  document's blocks into Vanilla Breeze HTML.
- Cook owns the site: layouts, navigation, index and collection pages, feeds,
  sitemap, `llms.txt`/markdown/JSON formats, asset handling and deployable
  output.

Why this split:
- Cook is the builder he uses for his other sites (the Vanilla Breeze docs and
  the Cook docs). Site design then lives in ordinary Cook layouts and includes
  that he can edit, not in template literals inside Vanilla Press.
- Every site-building feature added for the blog (collections, feeds) also
  improves Cook for everyone.

## Current state (verified 2026-11-01)

**Vanilla Press** (`~/src/vanilla-press`, branch `revive/vb-migration`):
- The editor works on Vanilla Breeze 0.4.1 and was checked in a browser. 330
  tests pass.
- Content is a typed block AST (`src/schema/content-schema.js`) stored in
  SQLite (`content.db`, gitignored) with FTS.
- `src/renderers/html.js` turns blocks into Vanilla Breeze markup:
  `status-message`, `layout-card`, `tab-set`, `code-block`, and so on.
- `src/build/publish.js` and `src/build/templates.js` are a complete
  stand-alone site generator writing `_site/`. **These are being retired.**
- The CLI (`bin/vp.js`) has list/get/new/edit/publish/unpublish, imports and
  validate. The `publish` and `unpublish` commands only change a document's
  status.
- A local `node:http` server (`src/server/`) serves the editor and its JSON
  API.

**Cook** (`~/src/cook`, npm `cook-ssg` 2.3.0):
- Builds HTML pages with YAML front matter. A `layout` key applies a layout
  template.
- Has includes, components, `data-repeat`, `basePath`/`siteRoot`, an Atom
  feed from a collection, sitemap, and md/JSON/`llms.txt` formats.
- **Collections only come from markdown files**: `src/blog/*.md` becomes
  `collections.blog`. HTML pages with front matter don't form collections.
  This is the main gap.

**thomasapowell.com** (`~/src/thomasapowell.com`):
- An empty git repo, remote `github.com/ProfPowell/thomasapowell.com`.
- No content exists yet. Thomas will set up the Cloudflare Pages destination
  himself.

## Goals

1. Write a post in the Vanilla Press editor, mark it published, and see it on
   thomasapowell.com after a Cook build, with no hand-editing of site files.
2. The blog has:
   - a home page listing recent posts
   - post pages
   - an Atom feed
   - a sitemap
   - Cook's machine-readable formats
3. Site design (layouts, header, footer, theme) is plain Cook/HTML in the site
   repo.
4. A Cloudflare Pages build only needs `npx cook build`. Vanilla Press is not
   needed in CI.
5. Drafts never reach the built site.

## Non-goals (for this project)

- A hosted CMS: editor on Workers, D1/R2, auth, multiple users. The editor
  runs locally.
- WordPress import, Yjs collaboration, and the rest of Vanilla Press's
  Phase 5/6.
- Tag pages, pagination and search. Add them later if the blog needs them.
- Migrating the Vanilla Breeze docs or the Cook docs to Vanilla Press.

## Anti-goals (would be failure even if it "works")

- Vanilla Press generating site chrome, navigation, index pages, feeds or
  sitemaps.
- Content living only inside an opaque SQLite file that isn't in git.
- Cook knowing anything about Vanilla Press. Cook gains general features any
  site can use, and Vanilla Press just writes files Cook already understands.
- The editor importing Cook internals, or Cook importing Vanilla Press.

## Design

### Data flow

```
VP editor ──save──▶ VP store (SQLite, local cache)
                          │
                    vp export (on publish/unpublish/save of published doc)
                          ▼
thomasapowell.com/
  .vp/content.db                     ← this site's VP store (gitignored cache)
  content/<collection>/<slug>.json   ← block AST + meta (source of truth, committed)
  content/media.json                 ← media metadata (alt, mime, size; committed)
  config/vp.json                     ← VP-owned site settings, e.g. theme (generated, committed)
  src/<collection>/<slug>.html       ← front matter + VB content HTML (generated, committed)
  src/media/<file>                   ← uploaded media (committed)
  src/layouts/, src/includes/, src/index.html, config/main.js, config/data.js
                                     ← site design (hand-authored Cook)
                          │
                    npx cook build   (locally, and on Cloudflare Pages)
                          ▼
                       dist/  → Cloudflare Pages
```

### Vanilla Press: one workspace per site, export instead of publish

**Per-site workspace** (my call):
- Vanilla Press runs against a site: `vp serve --site ~/src/thomasapowell.com`
  (the site path is a CLI flag or `VP_SITE` env var; the editor shows which
  site it's editing).
- The store is `<site>/.vp/content.db`, which the site's `.gitignore`
  excludes.
- Uploads go straight to `<site>/src/media/`, with metadata in the store and
  exported to `content/media.json`.
- The existing repo-local `content.db` and `media/` (24 demo documents)
  remain Vanilla Press's development fixtures and are never exported
  anywhere. A new site starts empty.

**Export** (`src/export/`) replaces `publish.js`/`templates.js` as the output
path. It works on **one document at a time**: the one just saved, published,
unpublished, renamed or deleted (my call).
- `content/<collection>/<slug>.json` is written for every save, drafts
  included: the full document, meta and blocks.
- If the document is **published**, `src/<path>/<slug>.html` is written with:
  - YAML front matter: `title`, `description`, `date` (published date),
    `updated`, `author`, `tags`, `layout` (default `post`, set per
    collection), `slug`;
  - a body of `renderHtml(blocks)` at **content scope** (the existing
    renderer, no page chrome).
- If it is a **draft or archived** (archived is treated like a draft, my
  call), the HTML is removed. On rename or delete, the old files are removed.
- Vanilla Press tracks the files it wrote in `content/.vp-manifest.json` and
  never deletes anything else.
- Media referenced by a published document is already in `src/media/`, so
  the renderer's `/media/<file>` URLs work as-is. `content/media.json` is
  rewritten on upload or edit. Unreferenced media isn't deleted
  automatically.
- Writes are atomic: temp file, then rename.

**Output path per collection** (my call):
- By default a collection exports to `src/<collection>/`, so the URL is
  `/<collection>/<slug>/`.
- The `pages` collection exports to the site root by default, so About is at
  `/about/`, not `/pages/about/`.
- Per-collection output path and layout are VP config
  (`collections: { posts: { path: 'posts', layout: 'post' }, pages: { path: '', layout: 'page' } }`).
- The manifest records each file's path, so changing this config cleans up
  correctly.

**Conflicts between the store and committed JSON** (my call; the JSON files
win):
- On startup and before each export, Vanilla Press compares each
  `content/**/*.json` file's `updated` with the store. A newer file (from a
  `git pull`, another machine or a hand edit) is imported into the store.
- Export refuses to overwrite a JSON file whose `updated` is newer than the
  store's copy. It reports the conflict to the editor instead of clobbering
  it.
- `vp import:content --site <path>` does the same sync explicitly and
  **merges**: the newest `updated` wins per document, and documents missing
  from the files are kept. With `--replace`, the store is rebuilt from the
  files alone. A fresh clone runs this once (or just starts the editor) to
  rebuild `.vp/content.db`.

**Site settings Vanilla Press owns** (my call):
- Vanilla Press writes `config/vp.json` (currently `{ "theme": "<id>" }`) and
  never touches the hand-written `config/*.js`.
- The site's `config/data.js` imports it, and layouts use it for
  `<html data-theme>`.
- Non-built-in themes load at runtime from the vendored Vanilla Breeze
  `themes/` folder (the whole `dist/cdn` is vendored, see below).

**Editor wiring**:
- Publish and Unpublish in the editor set the status and export.
- Auto-save of a published document re-exports it, so `cook dev` in the site
  repo live-reloads while writing.
- Editor preview is `cook dev`; Vanilla Press no longer serves a `_site`
  preview.

**Retire** `publish.js`, `templates.js`, the `_site/` preview, `vp build`,
`vp serve`'s `_site` fallback and `vp deploy`, along with their tests. Keep
the renderers (HTML, markdown, JSON) and their tests.

**Make rendering deterministic**: `renderTabs` names each `<details>` group
with `Math.random()`. Derive the name from the document and block position
so unchanged posts export byte-identical HTML and git diffs stay clean.

### Cook: collections from HTML pages (general feature)

- HTML pages **with YAML front matter** join collections the same way
  markdown files do, using the same grouping rule:
  - the first folder under the served root (`srcPath`, or `srcPath/<siteRoot>`
    when `siteRoot` is set, so `src/pages/docs/x.html` with
    `siteRoot: 'pages'` joins `docs`)
  - sorted by `date`, newest first
  - items carry `title`, `url`, `slug`, `date`, `description` and the rest
    of the front matter
  - `content` is excluded
- Markdown and HTML pages in the same folder join the same collection.
- **Opt-in** (my call): `collections: { html: true }` in Cook config, off by
  default. The Vanilla Breeze docs have 523 HTML pages with front matter, so
  a default-on feature would change their collections and their JSON and
  `llms.txt` output. Opt-in keeps this a safe minor release.
- Pages with `draft: true` in front matter are skipped. Vanilla Press never
  exports drafts, but hand-written sites may want this.
- `data-repeat="collections.posts as post"` and the Atom feed (`formats.feed`
  pointed at a collection) then work for Vanilla Press output with no Vanilla
  Press-specific code.
- Docs page and tests in Cook. Ships as a Cook minor release.
- **Not in scope:** markdown copies (`/md/`) of HTML pages. Cook's markdown
  format only copies `.md` sources, so Vanilla Press posts get JSON, the
  feed and `llms.txt` entries but no `/md/` copy (my call). A later Cook
  feature (HTML → markdown for `formats.markdown`) would cover every HTML
  site, not just this one.

### thomasapowell.com: the site

A Cook project:
- `config/main.js` and `config/data.js` (site title, `siteUrl`)
- `src/index.html`: recent posts via `data-repeat` over `collections.posts`
- `src/layouts/post.html`: article layout using Vanilla Breeze `<main>` /
  `<article>` patterns, with header, footer and title/date/tags
- `src/includes/` for header and footer
- `src/404.html`
- `src/assets/`: site CSS that layers on Vanilla Breeze

Vanilla Breeze's whole `dist/cdn` folder (including `themes/`) and
`@profpowell/code-block` are copied from `node_modules` into
`src/assets/vendor/` by an `npm` prebuild script (my call: the Cook docs site
commits its vendored copy instead, but a prebuild keeps the blog repo small
and makes upgrades a version bump). Pages then don't depend on a
third-party CDN at runtime. The vendored folder is gitignored, and Cloudflare
runs the prebuild as part of `npm run build`.

Other details:
- Theme: comes from Vanilla Press's generated `config/vp.json`, which
  `config/data.js` imports, so the layout's `<html data-theme>` follows the
  editor's choice.
- `package.json` scripts: `build` = `cook build`, `dev` = `cook dev`.
- The initial content collection is `posts`. An `about` page can be a Vanilla
  Press document in a `pages` collection using a `page` layout.
- Deploy: Cloudflare Pages connected to the GitHub repo, build command
  `npm run build`, output `dist`. Thomas sets up the destination; the repo
  just needs to build cleanly.

## Order of work

1. **Cook: HTML collections.** Feature, tests, docs, release. This unblocks
   everything else.
2. **Vanilla Press: per-site workspace and export.** Covers:
   - `--site` and the `.vp/` store
   - uploads into `src/media/`
   - the export module, manifest-based cleanup and collection paths
   - conflict handling and `import:content`
   - `config/vp.json`
   - editor wiring and deterministic tabs
   - retiring the publisher
3. **thomasapowell.com: scaffold.** Layouts, index, post page, feed, vendor
   assets. Verify with one post written in the editor, then built and served
   locally.
4. **Deploy.** Once Thomas adds the Cloudflare destination: connect it,
   confirm a live build.

## Left to the builder

- Exact YAML key names beyond those listed, and how front matter handles
  values that need quoting.
- Layout markup and site styling. Use idiomatic Vanilla Breeze and keep it
  simple; Thomas will restyle.
- Whether `vp export` writes atomically (temp file then rename). Recommended.
- Test strategy details: unit tests for export and for Cook collections, and
  one end-to-end test that exports fixtures into a temp Cook project and
  builds it.

## Known issues carried over (not blocking)

- A link containing a bold run is split into two adjacent links with the same
  href by the editor's AST conversion.
- Code blocks have no SQL highlighting (code-block language module).
- Nothing guards the editor schema (`editor/assets/js/schema.js`) against
  drifting from the renderer (`src/renderers/html.js`).
- Cook's `/md/` copies and `llms.txt` markdown links for HTML pages (a
  follow-up Cook feature).
