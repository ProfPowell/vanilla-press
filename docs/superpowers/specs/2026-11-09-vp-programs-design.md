# Programs: hand-written demos on a Cook site

Roadmap step "Programs". Status: draft for approval, 2026-11-09.

## Intent

Thomas makes small hand-written programs: one-page demos, toys, satire
apps, effects. He writes them himself or with an agent. Today they live on
cyberviber.ninja (an Eleventy site in `~/src/retro-fun`). Each one is a
folder under `src/demos/<slug>/`, copied to the site untouched.
`src/_data/demoMeta.json` holds a card for each listed one: title,
description, date, tags, preview. A folder without a card is live but
unlisted (the `fart` demo). Adding a program today means copying a folder,
hand-editing JSON, and often writing a post about it.

Vanilla Press should do that work. Give a program a path, bring its files
in, fill in its card, list it or not, and write a post about it. VP never
edits a program's own files.

cyberviber.ninja moves to Cook later and is the real target. **This step
uses its demos as the model and tests on thomasapowell.com.**

## Goals

- A **Programs** section in a site, enabled in the rail where "Coming
  later" shows it today.
- **Add a program** two ways:
  - **From a folder on this computer**, e.g. a program's own repo or its
    build output. Use the existing folder browser (`GET /api/folders`). VP
    remembers the source folder, so **Update from source** copies it
    again later.
  - **Upload** a folder from the browser: drop it, or pick it with a
    folder input. This is for programs that have no folder on this
    computer.
- Each program gets a **path**: `/programs/<slug>/` by default. The slug
  is editable while adding, then fixed, because links point at it.
- A **card** for each program:
  - title;
  - description;
  - date;
  - tags;
  - a preview image from the site's media library, or none;
  - **Listed / Unlisted**.
- **Write a post about it**: makes a draft post with the program's
  title, description, featured image and a link to the program. The post
  opens in the editor, and from there it is a normal post.
- The live site gets a **programs list**, built by Cook from the cards.
  On thomasapowell.com this is a `/programs/` page of cards.
- **Open** a program to see it running inside VP, and **View live ↗**.
- **Remove** a program: deletes its folder and card. Ask first, in the
  page, never with a browser dialog. Refuse while a post links to it (the
  same rule as media "Used in").

## Non-goals

- Editing a program's files in VP. No code editor, no file manager.
- Building a program: no npm, no bundler. VP copies what it is given; if
  a program needs a build, point VP at its build output.
- Migrating cyberviber.ninja to Cook. That is its own step later.
- cyberviber's animated CSS card previews (`css/previews.css`). The site
  can do them itself (see "Card fields" for `previewClass`); VP has no UI
  to make them.
- Analytics and Social. Each gets its own design later.

## Anti-goals (a failure even if it works)

- **VP changes a program's files.** This includes Cook processing them:
  template strings, includes, minifying, clean-URL rewrites. A program's
  `${…}` in its JS must reach the browser byte for byte.
- **Running a program inside the VP app can reach the VP API.** Programs
  are arbitrary JS.
- **A half-copied program goes live.**

## How it works

### On disk, in the site repo

- `src/programs/<slug>/`: the program's files, exactly as given. It must
  contain `index.html` at its top level.
- `config/programs.json`: the cards, one entry per program:

  ```json
  {
    "programs": [
      {
        "slug": "plasma",
        "title": "Plasma",
        "description": "Old-school plasma effect.",
        "date": "2026-11-09",
        "tags": ["Demo", "CSS"],
        "image": "/media/plasma.png",
        "listed": true
      }
    ]
  }
  ```

  Optional keys: `previewClass` (a CSS class name for a site that draws
  its own previews, as cyberviber does) and `order` (number, ties on the
  same date).
- The source folder for **Update from source** is local to this
  computer. It goes in VP's workspace database, not in the repo.

### Cook: built-in programs (Cook minor version)

This follows the theme step: a generic Cook feature any site can use,
with a site's own look kept in the site.

