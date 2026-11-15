# thomasapowell.com in "Dataviz D"

Status: draft for review (2026-11-14)
Design source: `~/src/thomasapowell.com/thomasapowell-dataviz-d/` (`DESIGN.md`, `tokens.css`, `boards/*.dc.html`,
`gen_pages.py`). That handoff is the visual authority; this document says how it becomes the real site.
Repos: `~/src/thomasapowell.com` (the site: Cook + Vanilla Breeze, deployed by Cloudflare Pages from GitHub,
`npm run build` → `dist`), `~/src/cook` and `~/src/vanilla-press` only if something below needs them.
Follow-up project (separate design, after this one): **Sections in Vanilla Press**.

## Why

The user has the design they want for their site and wants it live as a test site, with the test content that
exists now, "scaffold the whole site and if we can't do it yet … make it have test pages for all sections".
The site must stay a Vanilla Press site: posts are written in VP, layouts are VP-editable format-1 layouts, and
deploy is the normal VP publish → GitHub → Cloudflare Pages path.

## Goals

1. Every page of the handoff exists and works: home and the seven section pages (Writing, Code, Teaching, Work,
   Art, Personal, About), with the shared chrome (utility strip, header with status line, nav as legend,
   footer, Hot take).
2. Pages the handoff didn't design exist in the same look: **post page** (the user chose option A, below),
   standalone page (for page sections such as About), search, 404.
3. **Sections are data**, defined in one file in the site, `config/sections.json`; nothing about the seven
   current sections is hard-coded in layouts, CSS or scripts.
4. Everything that can be real now is real, built from the site's posts and data at build time; everything
   that can't is clearly-marked test content in data files, replaceable later without touching layouts.
5. The site builds with `npm run build` and deploys through the existing path.

## Non-goals and anti-goals

