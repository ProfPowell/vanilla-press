# thomasapowell.com in Dataviz D — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The whole site in the Dataviz D design — home, seven section pages, About, post/page layouts, search, 404 — built from `config/sections.json`, the posts and fetched data, with every layout editable in Vanilla Press.

**Architecture:** Layouts stay format 1. Shared values (sections, location, hot takes, section data, fetched Bluesky/GitHub) come from `config/data.js` and are used with fields and `data-repeat`. Every generated block (hero chart, post tables, section tables, contents, more-in-section, prev/next) is a custom element placeholder in the layout (a format-1 Component, e.g. `<tap-post-table section="${section}">`); a site `after` plugin, `plugins/dataviz-blocks.js`, replaces each placeholder in the built HTML with markup rendered by pure functions in `plugins/dataviz/`. The look is a Vanilla Breeze theme file plus a small site script.

**Tech Stack:** Cook 2.9 (cook-ssg), Vanilla Breeze 0.6, format-1 layouts, Node ≥ 22 `node:test`, linkedom (already installed), IBM Plex (self-hosted), Open-Meteo (browser), Bluesky public API, GitHub REST/GraphQL.

**Spec:** `~/src/vanilla-press/docs/superpowers/specs/2026-11-14-dataviz-d-site-design.md` (approved, 487397c). Design source: `~/src/thomasapowell.com/thomasapowell-dataviz-d/` (`DESIGN.md`, `tokens.css`, `boards/`).

## Global Constraints

- **Workspace:** a git worktree of the site at `~/src/thomasapowell.com-dataviz` on branch `feat/dataviz-d` from `main`, created in Task 1 (`git -C ~/src/thomasapowell.com worktree add ../thomasapowell.com-dataviz -b feat/dataviz-d`), with its own `npm install`. The main checkout `~/src/thomasapowell.com` is never modified (its uncommitted files `src/layouts/essay.html`, `src/posts/office-hours.html`, `src/posts/the-post-layout-post.html`, `src/layouts/test.html`, `src/layouts/thomas.html`, `.cache/` belong to the user). Never push. The user publishes.
- Task 9 alone works in `~/src/vanilla-press` on its current branch `fix/layout-editor-polish`; never stage its `CLAUDE.md`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage files by name.
- Tests: site `npm test` = `node --test test/*.test.js` (added in Task 1); VP `npm test`.
- Every layout and include passes `npx cook check-layouts` (summary shows 0 with problems) and is `editable` in VP.
- Section data and invented content carry `"test": true`; such blocks show a **"Sample"** tag in their caption. Real data is never tagged.
- Sections come only from `config/sections.json` — no section id, label, colour or shape is written into layouts, CSS rules or scripts (CSS keys marks off `data-shape` and a `--mark` colour variable).
- Exact values: page max `1248px`; side padding `clamp(20px, 4vw, 56px)`; hero chart `330px`; targets ≥ `44px`; Table 1 shows `3` rows then `More +N`; Bluesky latest `3` original posts of `tpowell.bsky.social`; GitHub user `ProfPowell`; location San Diego, `America/Los_Angeles`, 32.7157, −117.1611; clock refresh `30s`; post-page margin "More in" shows `3`.
- Copy: captions `Table n — …` / `Fig. n — …` / `Listing n — …`; "Showing X of Y"; "More +N", "Fewer", "Clear filter"; tag text `Sample`.
- Browser checks: time-limited Node Playwright (`perl -e 'alarm N; exec @ARGV' node script`, chromium from `/Users/tpowell/src/vanilla-breeze/node_modules/playwright/index.mjs`), against a local static server the task starts on a free port other than 3017/3007/4180 and stops afterwards. No MCP browser tools, no alert/confirm/prompt.

## Review Focus

1. **Zero or one post in a section** — section page and home charts render (empty table says "No posts yet"; treemap tile with one cell; timeline with a single date has a non-zero axis). Tests in Tasks 3 and 6.
2. **A post with a section not in `sections.json`, or none** — listed under Writing with a build warning naming the file, never dropped or crashing. Test in Task 3.
3. **Bluesky/GitHub unreachable on a fresh checkout** — build succeeds; committed snapshot used, else Sample test rows. Test in Task 4.
4. **Many posts on one day** (timeline labels) — every flag label gets its own level; none overlap. Test in Task 6.
5. **No JavaScript** — hero views switch, all Table 1 rows visible newest-first, Hot take opens (popover), nav works. Check in Task 10.

---

## File Structure (site worktree)