- **Programs folder, untouched:** Cook copies `src/programs/` to
  `dist/programs/` and runs no page or asset processing on it:
  - no front matter;
  - no templates or includes;
  - no template strings;
  - no minifying or bundling;
  - no image rewriting or derivatives;
  - no clean-URL directories;
  - no theme;
  - no fragments;
  - nothing added to the sitemap, feed or `llms.txt`.

  "Untouched" covers the **program folders**, `src/programs/<slug>/`.
  A site's own `src/programs.html` becomes `dist/programs/index.html` as
  a normal page, which is the list page. It never collides with a
  program, since each program is a subfolder.

  This is a **built-in rule in Cook**, not something a site sets in
  `excludePaths` (my call). One internal check, "is this path inside a
  program folder", is consulted by every pass that copies or walks
  files. Today's `excludePaths` covers only the per-file loop. The
  builder check found these other passes also need it:
  - `copy-src`: it drops `.md` files, so a program's `README.md` must be
    copied;
  - `processMarkdown`;
  - `createDirFromFile`;
  - `htmlCollections`;
  - `optimizeImagesGenerate` / `findImages`;
  - `collectSitePages` (fragments and formats);
  - `generateSitemap`;
  - `fingerprintAssets`;
  - `applyBasePath`. A program on a site with a `basePath` must use
    relative URLs; Cook doesn't rewrite them.
  - the dev server's single-page rebuild path.

  A Cook test builds a site with a `src/programs.html` page and a
  program containing:
  - `${x}`;
  - `<img>`;
  - a second `.html` file;
  - a `data-include`;
  - a `README.md`;
  - a `.css` and a `.js` file.

  With `basePath` set and fingerprinting on, every file under
  `dist/programs/<slug>/` must match `src/programs/<slug>/` byte for
  byte.
- **Card data:** Cook reads `config/programs.json` (re-read every build,
  like `theme.json`). It exposes `programs` in the data store as all
  listed programs, newest first (then `order`), each with `url` set to
  `/programs/<slug>/`. Unlisted programs are not in `programs`.
- The folder name `programs` is fixed in this step (my call). A setting
  can come with cyberviber, whose URLs are `/demos/<slug>/`. Keeping its
  URLs will need `programs.path: 'demos'`. Note this in Cook's docs as
  planned.
- Docs: `docs-site/src/docs/programs.md` in Cook.

### Vanilla Press

**Server (`src/programs/`, `src/app/program-routes.js`):**
- `GET /api/sites/:id/programs`: the cards, plus the folders found under
  `src/programs/` that have no card (stray folders). A folder dropped in
  by hand or by an agent shows up as an **unlisted program without a
  card**, so VP finds programs, not just adds them.
- `POST …/programs` (from a folder: `{ source, slug }`),
  `POST …/programs/upload` (multipart files with relative paths),
  `PATCH …/programs/:slug` (card fields),
  `POST …/programs/:slug/refresh` (Update from source),
  `DELETE …/programs/:slug`.
- **Copying is all or nothing:**
  - Copy into a temp folder inside the site (`.vp/tmp/`), check it, then
    rename it into `src/programs/<slug>/`.
  - Update from source swaps the folders the same way, so a failed copy
    leaves the old version in place.
