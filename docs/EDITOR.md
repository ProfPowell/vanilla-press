# Editor

The Vanilla Press editor is a ProseMirror-based content editor that runs in the browser with no build step. It connects to a Node.js development server that provides both the editor UI and a JSON API backed by the SQLite content store.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Seed the database with sample content
npm run seed

# 3. Start the dev server
npm run dev

# 4. Open the editor
open http://localhost:3007/editor/
```

This is `vp serve` mode. The settings panel's document browser (at its bottom) lists all seeded documents; click one to load it into the editor.

## The screens

`vp` opens the **Sites** screen. Choosing a site opens its page, `site.html?site=<id>&section=<posts|media|components|theme>`: a rail on the left (stacked above the content on a phone) and one section at a time. **Posts** lists the site's posts and has New post and Preview site; **Components** turns packages on; **Theme** picks the site's theme (the editor uses it for that site); **Media** is a placeholder. The rail also has "All sites", "View live site" and the backup status.

Choosing a post opens the editor at `/editor/?site=<id>#doc-<id>`.

## The editor

### Top bar

- **← Posts** and the site name (the app only), then the save state ("Saved", "Saved · not live yet", "Backed up", ...).
- **Preview** (published posts) starts the site's dev server and opens the post's page in a new tab.
- **Post settings** (the panel icon) shows or hides the settings panel on the right.
- **⋯** (More actions) holds, in order: Export JSON, Show block tree (AST), View live page (when there is one), Delete post... and, in the app for a published post, Unpublish.... Delete is disabled while the post is published ("Unpublish it first"); in the app the server refuses it too (409); the disabled item applies in both modes. Unpublish and Delete ask in an in-page confirmation (Cancel has focus; Escape cancels). Use the arrow keys, Home and End in the menu; Escape closes it.
- **Publish** (a draft) or **Update** (a published post) is the one primary button. The state beside it shows progress ("Publishing...", "Updating...", "Live"). Unpublish never sits next to it.

`vp serve` has the same top bar without "← Posts" and the site name; Publish and Unpublish are the fixture's own actions there, and Unpublish stays in the settings panel (see Post settings).

### Write

The title is the first line of the document, in the serif heading style. It cannot be moved, and Backspace, Delete, cut, paste and drop at its edge never pull body text into it.

- **Empty titles:** a new post starts with an empty title and the slug `untitled-<stamp>`. A draft may be saved untitled (lists show "Untitled"); Publish and Update refuse a post with no title ("Give the post a title before publishing.").
- **Slug:** the URL follows the title while the post is not published and the slug has not been hand-edited (a slug that differs from the slugified title counts as hand-edited, also after a reload). A published post keeps its URL when retitled. A post that is unpublished follows its title again.
- **Blocks:** type `/` on an empty line (the placeholder says "Type / for blocks") to open the block palette. In the gutter of the hovered block (or the block with the cursor) a **+** button opens the same palette and a **drag handle** moves the block.
- **Move by keyboard:** `Alt+Shift+↑` / `Alt+Shift+↓` move the block with the cursor. List items, tabs and steps move only within their own parent (by drag or by key); nothing moves above the title.
- **Format toolbar:** select text and a toolbar floats over the selection with Bold, Italic, Code, Highlight, Link and a More menu (inline components). `Alt+F10` moves focus into it, the arrow keys move along it and Escape returns to the text with the selection kept. Link opens an inline field in the toolbar (no browser prompt): Enter (or Apply) sets the link, Remove takes it off, and Escape closes the field. `Mod+K` opens the same field.

### Media in a post

