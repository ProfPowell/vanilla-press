# Vanilla Press as a self-contained blogging app: step 1, the core app

Date: 2026-11-02 · Status: draft for approval

## Intent

Vanilla Press (VP) should work like a self-contained blogging system in the
spirit of Ghost: you start `vp`, pick a site, write, and click Publish, and the
post is live. It is built on the user's own platform-first stack: Vanilla
Breeze (VB) for components and themes, Cook for the static build, GitHub for
history, and Cloudflare Pages for hosting. You should never need a terminal,
a second server, or a manual git command to blog.

Why now: the first real attempt to write a post on thomasapowell.com showed
the current tool is too fiddly. It needed a CLI with `--site`, a separate
`cook dev` for preview, and a manual commit and push to go live. Worse, the
editor silently failed to save the page it opened on (since fixed).

## The roadmap (the user's order)

Each step is its own design and plan. This document designs **step 1 only**;
the others are listed so step 1 leaves room for them.

1. **Core app for an existing site:** sites list, posts, editor, automatic
   preview, Publish to live. *(this document)*
2. **Media management:** a real Media section for uploading, browsing and
   reusing images.
3. **Theme and feature settings:**
   - VB themes as the base set.
   - Make your own theme from VB's design settings (colors, type, spacing).
   - Per-post or per-page overrides, up to a post with its own theme.
   - Turn site features on and off.
4. **New site from a domain:** VP creates the GitHub repo, the Cook site
   and the Cloudflare Pages project, and connects the domain.
5. **Programs** (for cyberviber.ninja):
   - A program is a folder of hand-written HTML, CSS and JS, written by the
     user or an agent.
   - VP never edits a program. It finds it, lets you categorize it, and
     lists it on the site.
6. **Analytics:** a placeholder first, real numbers later.
7. **Social and comments:**
   - RSS first; an Atom feed already exists.
   - Then ATProto. My guess at the shape: announce a post on Bluesky and
     show the replies as comments.
   - ActivityPub maybe later.

## Goals for step 1

- `vp` with no arguments starts the app and opens the browser on the
  **Sites** screen.
- **Adding a site** works two ways:
  - choose an existing Cook site folder (thomasapowell.com at
    `~/src/thomasapowell.com` is the first);
  - give a GitHub repo and a folder to clone it into.

  Sites live wherever the user chooses. VP keeps only the list of sites, in
  its own settings on the machine.
- **A site screen** opens to its **Posts** list: drafts and published, newest
  first, with **New post**. These sections show as labeled placeholders until
  their steps are built: Media, Theme, Programs, Analytics, Social.
- **A distraction-free editor:**
  - title, writing area, and a post-settings panel that can be hidden;
  - the panel holds slug, description, tags, date and status;
  - developer extras (block inspector, Export JSON) are out of the way, not
    on the main screen;
  - every page you can type into is a real, saved post.
- **Drafts are backed up to GitHub as you go:**
  - VP commits and pushes a draft after a pause in typing, not on every save;
  - a draft makes no page on the live site.
- **Preview just works:**
  - VP starts the site's Cook dev server itself, on a free port, the first
    time preview is needed;
  - it opens the post in a new tab;
  - VP stops the server when it quits.
- **Publish takes a post all the way live:**
  1. Save the post.
  2. Run a Cook build as a check; on failure, stop and show the build's
     error.
  3. Commit and push to GitHub.
  4. Cloudflare Pages builds and deploys from GitHub.
  5. Show the post as live, with its link.

  Unpublish is the same path in reverse: the page is removed and the change
  is pushed.
- **Status the user can trust:**
  - every save, push and deploy has a visible state (saved, backed up,
    publishing, live, failed);
  - failures say what happened and what to do;
  - a push that fails is retried on the next save or publish.

## Non-goals for step 1

- Creating sites, GitHub repos or Cloudflare projects (step 4).
- Media management beyond what exists today (step 2).
- Theme editing (step 3).
- Programs (step 5), analytics (step 6), social (step 7).
- Multiple users, accounts, or login. VP is a single-user app on the user's
  Mac.
- A hosted or cloud version of VP.
- Deploying to Cloudflare directly. Deploys go through GitHub; Cloudflare's
  git integration does the build.

## Anti-goals

- Making the user open a terminal, run a second server, or touch git to
  write, preview or publish.
- Saving or publishing silently failing, or a status that says "saved" or
  "live" when it isn't.
- A cluttered writing screen. Developer tools must not crowd the editor.
- Locking content into VP. The site's files in git (JSON in `content/`,
  HTML in `src/`) stay the source of truth, readable without VP.
- Blocking later steps. Posts must be able to carry a theme or style
  override for step 3. Sites must be able to have more than posts, for
  programs in step 5.

## Constraints and what already exists

- VP is Node, with no front-end framework.
  - The server is `node:http` (`src/server/`). The editor is plain web
    components and ProseMirror (`editor/`).
  - VP stores content in SQLite (better-sqlite3), one store per site at
    `<site>/.vp/content.db`.
  - Sync code (`src/sync/`) writes each post's JSON to `content/` and, when
    published, a front-matter HTML page to `src/<collection>/`. This already
    has conflict detection for edits made on disk or pulled from another
    machine.

  Step 1 builds on all of this. It does not replace the sync model.
- The sync vocabulary in CLAUDE.md stays:
  - **sync:** VP writes files into the site;
  - **publish:** a post's status;
  - **build:** Cook;
  - **deploy:** hosting.
