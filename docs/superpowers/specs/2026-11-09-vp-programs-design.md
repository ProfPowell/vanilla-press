# Programs: hand-written demos on a Cook site

Roadmap step "Programs". Status: draft for approval, 2026-11-09 (revised
after the user asked for configurable paths, a configurable sandbox and a
careful look at security).

## Intent

Thomas makes small hand-written programs: one-page demos, toys, satire
apps, effects. He writes them himself or with an agent. Today they live on
cyberviber.ninja (an Eleventy site in `~/src/retro-fun`). Each one is a
folder under `src/demos/<slug>/`, copied to the site untouched.
`src/_data/demoMeta.json` holds a card for each listed one: title,
description, date, tags, preview. A folder without a card is live but
unlisted (the `fart` demo). Adding a program today means copying a folder,
hand-editing JSON, and often writing a post about it.

Vanilla Press should do that work:
- give a program a path;
- bring its files in;
- fill in its card;
- list it or not;
- write a post about it.

VP never edits a program's own files. Programs are arbitrary JavaScript,
often written by an agent, so security is part of the design, not an
afterthought (see "Security").

cyberviber.ninja moves to Cook later and is the real target. **This step
uses its demos as the model and tests on thomasapowell.com.**

## Goals

- **Program areas at any path the site chooses:**
  - `/apps/`, `/demos/`, `/programs/` or anything else.
  - A site may have more than one area: `/demos/` and `/apps/` side by
    side.
  - Each program lives in one area at `/<area>/<slug>/`.
- A **Programs** section in a site, enabled in the rail where "Coming
  later" shows it today. It holds all of the site's areas and their
  settings.
- **Add a program**, two ways:
  - **From a folder on this computer**, e.g. a program's own repo or its
    build output. This uses the existing folder browser
    (`GET /api/folders`). VP remembers the source folder, so **Update
    from source** copies it again later.
  - **Upload** a folder from the browser: drop it, or pick it with a
    folder input. This is for programs that have no folder on this
    computer.
- The slug is editable while adding, then fixed, because links point at
  it.
- A **card** for each program:
  - title;
  - description;
  - date;
  - tags;
  - a preview image from the site's media library, or none;
  - **Listed / Unlisted**.
- **A sandbox setting:**
  - Each area has a default and each program can override it.
  - It decides whether the program runs sandboxed: in VP's **Open** and
    on the live site.
- **Write a post about it:**
  - Makes a draft post with the program's title, description, featured
    image and a link to the program.
  - The post opens in the editor. From there it is a normal post.
- **A list on the live site:** Cook builds the list from the cards. On
  thomasapowell.com this is one `/programs/` page of cards.
- **Open** a program to see it running inside VP, and **View live ↗**.
- **Remove** a program:
  - It deletes the program's folder and card.
  - VP asks first, in the page, never with a browser dialog.
  - It's refused while a post links to the program, the same rule as
    media "Used in".

## Non-goals

- Editing a program's files in VP. No code editor, no file manager.
- Building a program: no npm, no bundler. VP copies what it is given; if
  a program needs a build, point VP at its build output.
- Migrating cyberviber.ninja to Cook. That is its own step later.
- **Moving a program between areas, or renaming an area that has
  programs.** Both break live URLs. An area's path can be changed only
  while it is empty (my call).
- Hosting programs on a separate domain or subdomain. See "Security" for
  when that becomes necessary.
- cyberviber's animated CSS card previews (`css/previews.css`). A site
  can do them itself with `previewClass`; VP has no UI to make them.
- Checking what external URLs a program loads (CDNs, APIs). That is the
  author's choice.
- Analytics and Social. Each gets its own design later.

## Anti-goals (a failure even if it works)

- **VP changes a program's files.**
  - This includes Cook processing them: template strings, includes,
    minifying, fingerprinting, clean-URL rewrites, base-path rewrites.
  - A program's `${…}` in its JS must reach the browser byte for byte.
- **A program can act on Vanilla Press.** It must not read or change
  sites, posts, files or git through the VP app while you look at it.
- **A secret goes live inside a program folder**, e.g. a `.env` file or
  a private key copied from a program's repo.
- **A half-copied program goes live.**

## How it works

### On disk, in the site repo

- `src/<area>/<slug>/` holds the program's files, exactly as given.
  - It must contain `index.html` at its top level.
  - A site's own list page for an area, e.g. `src/demos.html`, becomes
    `dist/demos/index.html` as a normal page. It never collides with a
    program, since each program is a subfolder.