- **Palette:** `/` → Image, Audio, Video or PDF (Media group). Each opens the media picker first and inserts only when you choose a file; Cancel inserts nothing. A PDF becomes a `<pdf-viewer>` when the site has that component turned on, otherwise a link to the file with a note saying so.
- **Drop or paste:** drop files onto the page, or paste them, to upload and insert them at the cursor in order. Each file ends inserted or with its own error message. Files over 5 MB get a note; files over 25 MB are refused.
- **Picker:** upload by choosing files or dropping them on the zone, or pick one from the library. Files marked "Missing file" are listed but can't be chosen.
- **Choose…:** a component attribute that holds a media URL (an image or video `src`, a poster and so on) has a **Choose…** button that opens the picker and fills in `/media/<file>`.
- **Featured image:** Post settings has a Featured image field (thumbnail and file name, **Choose…** and **Remove**). It is saved as the post's `image` front matter. Showing it on the page is up to the site's layout.
- **Alt text:** an image with no alt text (never written) is flagged. Every Publish and Update, including the Publish button in `vp serve`'s settings panel, warns when the post has such images and offers to go and fix them; a decorative image (alt written as empty) is fine.
- **Missing files:** in the app, Publish and Update refuse a post that uses a `/media/` file missing from `src/media`. `vp serve` publish is a plain save and does not check.
- Uploaded files are stored in the site's `src/media` (in `vp serve`, the repo's `media/`) and served at `/media/<file>`. The Media screen manages them; see the README.

### Search

