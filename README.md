# Vanilla Press

A local blog editor for [Cook](https://github.com/ProfPowell/cook) sites. Write posts in the browser; Publish checks the build, commits and pushes to GitHub, and Cloudflare deploys from there.

## Start

```bash
npm install
vp            # or: npx vp
```

`vp` (same as `vp app`) starts the app at `http://127.0.0.1:3007`, opens it in your browser, and shows your sites. Add a site by choosing a folder (its `package.json` must depend on `cook-ssg`) or by cloning a GitHub repo. `VP_NO_OPEN=1` skips opening the browser; `--port <n>` picks the port.

Open a site, pick or create a post, and edit. Saves are backed up to GitHub about 30 seconds after you stop typing. Backups carry `[CI Skip]` and never include a page, so **a backup never changes the live site**. **Publish** runs the site's `npm run build`, then commits and pushes the page.

**Edits to a published post go live only when you click Update.** Until then they are saved and backed up to GitHub (the editor says "Saved · not live yet", then "Backed up · not live yet"), and the live site keeps the version you last published. **Update** runs the same build check as Publish, commits that post's page (and nothing of any other post's), and pushes; the editor says "Updating…" and then "Live" (or "Still deploying, check Cloudflare"). **Unpublish** takes the page down. **Preview** opens the site's dev server, which builds from your working copy, so it shows a published post's edits before you Update; Preview shows published pages only, so publish a post first to preview it.

On a second computer, opening a site pulls (fast-forward only) before loading its posts, as long as you have no uncommitted changes in the files VP owns; a backup or publish that had to rebase onto another machine's commits reloads the posts too.

The list of sites is kept in `~/.config/vanilla-press/sites.json` (set `VP_CONFIG_DIR` to move it).

`vp serve --site <path>` still starts the single-site editor server. Like the app, it now listens on `127.0.0.1` only, so it is not reachable from other machines on your network. See `CLAUDE.md` for how VP works with a Cook site and `docs/EDITOR.md` for the editor and API.

## Tests

```bash
npm test
```