- `config/sections.json` — sections (spec's list, with intros).
- `config/sections/<id>.json` — per-section extra blocks' data (`test: true`), plus `config/sections/home.json` (intro, bio).
- `config/site.json` — location, bluesky handle, github user, hotTakes (test strings).
- `config/data.js` — loads the above + fetched data; exports top-level `sections`, `postSections`, `location`, `hotTakes`, `bluesky`, `github`, `sectionData`.
- `config/main.js` — `layouts.fields` gains `section`; `plugins.after` gains `dataviz-blocks`.
- `config/theme.json` — `name: "dataviz-d"`, `files["dataviz-d"]: "/assets/themes/dataviz-d.css"` (other entries kept).
- `plugins/dataviz/sections.js`, `posts.js`, `fetched.js`, `charts.js`, `tables.js`, `post-page.js`, `escape.js` — pure functions.
- `plugins/dataviz-blocks.js` — the `after` plugin: finds placeholders in built pages and swaps in rendered markup.
- `content/fetched/bluesky.json`, `github.json` — committed snapshots.
- `src/assets/themes/dataviz-d.css`, `src/assets/fonts/` (IBM Plex Sans 300/400/500, Mono 400 woff2 + OFL), `src/assets/js/dataviz.js`.
- `src/layouts/base.html` (chrome), `home.html`, `section.html`, `about.html`, `post.html`, and the existing `page/essay/guide/reference/landing.html` restyled; `src/includes/hot-take.html`.
- `src/index.html`, `src/<slug>/index.html` ×7, `src/search.html`, `src/404.html`.
- `test/*.test.js`.

---

### Task 1: Worktree and the placeholder spike

**Files:** worktree setup; throwaway `src/layouts/spike.html`, `src/spike.html`, `plugins/spike-after.js` (deleted at the end); keep `package.json` (`"test": "node --test test/*.test.js"`), `test/smoke.test.js`.

**Interfaces:**
- Produces: confirmed mechanism, recorded in the task report: (a) a custom element with a `${field}` attribute inside a format-1 layout passes `cook check-layouts`; (b) it reaches the `after` plugin in `dist/**/*.html` with the field resolved; (c) the `after` plugin can rewrite that file; (d) Cook's `autoComponents` doesn't add a script for an unknown `tap-*` tag (or the plugin removes it).

- [ ] **Step 1:** Create the worktree and `npm install` in it; `npm run build` succeeds (baseline).
- [ ] **Step 2:** Add the spike layout (format 1, `<tap-spike section="${title}"></tap-spike>` inside a container), a page using it, and an `after` plugin that replaces `<tap-spike …>` with `<p data-spike>` + the attribute value, registered in `config/main.js`.
- [ ] **Step 3:** Run `npx cook check-layouts` and `npm run build`. Expected: spike layout editable; `dist/spike/index.html` contains `<p data-spike>` with the page title; no `tap-spike` script tag.
- [ ] **Step 4:** If (a)–(d) hold, delete the spike files. If not, stop and report BLOCKED with what failed (the controller rules on the fallback: a Cook branch that lets `data-repeat` read page fields).
- [ ] **Step 5:** Add the `test` script and `test/smoke.test.js` (asserts `config/main.js` imports). Commit `chore: test script; placeholder mechanism verified`.

### Task 2: Sections and site data

**Files:** Create `config/sections.json`, `config/sections/{writing,code,teaching,work,art,personal,about,home}.json`, `config/site.json`, `plugins/dataviz/sections.js`; modify `config/data.js`; test `test/sections.test.js`.

**Interfaces:**
- Produces: `loadSections(json) → Section[]` where `Section = { id, label, slug, kind: 'posts'|'pages', shape, color, intro, number: 'NN', href: '/<slug>/' }`; throws a clear error for a duplicate id/slug, an unknown `kind`, or a `shape` not in `['circle','square','plus','bar','triangle','diamond','open-circle']`. `config/data.js` default export async → `{ siteUrl, siteTitle, author, sections, postSections, location, hotTakes, sectionData, bluesky, github }` (`bluesky`/`github` from Task 4; until then empty arrays).
- Section data file shape: `{ "test": true, "blocks": { "<blockId>": { "caption": "…", "rows": [ … ] } } }`, block ids per spec page list (e.g. teaching: `classes`; work: `companies`; art: `codeArt`, `photos`, `cyberWriting`; personal: `travels`, `map`, `collections`; code: `demos`; writing: `articles`; about: `cv`, `overview`, `books`, `elsewhere`). Values from the handoff boards, bracketed placeholders kept.

- [ ] **Step 1: Failing tests** — `loadSections` numbers in file order (`'01'`…`'07'`), `href` `/<slug>/`, `postSections` excludes `kind: 'pages'`; rejects duplicate slug, `kind: 'blog'`, `shape: 'star'` with messages naming the field.
- [ ] **Step 2:** Run `npm test` — FAIL (module missing).
- [ ] **Step 3:** Implement and write the data files and `config/data.js`; `layouts.fields` += `section`.
- [ ] **Step 4:** `npm test` PASS; `npx cook check-layouts` still clean; `npm run build` succeeds.
- [ ] **Step 5:** Commit `feat: sections and site data`.

### Task 3: Posts model

**Files:** Create `plugins/dataviz/posts.js`; test `test/posts.test.js`.

**Interfaces:**
- Consumes: `Section[]` (Task 2).
- Produces: `buildPosts(items, sections, { warn }) → Post[]` where `items` are `collections.posts` entries (`{ title, date, url, description, tags, section, inputPath? }`) and `Post = { number: 'NN', title, date: 'YYYY-MM-DD', url, summary, tags, section: Section }`, sorted newest first; numbers by date ascending, oldest `'01'`, ties broken by title. `postsBySection(posts, sections) → Map<id, Post[]>` (every post section present, possibly empty). `readingMinutes(html) → number` (200 wpm, min 1).

- [ ] **Step 1: Failing tests** — numbering oldest=01; newest first order; unknown section `'blog'` → Writing and `warn` called once with the post's title and `'blog'`; missing section → Writing with a warning; a `kind: 'pages'` section id on a post → Writing with a warning; empty section present in the map with `[]` (Review Focus 1, 2).
- [ ] **Step 2:** `npm test` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` PASS.
- [ ] **Step 5:** Commit `feat: posts model for sections, numbers and tables`.

### Task 4: Fetched Bluesky and GitHub data

**Files:** Create `plugins/dataviz/fetched.js`, `content/fetched/bluesky.json`, `content/fetched/github.json` (initial: test rows with `"test": true`); modify `config/data.js`; test `test/fetched.test.js`.

**Interfaces:**
- Produces: `fetchBluesky({ handle, fetch, limit = 3 }) → Promise<Note[]>` (`Note = { text, date, replies, reposts, likes, url }`, originals only — no `reason` repost, no `reply`); `fetchGithub({ user, token, fetch }) → Promise<Repo[]>` (`Repo = { name, description, language, stars, url }`; pinned via GraphQL when `token`, else REST `users/<user>/repos?sort=pushed&per_page=6`); `withSnapshot(name, loader, { dir }) → Promise<{ rows, test: boolean, source: 'live'|'snapshot'|'test' }>` — live success writes the snapshot and returns `test: false`; failure reads the snapshot (its own `test` flag); a missing snapshot gives built-in test rows with `test: true`. Never throws.

- [ ] **Step 1: Failing tests** with a stubbed `fetch`: replies and reposts filtered out and 3 kept; GitHub REST mapping; GraphQL used only with a token; `withSnapshot` live → writes file; network error → snapshot rows; network error and no file → test rows, `test: true` (Review Focus 3); a non-JSON response counts as failure.
- [ ] **Step 2:** `npm test` — FAIL.
- [ ] **Step 3:** Implement; `config/data.js` sets `bluesky`/`github` to `{ rows, test }` via `withSnapshot` (token from `process.env.GITHUB_TOKEN`), with a 5 s timeout per request; `TAP_OFFLINE=1` skips the live fetch (treated as a failure).
- [ ] **Step 4:** `npm test` PASS; `npm run build` online refreshes both snapshots with real rows.
- [ ] **Step 5:** Commit snapshots + code: `feat: Bluesky and GitHub at build time, with snapshots`.

### Task 5: Theme, fonts and the chrome

**Files:** Create `src/assets/themes/dataviz-d.css`, `src/assets/fonts/*` (+ `OFL.txt`), `src/assets/js/dataviz.js`, `src/includes/hot-take.html`; modify `config/theme.json`, `src/layouts/base.html`, `src/assets/css/site.css` (remove rules the theme replaces); test `test/chrome.test.js`.

**Interfaces:**
- Consumes: data fields `sections`, `location`, `hotTakes` (Task 2).
- Produces: classes/attributes later tasks use — marks: `<span class="tap-mark" data-shape="${s.shape}" style="--mark:${s.color}" aria-hidden="true"></span>`; captions: `<header class="tap-caption"><h2>Table n — …</h2><span class="tap-sample">Sample</span>?</header>`; containers `.tap-page`, `.tap-cols` (main `flex: 999 1 480px`, side `flex: 1 1 320px; max-width: 440px`), `.tap-grid` (`repeat(auto-fit, minmax(min(240px, 100%), 1fr))`, 20px gap), `.tap-rows`, `.tap-placeholder` (crossed diagonals). `dataviz.js` exports nothing; it enhances `[data-tap-clock]`, `[data-tap-weather]`, `#hot-take [data-another]`, `[data-tap-theme]`, and `[data-tap-table]` (filter/sort/more, Task 7 markup).
- base.html: utility strip holding `<tap-plate url="${url}" title="${title}"></tap-plate>` (rendered in Task 7 as `Plate NN — <title>`), Search/Feed links and the theme button (44px, `aria-label`); header with name, status line (`data-tap-clock` with a server-rendered build time, `data-tap-weather`), nav `<a data-repeat="sections as s" href="${s.href}">` with mark + label; footer links (Feed, Bluesky, GitHub, Colophon, Hot take button `popovertarget="hot-take"` with `aria-expanded`); `<div data-include="/includes/hot-take.html"></div>`.

- [ ] **Step 1: Failing test** — `test/chrome.test.js` builds the site (`npm run build` via `execFileSync`, once in `before`) and asserts with linkedom on `dist/index.html`: one nav link per section in `sections.json` order with `data-shape`; footer has the five items; `#hot-take[popover]` exists; `<html data-theme>` starts with `dataviz-d`; no `tap-` placeholder remains in any dist HTML file.
- [ ] **Step 2:** `npm test` — FAIL.
- [ ] **Step 3:** Implement. Theme maps VB variables to the `--tap-*` tokens from `thomasapowell-dataviz-d/tokens.css` (copied into the theme under `[data-theme~="dataviz-d"]`), square corners, no shadows; marks drawn per `data-shape` exactly as `gen_pages.py`'s `mark()`; `prefers-reduced-motion` stops the bobbing head; the theme button toggles `data-mode` light/dark but both use the light palette (spec). `aria-current` is set by the blocks plugin (Task 7), so this task's test does not assert it.
- [ ] **Step 4:** `npm test` PASS; `npx cook check-layouts` clean.
- [ ] **Step 5:** Commit `feat: Dataviz D theme, fonts and site chrome`.

### Task 6: Hero chart geometry and markup

**Files:** Create `plugins/dataviz/charts.js`; test `test/charts.test.js`.

**Interfaces:**
- Consumes: `Post[]`, `Section[]` (Tasks 2–3).
- Produces: `chartAxis(posts) → { start, end, days }` (start = first post date, end = last; a single date gives a 1-day axis, `days ≥ 1`); `xPercent(date, axis) → number` (`(date − start)/(days) × 100` in days; a single date sits at 0 on a one-day axis); `timelineLevels(posts, axis) → Map<postNumber, level>` (labels on the same or overlapping x get distinct levels, smallest available level first, labels assumed 22% wide); `cumulativeBands(posts, sections, axis) → [{ section, points: [[x%, y%], …] }]` (step areas, `y% = 100 − count × step`, `step = 18` scaled down when the max cumulative total × 18 > 90 so the top stays ≥ 10%); `treemap(postsBySection, sections) → [{ section, weight, cells: Post[] }]` (weights = counts, empty sections omitted); `heroChartHtml({ posts, sections }) → string` — the Fig. 1 block: caption, segmented control as radios (`name="tap-view"`, values `treemap|cloud|timeline|over-time`, treemap checked), four views (`role="img"` + summary on cloud/over-time; treemap and timeline cells are real `<a>`), one legend; cloud words are `<button type="button" data-tap-filter="<id>">`.

- [ ] **Step 1: Failing tests** — axis for one post (`days` 1, x = 0); xPercent for the mock's 1–15 Nov axis gives `100/14` per day; three posts on one date get levels 0,1,2 and a fourth a day later gets 0 if clear (Review Focus 4); bands for 5 posts in one section reach y = 10 at the end; band tops scaled when 8 posts; treemap omits empty sections and weights by count (Review Focus 1); `heroChartHtml` contains exactly 4 radios with treemap checked, every post's URL in treemap and timeline, and escapes a title containing `<script>`.
- [ ] **Step 2:** `npm test` — FAIL.
- [ ] **Step 3:** Implement (polygons as `clip-path: polygon(...)` style strings; ticks as the handoff's repeating gradient with `--days`). Shared HTML escaping in `plugins/dataviz/escape.js` (`escapeHtml`, `escapeAttr`).
- [ ] **Step 4:** `npm test` PASS.
- [ ] **Step 5:** Commit `feat: hero chart geometry and markup`.

### Task 7: Tables, post-page blocks and the blocks plugin

**Files:** Create `plugins/dataviz/tables.js`, `plugins/dataviz/post-page.js`, `plugins/dataviz-blocks.js`; modify `config/main.js` (`plugins.after: ['dataviz-blocks']`); test `test/tables.test.js`, `test/post-page.test.js`, `test/blocks.test.js`.

**Interfaces:**
- Consumes: Tasks 2–6 (`Section`, `Post`, `heroChartHtml`, escape helpers, chrome classes).
- Produces: placeholders and their renderers (all return HTML strings):
  - `<tap-hero-chart>` → `heroChartHtml`.
  - `<tap-post-table section="all|<id>" n="1" caption="All posts">` → `postTableHtml({ posts, sections, n, caption, filters: section === 'all' })`: caption with "Showing X of Y", chips (All + one per post section with mark and count) when `filters`, native `<select>` (Newest, Oldest, Title A–Z, Section), every row in HTML (number, title link, mark + section, date), `data-tap-table` with `data-show="3"`; "No posts yet" when empty.
  - `<tap-section-block section="<id>" block="<blockId>" n="…" kind="table|fig">` → `sectionBlockHtml(sectionData, …)`: renders the data file's rows (table rows, or a grid of `.tap-placeholder` figures), "Sample" tag when the file has `test: true`.
  - `<tap-notes n="2">`, `<tap-repos n="3" stars>` → Bluesky/GitHub tables with "Sample" when `test`.
  - `<tap-post-toc>` → "Table 1 — In this post" from the page's `h2`/`h3` (adds ids when missing); `<tap-more-in-section section="${section}" url="${url}">` → latest 3 other posts in the section; `<tap-prev-next url="${url}">`; `<tap-plate>` → `00` home / section number / post number, then "— page title".
  - `numberFigures(document)`: in a post's article, `figure > figcaption` gets a `Fig. n — ` prefix and code blocks (`pre`, `code-block`) get a `Listing n — ` caption from their title/label; idempotent.
  - Nav `aria-current="page"`: the plugin marks the nav link whose `href` matches the page's section page (and, on posts, the post's section).
  - `dataviz-blocks.js` reads `dist/**/*.html`, parses with linkedom, swaps placeholders, writes back only when changed; an unknown `tap-*` placeholder is replaced with nothing and logs a warning naming page and tag.
- `dataviz.js` (Task 5) gains the table enhancement: filter chips (`aria-pressed`), sort select, show 3 / More +N / Fewer, Clear filter when filtered, "Showing X of Y" updates; cloud buttons set the Table 1 filter.

- [ ] **Step 1: Failing tests** — `postTableHtml` for 5 posts shows "Showing 5 of 5", 7 chips (All plus one per post section in the fixture's 6 post sections), all 5 rows newest first; empty → "No posts yet"; `sectionBlockHtml` adds "Sample" iff `test`; toc lists headings and adds missing ids; `numberFigures` twice gives one prefix; more-in-section excludes the current post and caps at 3; plate numbers for home/section/post; `blocks.test.js` runs the plugin on a fixture dist dir (temp) and asserts every placeholder replaced, an unknown one removed with a warning, and nav `aria-current` set.
- [ ] **Step 2:** `npm test` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` PASS.
- [ ] **Step 5:** Commit `feat: generated tables and post-page blocks`.

### Task 8: Layouts and pages

**Files:** Create `src/layouts/home.html`, `section.html`, `about.html`; rewrite `src/layouts/post.html` (option A); restyle `page.html`, `essay.html`, `guide.html`, `reference.html`, `landing.html` (same slots and fields as now); create `src/<slug>/index.html` for each section in `sections.json` (front matter `title`, `section`, `layout`; empty body for posts sections — the layout holds the blocks — and About's overview text for `about`), `src/search.html`, rewrite `src/index.html` (layout `home`) and `src/404.html`; test `test/pages.test.js`.

**Interfaces:**
- Consumes: placeholders (Task 7), chrome classes (Task 5), fields `section`, `sections`, `sectionData`.
- Section layout: `Section NN`, large mark + h1 (`${title}`), intro, then for its section the placeholder list from the spec's Section pages table — the layout holds **one** set of placeholders keyed by `${section}`, and `tap-section-block` renders nothing for a block the section's data file doesn't have, so one layout serves all post sections. Post sections always get `<tap-post-table section="${section}">`.
- Post layout (option A): label line (mark, section, `Post NN` via `<tap-plate>`-style placeholder `<tap-post-label url="${url}">`), h1, dek `${description}` (`data-if`), meta rule (date, reading time, tags) via `<tap-post-meta url="${url}">`, `${content}`, prev/next; aside with `<tap-post-toc>` and `<tap-more-in-section>`; existing `og:image` head slot kept.
- Search page: a field filtering a generated `dist/search.json` (`[{ title, url, section, date, summary }]`, written by `dataviz-blocks.js`) client-side; without script, a list of all posts by section.
- 404: chrome + "Not found" + section links (`data-repeat` over `sections`).
- Posts' front matter is not changed.

- [ ] **Step 1: Failing tests** — `pages.test.js` builds and asserts: every section in `sections.json` has `dist/<slug>/index.html` with its h1 and nav `aria-current`; `/teaching/` lists "Office Hours"; home has the hero (4 radios) and Table 1 with every post; a post page (`/posts/office-hours/`) has the toc, "More in Teaching" and figure numbering; `/about/` has CV/Books/Elsewhere with "Sample"; `/search/` and `/404.html` exist in the chrome; `npx cook check-layouts` exits 0 with every layout in `src/layouts` editable.
- [ ] **Step 2:** `npm test` — FAIL.
- [ ] **Step 3:** Implement; set the test posts' sections only via the posts model's defaults — but "Office Hours" → Teaching and "Hello NES!" → Personal require front matter `section:` on those two posts: add it to the **worktree's** copies (the user's uncommitted `office-hours.html` edit lives only in the main checkout and is untouched).
- [ ] **Step 4:** `npm test` PASS.
- [ ] **Step 5:** Commit `feat: Dataviz D layouts and pages`.

### Task 9: Vanilla Press keeps a post's section (vanilla-press repo)

**Files:** `~/src/vanilla-press`: `src/store/schema.sql` + `src/store/migrate.js` (column `section TEXT`), `src/store/content.js` (row ↔ `meta.section`), `src/sync/front-matter.js` (write `section` after `layout`), `src/sync/from-site.js` (read it), tests in `test/store/`, `test/sync/`.

**Interfaces:**
- Produces: `meta.section` round-trips: site file → VP import → save → site file keeps `section: "<id>"`; absent stays absent. No UI (that's the Sections project).

- [ ] **Step 1: Failing tests** — `frontMatter({ meta: { …, section: 'teaching' } }, …)` contains `section: "teaching"`; a synced page with `section` imports with `meta.section`; a save without section in the body keeps the stored one (PUT merges meta); migration adds the column to an existing DB.
- [ ] **Step 2:** `npm test` — FAIL.
- [ ] **Step 3:** Implement following the existing `layout` column's path.
- [ ] **Step 4:** `npm test` — all pass.
- [ ] **Step 5:** Commit `feat(sync): keep a post's section in front matter`.

### Task 10: Verification and README

**Files:** site `README.md` (sections file, sample tags, fetched snapshots, `GITHUB_TOKEN` optional); script in the session scratchpad.

- [ ] **Step 1:** `npm run build` online → succeeds, snapshots real; `TAP_OFFLINE=1 npm run build` (Task 4's `withSnapshot` treats `TAP_OFFLINE=1` as a failed fetch) → succeeds using the snapshots.
- [ ] **Step 2:** Serve `dist/` on a free port; Playwright at 1280×900 and 390×844 over home, every section page, About, one post, search, 404: no console errors, no horizontal scroll, every interactive target ≥ 44px; hero radios switch views; Table 1 filter/sort/More/Fewer/Clear work; Hot take opens and "Another" changes the take; weather line present or omitted cleanly. With JavaScript disabled: hero switches, all rows visible newest first, Hot take opens (Review Focus 5). Save screenshots to the scratchpad.
- [ ] **Step 3:** Layout editability: `npx cook check-layouts` (0 problems) and a `node -e` script using `cook-ssg/layouts` `listLayouts(process.cwd())` asserting every layout and fragment is `editable: true` (VP uses the same checker).
- [ ] **Step 4:** `npm test` in the site and in VP: all pass.
- [ ] **Step 5:** Commit `docs: Dataviz D site notes`.