- **What may be copied:**
  - Regular files only. Symlinks are refused.
  - Skip `.git/`, `node_modules/` and `.DS_Store`.
  - Refuse paths that escape the folder.
  - Refuse a program without a top-level `index.html`.
  - Limits: 50 MB total, 2,000 files, and 25 MB per file
    (Cloudflare Pages' limit, `MAX_BYTES` in `src/media/limits.js`).
    These are my calls.
  - Show the media screen's large-file note (`LARGE_NOTE`) when a
    program is over 10 MB, because every update adds to the repo's
    history.
  - `.vp/` is already ignored by git in sites. Clear leftover
    `.vp/tmp/` folders when the app opens a site.
- **Slugs** use the media slug rules (`src/media/names.js`). Refuse
  slugs that are taken.
- **Going live:**
  - Adding, updating, removing and editing a card are each one commit,
    pushed like the media and theme library writes, through the same
    write queue.
  - The live site rebuilds from the push.
  - A new program starts **Unlisted**, so it is live at its URL but in no
    list until you list it.
- **"Used in":** posts that link to `/programs/<slug>` (with or
  without the trailing slash) or to any file inside it. This covers
  saved bodies and committed pages under `src/`, as for media. Cook's
  data-driven list page doesn't count. Remove is refused while it's
  used, with the post names.
- **Card and folder disagree:**
  - A card whose folder is gone shows **Missing folder**, like media's
    Missing file. It's kept, not removed: you can Update from source or
    Remove it. Cook skips it in `programs`.
  - A folder with no top-level `index.html` shows **Not a program (no
    index.html)** and can't be listed.

**Programs screen (`app/site.html` section, `app/assets/js/programs-*.js`):**
- Same shell as Media: header "Programs", "N programs · M unlisted",
  primary **Add program** (opens a panel: "From a folder on this
  computer" with the folder browser, or "Upload a folder").
- Filters: All / Listed / Unlisted / No card; search by title or slug.
- A list or grid of programs: preview image or a plain placeholder,
  title, path in mono, Listed/Unlisted.
- Selecting one fills a detail panel:
  - the card fields, saved on change like media alt text;
  - path, with Copy;
  - source folder and **Update from source** (when it came from a folder);
  - Used in;
  - **Write a post about it**;
  - Open;
  - View live ↗;
  - **Remove…**.
- **Open** runs the program in an iframe served from a **separate
  origin**: a second listener on its own port that serves only
  `src/programs/` of the open sites (`/<siteId>/<slug>/…`), with no API
  routes. A different port is a different origin, so the program can't
  call the VP API. It still behaves as it does live:
  - `localStorage` and IndexedDB work (retro-fun's `vibe-code-racer`,
    `div-vaders` and `rug-pull` use them);
  - module imports and `fetch` of its own files work (`h3`,
    `variable-font-warp`, `agentic-chaos`).

  A `sandbox` attribute without `allow-same-origin` would break those,
  so it isn't used (my call, from the builder check). The program
  server binds 127.0.0.1 only, like the app.
- Tokens and layout follow `docs/design/README.md`. No mockup exists. The
  builder follows the Media screen's patterns, and design fixes come
  after.

**Write a post about it:** creates a draft post through the existing
document API:
- title: the program's title;
- description: the program's description;
- featured image (`image`): the program's image;
- body: one paragraph, "Try it: <a href="/programs/<slug>/">title</a>".

It then opens the editor. Posts link to programs with a plain link (my
call); a "program card" block can come later.

### thomasapowell.com (the test site)

- `src/programs.html`: a "Programs" page that lists cards with
  `data-repeat="programs as program"`:
  - image;
  - title linking to `program.url`;
  - date;
  - description;
  - tags.

  It uses the site's layout and VB, and the site's own CSS for the cards.
- A "Programs" link in the site's navigation.
- One real test program, added through VP. Use a small demo copied from
  `~/src/retro-fun/src/demos/` (e.g. `plasma`): a self-contained
  `index.html`.
- Version bump to the new Cook, as in the theme step. Until Cook is
  published, build and test the site against local Cook (`npm link` or
  a temporary `file:` dependency that isn't committed). The committed
  `package.json` names the new version, and the user publishes Cook
  before the site is pushed. Local commits, pushed only with the user's
  OK.

## Constraints

- No browser `alert`/`confirm`/`prompt`.
- VB tokens only in CSS. Semantic markup, keyboard and screen-reader use
  as in the other screens.
- TDD for server and pure modules. UI gets browser checks with
  time-limited Playwright scripts.
- Never touch `~/src/retro-fun` beyond reading and copying a demo out of
  it.
- Pushes and npm publishes only with the user's OK. Cook is published by
  the user.

## Left to the builder

- Grid or list for the program tiles.
- How upload sends relative paths (multipart field names) and the upload
  size check order.
- Whether stray folders get a card automatically when first selected, or
  only when a field is saved (my lean: when saved).
- Error wording, following the media screen.