1. Type in the search box in the document browser
2. Results update after 300ms — full-text search across titles, descriptions, and content
3. Click a result to load it

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Mod+B` | Bold |
| `Mod+I` | Italic |
| `Mod+K` | Open the toolbar's link field (add, change or remove a link) |
| `Alt+F10` | Move focus into the floating format toolbar |
| `Alt+Shift+↑` / `Alt+Shift+↓` | Move the block (list item, tab or step within its parent) |
| `Mod+Z` | Undo |
| `Mod+Shift+Z` | Redo |
| `/` | Open block palette (on an empty line) |
| `Mod+Shift+8` | Toggle bullet list |
| `Mod+Shift+9` | Toggle ordered list |

### Components

- **Insert:** type `/` in an empty paragraph and choose a block component from the palette (grouped, filterable); it lands as a block. Inline components (like blink-wc) are not in the `/` palette: see Inline wrap.
- **Settings:** with the cursor in a component (or the component selected) the Post settings panel shows its attributes as a form, built from the package's manifest (or the catalog's hint for a package that ships none); rarely used attributes sit under an Advanced heading. Text and code components (marquee-wc, code-block) are edited in the panel's Text or Code box. Block components (browser-window, accordion-wc and the like) hold ordinary blocks: type into them in the page.
- **Inline wrap:** select text in a paragraph and pick a component from the floating toolbar's More menu; the selection is wrapped in it. There is no unwrap yet: to remove an inline component, delete the wrapped text (and type it again if you want it plain). Unwrap is a follow-up.
- **Removed attributes:** when a save drops attributes a component's installed version doesn't have, the save state says so ("Removed "x" from <tag>: ...") and the editor takes them out of its copy, so the settings panel matches the stored post.
- **States:** a component whose package is not turned on for the site shows the label "<name> is not on for this site"; one whose script fails to import shows "<name> couldn't load". The post still saves; Publish and Update refuse a post that uses a package that is not on, or one that won't load on the live site (a package whose npm tarball has no custom-elements.json, such as marquee-wc and border-wc today: the Components screen says so). Turn packages on from the site's Components screen.
- **Gallery:** `/editor/components-gallery.html` on `vp serve` shows every element with a theme switcher.

### Post settings

The panel on the right holds the post's Status (in the app it is shown, not edited: Publish and Unpublish change it; in `vp serve` it is an editable select), URL (slug), Description, Tags, Collection and Appearance, plus the settings of the selected component. "Show block tree" in the "⋯" menu swaps the panel for the live Vanilla Press block AST (useful for checking the round trip between ProseMirror and the content model); "Back to settings" returns. In `vp serve` the document browser and the theme picker sit at the bottom of the panel.

### Export

"Export JSON" in the "⋯" menu downloads the current document as a `.json` file in the Vanilla Press document format.

## Architecture

```
Browser                          Server (node src/server/index.js)
┌──────────────────────┐         ┌──────────────────────────────┐
│  editor/index.html   │         │  src/server/index.js         │
│  ├── ProseMirror     │  HTTP   │  ├── Static: /editor/        │
│  ├── api-client.js ──┼────────>│  ├── Static: /src/           │
│  ├── doc-browser.js  │  JSON   │  ├── Static: /media/         │
│  ├── meta-panel.js   │<────────│  ├── API:    /api/*          │
│  └── media-picker.js │         │  │   └── src/server/api.js   │
└──────────────────────┘         │  └── src/store/content.js    │
                                 │      └── content.db (SQLite) │
                                 └──────────────────────────────┘
```

### Server

The dev server (`src/server/index.js`) is a plain `node:http` server — no frameworks. It handles:

- **Static files**: Serves `editor/`, `src/`, `media/`, and `test/` directories
- **API routes**: JSON endpoints for document CRUD, collections, search, media upload, and publish
- **No CORS**: Editor and API are on the same origin

Start with `npm run dev` or `node src/server/index.js --port 3007`.

### API

All endpoints return JSON. Errors return `{ error: "message" }`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/documents` | List documents (query: `collection`, `status`) |
| `GET` | `/api/documents/:id` | Get one document |
| `POST` | `/api/documents` | Create document |
| `PUT` | `/api/documents/:id` | Update document |
| `DELETE` | `/api/documents/:id` | Delete document |
| `GET` | `/api/collections` | List collection names |
| `GET` | `/api/search?q=` | Full-text search |
| `POST` | `/api/media` | Upload file (multipart/form-data) |
| `GET` | `/api/media` | List uploaded media |
| `POST` | `/api/sync` | Sync every document to the Cook site (`{ ok, synced, conflicts }`) |
| `POST` | `/api/documents/:id/reload` | Replace the stored document with its JSON on disk (after a conflict) |
| `GET` | `/api/workspace` | Which site is being edited (`{ site, syncEnabled }`) |

### App routes

`vp` starts the app server (`src/app/server.js`), which serves many Cook sites. Everything above is per site, under `/api/sites/<id>` (for example `GET /api/sites/<id>/documents`). Unknown site ids are 404. The server listens on `127.0.0.1` only and rejects other `Host` headers and cross-origin writes.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sites` | Registered sites, each with `git: { connected, branch }` |
| `POST` | `/api/sites` | Register a site (`{ path, name }`); the folder must depend on `cook-ssg` |
| `POST` | `/api/sites/clone` | Clone a repo (`{ url, dest, name }`) and register it |
| `DELETE` | `/api/sites/:id` | Unregister a site: pending saves are pushed first (after any running publish); files are left alone |
| `GET` | `/api/folders` | List folders for the picker (query: `path`) |
| `POST` | `/api/sites/:id/preview` | Start the site's dev server; `{ url }` |
| `GET` | `/api/sites/:id/info` | `{ siteUrl }` from the site's `config/data.js` |
| `POST` | `/api/sites/:id/documents/:docId/publish` | Build check, commit, push; `{ status: 'pushed'\|'saved', url }`. 422 with `log` if the build fails; 409 with `files` on a rebase conflict |
| `POST` | `/api/sites/:id/documents/:docId/update` | Same as publish, for an already-published post: its saved edits go live (`Update: <title>`); 422 for a draft. Publish on a published post is an Update too |
| `POST` | `/api/sites/:id/documents/:docId/unpublish` | Same, back to draft |
| `GET` | `/api/sites/:id/documents/:docId/state` | `{ notLive }`: a published post has saved edits that are not live yet (its page differs from HEAD) |
| `GET` | `/api/sites/:id/documents/:docId/live` | `{ live, url }`: whether the deployed page matches the page the last publish/update built |
| `GET` | `/api/sites/:id/status` | Draft backup state: `{ pending, lastPushAt, error, connected, lastPushKind }`; `lastPushKind` is `draft` (backups only: they never change the live site) or `publish` (a publish, update or unpublish) |
| `POST` | `/api/sites/:id/backup` | Commit and push pending saves now |
| `GET` | `/sites/:id/media/:file` | A site's uploaded file (`src/media`) |

### Editor files

The editor lives in `editor/` and is served as static files. No build step — ProseMirror is loaded via import maps from esm.sh. Key files:

| File | Purpose |
|------|---------|
| `editor.js` | Main entry: PM setup, auto-save, document load/save |
| `api-client.js` | Fetch wrapper for the content API |
| `schema.js` | ProseMirror schema (maps to content-schema.js block types) |
| `ast.js` | Bidirectional converter: PM doc ↔ VP block AST |
| `components/doc-browser.js` | Document list with filters and search |
| `components/meta-panel.js` | Post settings form (status, URL, description, tags, collection, appearance) |
| `components/more-menu.js` | The top bar's "⋯" menu |
| `components/confirm-panel.js` | In-page confirmation (Unpublish, Delete) |
| `components/theme-picker.js` | Theme picker (`vp serve` panel; the Theme section in the app) |
| `site-mode.js`, `site-context.js` | Top bar wiring and its pure helpers (menu items, save pill, actions) |
| `title.js`, `slug.js` | Title-in-document rules and slug following |
| `format-toolbar.js`, `menu.js` | Floating format toolbar and its commands |
| `block-handles.js` | Gutter + and drag handles, Alt+Shift+↑/↓ block move, block placeholder |
| `components/media-picker.js` | Media upload and selection modal |
| `components/block-palette.js` | Slash command block insertion menu |
| `components/ast-inspector.js` | Live AST debug panel |
| `blocks/*.js` | 7 custom NodeViews for component blocks |

### Persistence

- Documents auto-save to the API 500ms after each edit
- The URL hash (`#doc-{id}`) tracks the current document
- Refreshing the page restores the last document from the hash
- Every save syncs the document into the Cook site (publishing adds its HTML page, unpublishing removes it); Cook builds the site

## CLI

`vp` starts the multi-site app (see App routes). The `vp serve` command still starts the single-site editor server:

```bash
vp serve              # Start on default port 3007
vp serve --port 8080  # Custom port
```

## File layout

```
editor/
├── index.html                    # Single-page editor app
├── assets/
│   ├── css/
│   │   ├── editor.css            # Layer hub (imports VB + editor CSS)
│   │   ├── _shell.css            # CSS grid layout
│   │   ├── _prosemirror.css      # PM editor overrides
│   │   ├── _block-controls.css   # NodeView overlays
│   │   ├── _palette.css          # Block palette popover
│   │   ├── _meta-panel.css       # Post settings panel
│   │   ├── _site-mode.css        # Top bar, ⋯ menu, confirmation
│   │   ├── _format-toolbar.css   # Floating format toolbar
│   │   ├── _block-handles.css    # Gutter + and drag handles
│   │   ├── _doc-browser.css      # Document browser
│   │   └── _media-picker.css     # Media picker modal
│   └── js/
│       ├── editor.js             # Main init + API integration
│       ├── api-client.js         # Content API fetch wrapper
│       ├── schema.js             # ProseMirror schema
│       ├── ast.js                # PM ↔ block AST converter
│       ├── keymap.js             # Keyboard shortcuts
│       ├── menu.js               # Format commands (used by the floating toolbar)
│       ├── format-toolbar.js     # Floating format toolbar
│       ├── input-rules.js        # Markdown-style input rules
│       ├── meta-state.js         # Shared metadata state
│       ├── blocks/               # 7 NodeViews (code, callout, etc.)
│       └── components/           # UI components (shell, browser, etc.)

src/server/
├── index.js                      # HTTP server + static file serving
├── router.js                     # URL routing + body parsing
└── api.js                        # API route handlers
```