- **Not** the Vanilla Press Sections screen or the Section control in post settings — that is the follow-up
  project. Here, sections are edited by hand in `config/sections.json`, and a post's section is set in its
  front matter (`section: <id>`), which VP already round-trips if it keeps unknown front matter (the builder
  must check; if VP drops it, that's a VP fix inside this project — see Constraints).
- **No dark palette** (not designed). The theme switch exists and toggles `color-scheme` / `data-theme`, but
  both states use the light palette until a dark one is designed.
- **Anti-goal: layouts VP can't open.** Every layout and include must pass VP's layout checker and open in the
  layout editor. Build-time logic (charts, tables, fetches) lives outside the layouts, never as hand-written
  markup the layout editor can't represent.
- **Anti-goal: shipping the design-canvas boards.** They are read for structure and values only.
- No SVG charts (the handoff: HTML and CSS only, so they stretch with the container).
- No writes to the live site: nothing is pushed or published by the builder; the user publishes.

## Sections

`config/sections.json`, ordered (the order is the nav order):

```json
[
  { "id": "writing",  "label": "Writing",  "slug": "writing",  "kind": "posts", "shape": "circle",      "color": "#2F5578", "intro": "…" },
  { "id": "code",     "label": "Code",     "slug": "code",     "kind": "posts", "shape": "square",      "color": "#3F6B52", "intro": "…" },
  { "id": "teaching", "label": "Teaching", "slug": "teaching", "kind": "posts", "shape": "plus",        "color": "#2F6B6E", "intro": "…" },
  { "id": "work",     "label": "Work",     "slug": "work",     "kind": "posts", "shape": "bar",         "color": "#1E2326", "intro": "…" },
  { "id": "art",      "label": "Art",      "slug": "art",      "kind": "posts", "shape": "triangle",    "color": "#7A5A3C", "intro": "…" },
  { "id": "personal", "label": "Personal", "slug": "personal", "kind": "posts", "shape": "diamond",     "color": "#555D5A", "intro": "…" },
  { "id": "about",    "label": "About",    "slug": "about",    "kind": "pages", "shape": "open-circle", "color": "#555D5A", "intro": "…" }
]
```

- `kind: "posts"`: a listing page at `/<slug>/` built from posts whose front matter says `section: <id>`, plus
  the section's extra blocks (below). Its posts appear in the home charts and Table 1.
- `kind: "pages"`: standalone pages under `/<slug>/…` (About: Overview, CV, Books), not dated, not in the home
  charts or Table 1. The section's landing page is its own page.
- `shape` is one of the seven the design draws; the mark is drawn in CSS from the shape name and colour, the
  same everywhere (nav, tables, charts, chips, post page).
- A post without a `section` (or with an unknown one) is built and listed under Writing *(my call)* and the
  build prints a warning naming it. Posts are assigned for the test site: "Office Hours" → Teaching,
  "Hello NES!" → Personal (the handoff's guesses); the rest → Writing *(my call)*, all changeable in front matter.
- Section intros and the extra blocks' data are test content, in `config/sections/<id>.json` (or one data file;
  builder's call), each marked `"test": true` where invented.

## Pages

**Home** (as the handoff): intro (h1 + bio); Fig. 1 hero chart with the four views — treemap, cloud, timeline,
over time — switched by radio inputs and `:has(:checked)`, one legend; Table 1 All posts (Showing X of Y,
filter chips per post section with mark and count, native sort select, 3 rows then More +N / Fewer / Clear
filter); Table 2 Notes via Bluesky beside Table 3 Code via GitHub. Charts are generated at build time from the
post list and `sections.json` (positions and polygons computed as the handoff's "Chart geometry" says, axis
from the first to the last post date). The handoff's home charts assume four sections; build for however many
post sections the file has.

**Section pages** (posts kind): `Section NN`, large mark + h1, intro, then the blocks the handoff lists for that
page (Writing: Posts · Articles; Code: Repositories with star bars · Demos grid; Teaching: Classes · Posts;
Work: Companies · Posts; Art: Code art grid · Photos grid · Cyber writing; Personal: Posts · Travels ·
Home-base map · Collections grid). "Posts" tables are real (from posts); every other block reads its section
data file. Code's Repositories table uses the same GitHub fetch as home Table 3.

**About** (pages kind): Overview page with the handoff's blocks (CV, portrait + overview, Books, Elsewhere on
this site), as an editable page whose tables come from its data file; CV and Books as their own pages
*(my call: one landing page with the four blocks, plus the data; separate CV/Books pages only if the builder
finds the layout needs them)*.

**Post page — option A** (chosen in the mockup): reading column; right margin with "Table 1 — In this post"
(contents from the post's headings) and "Table 2 — More in <section>" (latest 3 other posts in the section);
label line "<mark> <Section> · Post NN"; h1; dek (the post's description); meta rule with date, reading time,
tags; figures captioned "Fig. n — …" and code blocks "Listing n — …" (numbered at build time; existing
`figcaption`s and code-block titles become the caption text); previous/next by date at the end. On a phone the
margin tables move above the article. Post `number` is the post's position by date across all posts
*(my call; the handoff's `number` field is not something VP writes)*.

**Search**: a page in the chrome with a search field and results from the build's search index *(builder
checks what Cook provides; if nothing, a client-side filter over a generated JSON of title/section/date/summary
is acceptable)*. **404**: in the chrome, with links to the sections.

## Data, live and fetched

- **Bluesky**: at build time, `app.bsky.feed.getAuthorFeed` for `tpowell.bsky.social`, latest 3 original
  posts (no reposts/replies): text, date, reply/repost/like counts, link.
- **GitHub**: at build time, `ProfPowell`'s pinned repositories (public GraphQL needs a token; if none is
  available in the build, use the REST API's most recently pushed public repos) — name, description,
  language, stars, link.
- **Failure rule (both)**: a failed fetch uses the last successful result kept in the build cache; with none,
  marked test rows. A build never fails because a service is down. Cloudflare Pages builds start without the
  local cache, so the committed fallback for a fresh build is the test rows *(my call; the builder may instead
  commit a last-known JSON snapshot if that's cleaner)*.
- **Weather**: live in the browser from Open-Meteo (no key) for the configured location; on failure the status
  line shows location and time only.
- **Clock**: `Intl.DateTimeFormat` with the configured time zone, every 30 s; server-rendered build time as the
  no-script fallback.
- **Location**: San Diego, `America/Los_Angeles`, with latitude/longitude, in site config.
- **Hot takes**: a list in site config (test strings).

## Platform and progressive enhancement (from the handoff)

Hero switcher with radios and `:has(:checked)`; Hot take with `popover`/`popovertarget` (script only for
"Another"; bobbing off under `prefers-reduced-motion`); filter, sort and More render all rows in HTML and hide
with script (no script: everything visible, newest first); real `<a>`, `<button>`, `<select>`, `<label>`;
`aria-pressed` on toggles, `aria-expanded` on the Hot take trigger, `aria-current="page"` in the nav; charts as
`role="img"` with a text summary except where they hold real links (treemap, timeline). 44px targets. Text
contrast ≥ 4.5:1 on paper.

## Look

The handoff's tokens (`tokens.css`) become the site's theme: a Vanilla Breeze theme file mapping VB's variables
to the `--tap-*` values (square corners, no shadows, IBM Plex Sans and Mono, paper ground), selected in
`config/theme.json`. Fonts are self-hosted (IBM Plex is OFL) *(my call: no third-party font requests)*.
Layout rules as the handoff: 1248px container, `clamp(20px, 4vw, 56px)` padding, wrapping flex two-column
blocks, auto-fit grids, no media queries needed for the stacking.

## Constraints

- Work on a branch in `~/src/thomasapowell.com`. The user's own uncommitted files there (`essay.html`,
  `office-hours.html`, `the-post-layout-post.html`, `src/layouts/test.html`, `src/layouts/thomas.html`,
  `.cache/`) are theirs: never modify, stage or delete them. Never push. The user publishes.
- Existing posts keep working; their `layout` front matter values (`page`, `essay`, …) must still resolve —
  either those layouts are restyled in the new look or posts are moved to the new post layout via front matter
  the builder sets and lists for the user.
- Every layout and include passes VP's checker and opens in VP's layout editor (check with the app's layouts
  listing, `editable: true`).
- Build-time logic goes in Cook plugins / `config/data.js` / site scripts; if Cook's format-1 layouts can't
  place generated blocks, the gap is fixed in Cook (on a branch, unpublished) rather than worked around with
  hand-written markup.
- If VP drops unknown front matter (`section`), fix VP to keep it (on a branch) — posts edited in VP must not
  lose their section.
- Browser checks with time-limited Node Playwright; no MCP browser tools; never alert/confirm/prompt.

## Done means

`npm run build` succeeds offline and online; every page in the nav, every post, About, search and 404 render in
the look at desktop and phone width; the four hero views switch without script; Table 1 filters/sorts/expands
with script and shows everything without; Bluesky and GitHub rows are real when online; every layout opens in
VP's layout editor; a post edited and saved in VP keeps its section; test content is marked as such in its
data files; and the user can publish it.

## Settled after the builder check *(all my calls unless marked)*

1. **Section pages are files.** Each section has a page file, `src/<slug>/index.html`, with front matter
   `section: <id>` and the section (or About) layout. That file is content, not hard-coding: the layouts, CSS
   and scripts read everything from `sections.json` and the page's `section`. Adding a section by hand means
   adding it to `sections.json` and creating its page file; the follow-up VP Sections screen will do both.
2. **Generated blocks in layouts** are placed as components or includes the layout editor shows as opaque,
   labelled blocks (e.g. "Post table", "Hero chart"); their content is rendered at build time. They need not be
   editable in the layout editor beyond placing, moving and removing them. Prefer the site's own plugins
   (`plugins/`, `config/data.js`) over Cook changes. If a Cook change is unavoidable, it goes on a Cook branch
   and the site cannot deploy it until the user publishes that Cook version — the builder flags this as soon
   as it's known, and the plan orders work so everything else is done first.
3. **Fetched data.** Cloudflare builds are online, so they fetch real data. A committed snapshot,
   `content/fetched/bluesky.json` and `github.json`, is refreshed by every successful build and is the
   fallback when a fetch fails (so an offline build still shows the last real rows); test rows only if no
   snapshot exists. GitHub: pinned repositories when a `GITHUB_TOKEN` is present in the build environment,
   otherwise the most recently pushed public repos — both are real. A scheduled rebuild for fresher Bluesky
   notes is out of scope (a follow-up via a Cloudflare deploy hook).
4. **Existing layouts.** `base` becomes the Dataviz chrome; every existing layout (`page`, `post`, `essay`,
   `guide`, `reference`, `landing`) keeps its structure and slots under that chrome and is restyled in the
   look. `post` becomes the option A post page. No post's front matter is changed. The site theme becomes
   the Dataviz theme in `config/theme.json`; VP's per-page themes (`theme` + `themeScope: page`) keep working
   as they do now, since they're a VP feature the test posts use.
5. **Numbers.** A post's number is its position by date, oldest = 01, across all post-kind sections; new posts
   take the next number, so existing numbers only change if a post is backdated. "Section NN" is the section's
   position in `sections.json`; "Plate NN" in the utility strip is 00 for home, the section's number on
   section pages, and the post's number on posts.
6. **The checker.** Run VP's layout checker (the app's layouts listing reports `editable` and problems, or
   Cook's `parseLayout`/checker directly). Anything it rejects (radios, `popover`, inline script) moves into a
   component/include, the theme CSS, or a site script — not into the layout.
7. **About** is one page, `/about/`, with the four blocks (CV, portrait + overview, Books, Elsewhere); CV and
   Books are data-file tables on it.
8. **Post tables.** A section's "Posts" table lists posts whose `section` is that section; home Table 1 lists
   all posts in post-kind sections. Writing's "Articles" table reads the Writing data file (test rows) until an
   article flag is designed.
9. **Sample content is marked (the user's decision).** Every block whose data is invented (`"test": true` in
   its data file) shows a visible "Sample" tag in its Table/Fig caption, in the caption's mono label style,
   and the tag disappears automatically when the data file stops saying `test`. Fetched blocks falling back to
   test rows show it too. Real data (posts, fetched Bluesky/GitHub rows) is never tagged.

## Left to the builder

- How generated blocks (charts, tables) reach format-1 layouts (plugin-provided components or includes, data
  fields, or a Cook change) — the hardest question; a short spike first is expected.
- File layout of the theme, CSS, scripts and section data; naming.
- How headings, figures and code blocks are numbered and captioned at build time.
- Search implementation within the rule above.
