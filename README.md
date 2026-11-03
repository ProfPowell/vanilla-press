# Vanilla Press

A local blog editor for [Cook](https://github.com/ProfPowell/cook) sites. Write posts in the browser; Publish checks the build, commits and pushes to GitHub, and Cloudflare deploys from there.

## Start

```bash
npm install
vp            # or: npx vp
```

`vp` (same as `vp app`) starts the app at `http://127.0.0.1:3007`, opens it in your browser, and shows your sites. Add a site by choosing a folder (its `package.json` must depend on `cook-ssg`) or by cloning a GitHub repo. `VP_NO_OPEN=1` skips opening the browser; `--port <n>` picks the port.

Open a site, pick or create a post, and edit. Saves are backed up to GitHub about 30 seconds after you stop typing (drafts carry `[CI Skip]`, so they do not trigger a Cloudflare build). **Publish** runs the site's `npm run build`, then commits and pushes the page.

**Edits to a published post go live automatically.** Its page is rewritten on every save, so the backup after the pause is an `Update:` commit that Cloudflare deploys; the editor says "Updating live site…" and then "Live" (or "Still deploying, check Cloudflare"). There is no separate step to hold an edit back. **Preview** shows published pages only: publish a post first to preview it.

On a second computer, opening a site pulls (fast-forward only) before loading its posts, as long as you have no uncommitted changes in the files VP owns; a backup or publish that had to rebase onto another machine's commits reloads the posts too.

The list of sites is kept in `~/.config/vanilla-press/sites.json` (set `VP_CONFIG_DIR` to move it).

`vp serve --site <path>` still starts the single-site editor server. Like the app, it now listens on `127.0.0.1` only, so it is not reachable from other machines on your network. See `CLAUDE.md` for how VP works with a Cook site and `docs/EDITOR.md` for the editor and API.

## Tests

```bash
npm test
```
