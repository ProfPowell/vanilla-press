# Vanilla Press

A local blog editor for [Cook](https://github.com/ProfPowell/cook) sites. Write posts in the browser; Publish checks the build, commits and pushes to GitHub, and Cloudflare deploys from there.

## Start

```bash
npm install
vp            # or: npx vp
```

`vp` (same as `vp app`) starts the app at `http://127.0.0.1:3007`, opens it in your browser, and shows your sites. Add a site by choosing a folder (its `package.json` must depend on `cook-ssg`) or by cloning a GitHub repo. `VP_NO_OPEN=1` skips opening the browser; `--port <n>` picks the port.

The Sites screen lists your sites; opening one shows its page with a rail on the left (Posts, Media, Programs, Components, Theme, at `site.html?site=<id>&section=<name>`). Pick or create a post on the Posts screen and edit: the title is the first line of the page, `/` or the gutter **+** inserts blocks, selecting text brings up the format toolbar (`Alt+F10` moves into it, `Mod+K` links), `Alt+Shift+↑/↓` moves a block, and the top bar's "⋯" menu holds Export, the block tree, View live page, Delete and Unpublish. The editor's shortcuts are listed in `docs/EDITOR.md`.

Saves happen as you type, and are backed up to GitHub about 30 seconds after you stop typing. Backups carry `[CI Skip]` and never include a page, so **a backup never changes the live site**. **Publish** runs the site's `npm run build`, then commits and pushes the page.

**Edits to a published post go live only when you click Update.** Until then they are saved and backed up to GitHub (the editor says "Saved · not live yet", then "Backed up · not live yet"), and the live site keeps the version you last published. **Update** runs the same build check as Publish, commits that post's page (and nothing of any other post's), and pushes; the editor says "Updating…" and then "Live" (or "Still deploying, check Cloudflare"). **Unpublish** takes the page down. **Preview** opens the site's dev server, which builds from your working copy, so it shows a published post's edits before you Update; Preview shows published pages only, so publish a post first to preview it.

On a second computer, opening a site pulls (fast-forward only) before loading its posts, as long as you have no uncommitted changes in the files VP owns; a backup or publish that had to rebase onto another machine's commits reloads the posts too.

The list of sites is kept in `~/.config/vanilla-press/sites.json` (set `VP_CONFIG_DIR` to move it).

`vp serve --site <path>` still starts the single-site editor server. Like the app, it now listens on `127.0.0.1` only, so it is not reachable from other machines on your network. See `CLAUDE.md` for how VP works with a Cook site and `docs/EDITOR.md` for the editor and API.

## Media

The **Media** screen of a site lists the files in its `src/media`: filter All / Needs alt text / Unused / Missing file, filter by type, search by name or alt text. Upload with the button, or drop or paste files anywhere on the screen. Selecting a tile opens the detail panel: preview, alt text (with a "Decorative" checkbox for `alt=""`), URL, "Used in" and Delete. Images also have **Edit image**.

- **Accepted types:** JPEG, PNG, WebP, AVIF, GIF, SVG, MP4 (.mp4, .m4v), WebM, MP3, M4A, AAC, Ogg (.ogg, .oga, .opus), WAV and PDF. The file's content is checked, not just its name.
- **Limits:** a file over 25 MB is refused (Cloudflare Pages won't serve it). A file over 5 MB is accepted with a note, because everything is committed to git and the repository grows by its size.
- **Names:** stored as `<slug>-<6-char id>.<ext>` (for example `garden-path-3f9a2c.jpg`) and never renamed. The original name is kept as the label.
- **Edits make copies:** Edit image saves a new file named `<name>-edited-<id>.<ext>`; the original stays, so a published post never changes under its readers. An edited copy keeps the source's alt text.
- **Delete:** a file the live site uses can't be deleted: one used by a published post, or shown by any page committed in the site's git. The refusal names the posts and pages; remove the file there and Update (or commit the page) first. A file used only by drafts is deleted after a confirmation that names them; they then show it as missing. "Used in" lists every use, a live version of an edited post as "Published (live version)". A file gone from `src/media` shows **Missing file**; it can be removed from the library, and Publish refuses a post that uses it.
- **Featured image:** chosen in Post settings and saved as `image` in the post's front matter. Showing it (and `og:image`) is the site layout's job.
- **In git:** `content/media.json` (names, alt text, original names) and `src/media` are committed with your draft backups. Files that appear in `src/media` without an entry (copied in by hand, or pulled from another machine) are adopted into the library; entries whose file is missing are flagged.

## Programs

The **Programs** screen of a site manages hand-written programs (demos, games, small tools): each is a folder at `src/<area>/<slug>/` with an `index.html`, which Cook copies to the live site untouched, at `/<area>/<slug>/`. Cards (title, description, date, tags, preview image, listed, sandbox) live in `config/programs.json`.

- **Areas:** programs live in an area (`/demos/`, `/programs/`). The Areas panel lists them with their sandbox default and number of programs: add an area, edit its title and default, and change its path or delete it while it is empty (nothing in `src/<area>/` but `.DS_Store`).
- **Add the area first, then its list page:** VP refuses an area whose name is already a page, so create the area (say `programs`) on this screen before you add its list page `src/programs.html` (the page that lists its cards with `data-repeat="programAreas.programs as program"`).
- **Add program:** choose the area, then a folder on this computer (with the folder browser; VP remembers it for Update from source) or a folder to upload (pick it, or drop it on the panel), and the slug. Copying is all or nothing; a program over 50 MB, 2,000 files or 25 MB a file is refused, as are folders with likely secrets. A new program starts **Unlisted**: live at its address, in no list.
- **Filters:** area, then All / Listed / Unlisted / No card / Sandboxed; search by title or slug. A folder put there by hand shows up with **No card**; it gets one when you save a field.
- **Detail panel:** the card fields (saved on change), **Sandbox** (Area default, On, Off), the path with Copy, the source folder with **Update from source** (shows what would change, then Apply), Used in, **Write a post about it** (a draft linking to the program, with its title, description and image), **Open** (runs it in the page from VP's program server, sandboxed exactly as the live site will be), View live and **Remove…** (refused while a post or page links to it, naming them).
- **Goes live at once:** every change on this screen is one commit, pushed straight away (no `[CI Skip]`), so the site rebuilds. Without a repo, or when the push fails, the change stays on this computer and the screen says so; a commit whose push failed shows as pending in the backup status and goes with the next backup.
- **Checked before every commit:** the commit takes every new or changed folder in the areas live, including ones put there by hand, so VP first checks them with the import rules. A likely secret (`*.pem`, `id_rsa`, a private key block), a symlink, a dotfile other than `.DS_Store`, a file over the limits or names that differ only by case refuses the change with the file named: nothing is committed, and the files and your change stay on this computer until you remove or fix that file.

## Components in the app

Posts can hold web components (a browser window around a screenshot, a code block, a marquee, and so on). Type `/` in the editor and pick one from the palette; select it to change its attributes in the settings panel. Each site chooses which component packages it uses on its Components screen: turning one on runs `npm install` for it in the site, so the dependency lands in the site's `package.json`, and Cook (2.5+) then loads that package's script on the pages that use it. Vanilla Breeze's own elements need no package. A draft can hold any component, but Publish and Update refuse a post that uses a package the site has not turned on.

## Tests

```bash
npm test
```