- A site is a Cook project (cook-ssg ^2.4.0) using
  `collections: { html: true }`, with VB from npm. thomasapowell.com is the
  reference site.
- Git operations use the user's existing git and GitHub credentials on the
  machine. Cloudflare needs no token in step 1, because it deploys from
  GitHub.
- Cloudflare's free plan limits builds per month, so draft pushes are
  batched.
- The app is a local web app. It listens on localhost only, and nothing is
  reachable from other machines.
- The existing CLI commands (`vp sync`, `vp new` and the rest) keep
  working. `vp` with no command, or `vp app`, starts the app.

## Decided by the user

- Publish means **live**: build with Cook, deploy to Cloudflare, automatically.
- Content stays in **git**, pushed to GitHub automatically.
- **Drafts are backed up to GitHub as you go.**
- Sites live **wherever the user chooses** (like `~/src`). VP does not own
  a sites folder.
- Order of the roadmap: 1, media, themes and features, new site, programs,
  analytics, social.
- Programs are hand-written folders VP leaves alone and only categorizes
  (step 5).
- Themes come from VB, with custom themes and per-post overrides (step 3).
- Writing should be clean and distraction-free, in a simple, clean layout.

## My calls (the user can override)

- `vp` stays a local web app opening the browser, not a desktop app.
- Draft pushes are batched (after a pause in typing, and at most every
  couple of minutes).
- How VP knows a deploy is live: it checks the post's live URL until it
  answers with the new page, and gives up after a few minutes with a
  "still deploying, check Cloudflare" message. Cloudflare's API would be
  more exact, but needs a token, and that belongs with step 4.
- The machine-local list of sites lives in VP's own settings folder, e.g.
  `~/.config/vanilla-press/sites.json`. Each site's store stays in its
  `.vp/`.
- Commit messages are generated, e.g. "Publish: Do It Yourself Blogging" or
  "Draft: Do It Yourself Blogging".
- Placeholder sections are visible but say "coming soon". They are not
  hidden.

### Settled after the builder check

- **One app, many sites.**
  - One VP process serves every site in the list. Each site has its own
    workspace (folder, `.vp/` store, manifest), keyed by a site id, and the
    API is addressed per site.
  - Today's one-site-per-process workspace (`--site`) becomes "a workspace
    per site, opened on demand". Several site stores can be open at once.
  - `vp serve --site` keeps working as a single-site shortcut.
- **The site's files win.**
  - Opening a site runs the existing sync from the site (`syncFromSite`),
    so a fresh clone or a pull from another machine fills the store from
    `content/*.json`.
  - Conflicts behave as they do today: a "changed on disk" notice, then
    "Load the version on disk".
  - A draft has its JSON in `content/` and no HTML page.
- **Git rules:**
  - VP stages only the files it owns: post JSON in `content/`, synced pages
    in the collection folders, and `content/media.json` and
    `config/vp.json`. The user's own uncommitted changes are never
    committed by VP.
  - VP pushes to the branch the folder is on, normally the repo's default
    branch, which Cloudflare deploys.
  - If a push is rejected because the remote moved, VP runs
    `git pull --rebase` and pushes again. If the rebase conflicts, VP
    aborts it, leaves the repo as it was, and shows "Couldn't push:
    GitHub has changes that conflict with yours" with the file names.
  - A folder with no remote or no upstream branch shows "Not connected to
    GitHub" on the site and skips pushing. Saving still works.
- **Draft pushes don't use up Cloudflare builds.** A commit that only
  changes drafts carries Cloudflare Pages' skip marker (`[CI Skip]`) in its
  message, so Cloudflare doesn't build it. Publish and Unpublish commits
  never skip.
- **Builds use the site's own script.**
  - Publish runs `npm run build`, so the site's pre-build steps run (like
    copying Vanilla Breeze), the same as on Cloudflare.
  - Preview runs `npm run dev` with a free port passed in.
  - VP runs `npm install` first if `node_modules` is missing, for example
    after a fresh clone.
- **Live check.**
  - The live URL comes from `siteUrl` in the site's `config/data.js`.
  - After Publish, VP checks the post's page on the live site until it
    shows the version just published (its title and updated date). It
    gives up after about five minutes with "Still deploying, check
    Cloudflare".
  - A site with no `siteUrl` shows "Pushed" instead of "Live".
- **What counts as a site.** A folder whose `package.json` depends on
  `cook-ssg`. Adding one creates `.vp/` if it is missing; VP already
  git-ignores it.
- **Adding a site.**
  - You type or paste a path. The server lists folders so you can browse
    to one, since a web page can't open the Mac's folder dialog.
  - Cloning runs `git clone` with prompts turned off
    (`GIT_TERMINAL_PROMPT=0`), so a missing credential fails with a
    message instead of hanging.
- **Unpublish** keeps the post as a draft: its page is removed, the JSON
  stays. Unpublish runs the same build check and push as Publish.
- **Port.** The app uses port 3007, or the next free port if 3007 is
  taken.

## Left to the builder

- Screen layout and visual design, within "simple, clean, distraction-free"
  and using VB.
- How the sites list, site screen and editor are routed in the browser.
- How the Cook dev server and build are started: child process, port
  choice, logs.
- Exact pause and interval for draft pushes.
- How the existing editor components are reorganized. Keep what works; the
  editor engine stays.
- Error wording, as long as each failure says what happened and what to do.