- `config/programs.json` holds the areas and the cards:

  ```json
  {
    "areas": [
      { "path": "programs", "title": "Programs", "sandbox": false }
    ],
    "programs": [
      {
        "area": "programs",
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

  Optional program keys:
  - `sandbox` (`true` or `false`) overrides the area's default.
  - `previewClass` is a CSS class name, for a site that draws its own
    previews as cyberviber does.
  - `order` is a number that breaks ties on the same date.
- **Area paths:**
  - An area path is one lowercase segment using the media slug rules
    (`src/media/names.js`).
  - It may not be a path the site already uses for something else: an
    existing file or folder in `src/` that isn't that area, `media`,
    `assets`, `layouts`, `includes`, or any `buildOnlyPaths` entry.
  - Cook and VP apply the same rules. Cook warns and ignores a bad area;
    VP refuses it.
- **No area yet:** a site without `config/programs.json` has no
  programs. The Programs screen offers **Add an area**, suggesting
  `programs`.
- **Local only:** the source folder for **Update from source** is local
  to this computer. It goes in VP's workspace database, not in the repo.

### Cook: built-in programs (Cook minor version)

This follows the theme step: a generic Cook feature any site can use,
with a site's own look kept in the site.

**Program folders are untouched.** Cook copies each
`src/<area>/<slug>/` to `dist/<area>/<slug>/` and runs no page or asset
processing on it:
- no front matter;
- no templates or includes;
- no template strings;
- no minifying, bundling or fingerprinting;
- no image rewriting or derivatives;
- no clean-URL directories;
- no base-path rewrite;
- no theme;
- no fragments;
- nothing added to the sitemap, feed or `llms.txt`.

This is a **built-in rule in Cook**, not something a site sets in
`excludePaths` (my call). One internal check, "is this path inside a
program folder", is consulted by every pass that copies or walks files.
Today's `excludePaths` covers only the per-file loop. The builder check
found these other passes also need the check:
- `copy-src` (it drops `.md` files today);
- `processMarkdown`;
- `createDirFromFile`;
- `htmlCollections`;
- `optimizeImagesGenerate` and `findImages`;
- `collectSitePages` (fragments and formats);
- `generateSitemap`;
- `fingerprintAssets`;
- `applyBasePath`;
- the dev server's single-page rebuild path.

A program on a site with a `basePath` must use relative URLs.

**The byte-for-byte test.** A Cook test builds a site with two areas
(`demos`, `apps`), a list page for each, and a program containing:
- `${x}`;
- `<img>`;
- a second `.html` file;
- a `data-include`;
- a `README.md`;
- a `.css` and a `.js` file.

With `basePath` set and fingerprinting on, every file under
`dist/<area>/<slug>/` must match its source byte for byte.

**Card data.**
- Cook reads `config/programs.json`, re-read every build like
  `theme.json`.
- It exposes `programs` in the data store: all listed programs from
  every area, newest first, then by `order`. Each one has
  `url: '/<area>/<slug>/'`.
- It also exposes `programAreas`, keyed by area path. For example,
  `programAreas.demos` holds that area's listed programs, so a list page
  can use `data-repeat="programAreas.demos as program"`.
- Unlisted programs, and cards whose folder is missing, are in neither.

**Live sandbox.**
- For every program whose effective `sandbox` is `true`, Cook writes a
  header rule to `dist/_headers` (Cloudflare Pages and Netlify read this
  file):

  ```
  /<area>/<slug>/*
    Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-pointer-lock allow-modals
  ```

  The browser then runs that program in a unique origin. It can't read
  the site's storage or cookies, and the site's pages can't be scripted
  from it. The price is that the program's own `localStorage`,
  IndexedDB and cookies don't work.
- **The site's own rules:** if the site has its own `src/_headers`, Cook
  keeps it and adds the program rules after it. Cook writes
  `_headers` only when at least one program is sandboxed.
- **Other hosts:** a host that doesn't read `_headers` ignores the
  rules. Cook's docs say so.
- Header policy can't be set from a `<meta>` tag, because `sandbox` isn't
  allowed there.

**Docs:** `docs-site/src/docs/programs.md` in Cook.

### Vanilla Press

**Server (`src/programs/`, `src/app/program-routes.js`):**
- **Routes:**
  - `GET /api/sites/:id/programs`: the areas, the cards, and the folders
    found under each area that have no card (stray folders).
  - `POST …/programs/areas`, `PATCH …/programs/areas/:path` (title,
    sandbox default; path only while empty) and
    `DELETE …/programs/areas/:path` (only while empty).
  - `POST …/programs`: adds a program from a folder, `{ area, source, slug }`.
  - `POST …/programs/upload`: multipart files with relative paths.
  - `PATCH …/programs/:area/:slug`: card fields and sandbox.
  - `POST …/programs/:area/:slug/refresh`: Update from source, a
    two-step preview then apply (see "Security").
  - `DELETE …/programs/:area/:slug`.
- **Stray folders:** a folder dropped in by hand or by an agent shows up
  as an **unlisted program without a card**. So VP finds programs, not
  just adds them.
- **Copying is all or nothing:**
  - Copy into a temp folder inside the site (`.vp/tmp/`), check it, then
    rename it into place.
  - Update from source swaps folders the same way, so a failed copy
    leaves the old version.
  - `.vp/` is already ignored by git in sites. Clear leftover
    `.vp/tmp/` folders when the app opens a site.
- **What may be copied:** see "Security", import rules.
- **Size limits** (my calls):
  - 50 MB total, 2,000 files, and 25 MB per file (Cloudflare Pages'
    limit, `MAX_BYTES` in `src/media/limits.js`).
  - The media large-file note (`LARGE_NOTE`) appears over 10 MB, because
    every update adds to the repo's history.
- **Slugs** use the media slug rules. Slugs already taken in the area are
  refused.
- **Going live:**
  - Adding, updating or removing a program, editing a card or an area:
    each is one commit, pushed like the media and theme library writes,
    through the same write queue. The live site rebuilds from the push.
  - A new program starts **Unlisted**: live at its URL but in no list
    until you list it.
- **"Used in":**
  - Posts that link to `/<area>/<slug>` (with or without the trailing
    slash) or to any file inside it.
  - This covers saved bodies and committed pages under `src/`, as for
    media. Cook's data-driven list pages don't count.
  - Remove is refused while a program is used, naming the posts.
- **Card and folder disagree:**
  - A card whose folder is gone shows **Missing folder**, like media's
    Missing file. It's kept, not removed: you can Update from source or
    Remove it.
  - A folder with no top-level `index.html` shows **Not a program (no
    index.html)** and can't be listed.

**Program server, for Open (`src/programs/program-server.js`):**
- **Its own origin:** a second listener on its own port, so programs run
  at a different origin from the VP app.
  - It serves `/<siteId>/<area>/<slug>/…` from the open sites' program
    folders, and nothing else.
  - It is not a general static server; see "Security".
- **Not sandboxed:** the iframe has no `sandbox` attribute and the
  response carries no sandbox header. The program behaves as it does
  live:
  - `localStorage` and IndexedDB work (retro-fun's `vibe-code-racer`,
    `div-vaders` and `rug-pull` use them);
  - module imports and `fetch` of its own files work (`h3`,
    `variable-font-warp`, `agentic-chaos`).
- **Sandboxed:**
  - The iframe gets `sandbox="allow-scripts allow-forms allow-popups
    allow-pointer-lock allow-modals"`, with no `allow-same-origin`.
  - The response carries the same `Content-Security-Policy: sandbox …`
    header the live site sends.
  - So Open shows what the live site will do, including storage that
    stops working.

**Programs screen (`app/site.html` section, `app/assets/js/programs-*.js`):**
- Same shell as Media.
- **Header:** "Programs", "N programs in M areas · K unlisted", and the
  primary **Add program** button. It opens a panel:
  - choose the area;
  - "From a folder on this computer" (with the folder browser) or
    "Upload a folder";
  - the slug.
- **Areas:** a small "Areas" panel lists each area: path, title, sandbox
  default, number of programs. It has Add area, edit, and delete while
  empty.
- **Filters:** area, then All / Listed / Unlisted / No card / Sandboxed.
  Search by title or slug.
- **Program tiles:** preview image or a plain placeholder, title,
  `/<area>/<slug>/` in mono, Listed/Unlisted, and a "Sandboxed" badge.
- **Detail panel**, filled by selecting a program:
  - the card fields, saved on change like media alt text;
  - **Sandbox:** "Area default (off)", "On" or "Off", with one line on
    what each means, e.g. "On: the program can't use the site's storage
    or cookies, and its own saved data won't work";
  - path, with Copy;
  - source folder and **Update from source** (when it came from a
    folder);
  - Used in;
  - **Write a post about it**;
  - Open;
  - View live ↗;
  - **Remove…**.
- Tokens and layout follow `docs/design/README.md`. No mockup exists.
  The builder follows the Media screen's patterns, and design fixes come
  after.

**Write a post about it** creates a draft post through the existing
document API, then opens the editor:
- title: the program's title;
- description: the program's description;
- featured image (`image`): the program's image;
- body: one paragraph, "Try it: <a href="/<area>/<slug>/">title</a>".

Posts link to programs with a plain link (my call). A "program card"
block can come later.

## Security

Programs are arbitrary JavaScript, often written by an agent. These are
the threats and what stops each one.

**1. A program acting on Vanilla Press while you Open it.**
- **Its own origin:** programs run on the program server's origin, not
  the app's.
- **Writes are refused:** VP's existing guard (`src/server/guard.js`)
  already refuses any write whose `Origin` isn't the app's. It also
  refuses bodies that aren't strictly JSON or multipart (415) and
  requests whose `Host` isn't the app's (DNS rebinding).
- **Reads are blocked:** reads get no CORS headers, so a program can't
  read API responses.
- **No GET may change state.** The builder audits every GET route and
  adds a test that walks the route table.
- **Fetch metadata (new):** the app API also refuses any request with
  `Sec-Fetch-Site: cross-site` or `same-site`. A different port on
  127.0.0.1 is same-site, so this closes the gap for GETs and for any
  future route.
- **The app never loads program files into its own pages.** Tiles use
  media library images only.

**2. The program server itself.**
- It binds 127.0.0.1 only and checks `Host`, like the app.
- **Methods:** GET and HEAD only, no API, no directory listings.
- **Paths:**
  - only files under a known site's area/slug folder;
  - path traversal and symlinks refused;
  - dotfiles never served.
- **Headers:**
  - `X-Content-Type-Options: nosniff`;
  - `Referrer-Policy: no-referrer`;
  - `Cross-Origin-Resource-Policy: same-origin`;
  - types from the existing MIME table, `application/octet-stream`
    otherwise.
- **Shared storage:** all non-sandboxed programs share this one origin,
  so they can see each other's `localStorage`. That's accepted for one
  user's own programs. Sandbox a program to isolate it.

**3. A program on the live site.**
- **Without the sandbox**, a program runs at the site's origin. It can:
  - read and write the site's `localStorage` and non-HttpOnly cookies;
  - open and script the site's own pages.

  Today the site is static with no logins, so the risk is small, and
  most of your demos need their storage. So the area default is off.
- **With the sandbox**, the `_headers` rule gives it a unique origin.
- **Revisit before the site gets anything worth stealing**, such as
  logins, comments, or the Social step's accounts. At that point
  programs should move to their own subdomain or domain. This is noted
  as the trigger, not built now.

**4. Importing files.**
- **Files:**
  - Regular files only.
  - Symlinks, device files and paths that escape the folder are
    refused.
  - Names with control characters, or that differ only by case, are
    refused, because macOS folds case.
- **Skipped silently:** `.git/`, `node_modules/` and `.DS_Store`.
- **Dotfiles:** all other dotfiles and dot-folders, such as `.env` and
  `.npmrc`, are **skipped and listed** in the result, so you see what
  was left out.
- **Refused** (the whole copy, with the file named), as likely secrets:
  - names: `*.pem`, `*.key`, `*.p12`, `id_rsa*`;
  - any file containing a `-----BEGIN … PRIVATE KEY-----` block.
- **Upload limits:** enforced while the upload streams (413 at the
  limit), not after buffering. The existing guard rules apply.

**5. Update from source.**
- The source folder may have changed in ways you didn't expect, e.g. an
  agent added files. So Update is two steps:
  1. **Preview** lists the files added, changed and removed, the total
     size, and anything skipped or refused.
  2. **Apply** happens only after you confirm in the page.
- The commit makes it reversible in git.

**6. Cook.**
- Program folders get no processing, so there is no template injection
  through a program's files.
- `_headers` rules are written only for area and slug values that pass
  the slug rules, so no header injection.

## thomasapowell.com (the test site)

- `config/programs.json` with one area, `programs`, sandbox off.
- `src/programs.html` is a "Programs" page that lists cards with
  `data-repeat="programAreas.programs as program"`:
  - image;
  - title linking to `program.url`;
  - date;
  - description;
  - tags.

  It uses the site's layout and VB, with the site's own CSS for the
  cards.
- A "Programs" link in the site's navigation.
- **Two test programs, added through VP**, both copied from
  `~/src/retro-fun/src/demos/`:
  - a simple self-contained one (e.g. `plasma`), sandbox off;
  - one that uses `localStorage` (e.g. `div-vaders`), set to sandbox
    **on**. This proves the header is written. Breaking its storage is
    expected; that is the setting's documented cost.
- **Version bump to the new Cook**, as in the theme step:
  - Until Cook is published, build and test against local Cook
    (`npm link` or a temporary `file:` dependency, not committed).
  - The committed `package.json` names the new version.
  - The user publishes Cook before the site is pushed.
  - Local commits only, pushed with the user's OK.

## Constraints

- No browser `alert`/`confirm`/`prompt`.
- VB tokens only in CSS. Semantic markup, keyboard and screen-reader use
  as in the other screens.
- TDD for server and pure modules. UI gets browser checks with
  time-limited Playwright scripts.
- Never touch `~/src/retro-fun` beyond reading and copying demos out of
  it.
- Pushes and npm publishes only with the user's OK. Cook is published by
  the user.

## Left to the builder

- Grid or list for the program tiles.
- How upload sends relative paths (multipart field names) and the order
  of the upload size checks.
- Whether a stray folder gets a card when it's first selected, or only
  when a field is saved (my lean: when saved).
- The program server's port choice, e.g. the app's port + 1 with the
  same fallback.
- Error wording, following the media screen.
