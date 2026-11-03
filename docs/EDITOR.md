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

The editor opens with the document browser in the sidebar showing all seeded documents. Click any document to load it into the editor.

## Demo Walkthrough

### Browse and edit documents

1. Start the server with `npm run dev`
2. The sidebar shows all documents grouped by collection (posts, pages, docs, tests)
3. Use the **collection dropdown** to filter by collection
4. Use the **status tabs** (All / Draft / Published) to filter by status
5. Click a document to load it — the editor pane shows the content, the meta panel shows title/slug/status/tags
6. Edit the content — changes auto-save after 500ms (watch the "Saving..." indicator in the toolbar)

### Create a new document

1. Click **+ New Document** in the document browser
2. A new draft document is created in the current collection
3. Set the title in the meta panel — the slug auto-derives from the title
4. Add content using the formatting toolbar or type `/` in an empty paragraph to open the **block palette**
5. The block palette lets you insert any block type: headings, code blocks, callouts, figures, tabs, steps, etc.

### Publish a document

1. Load a document and edit it as needed
2. In the meta panel at the bottom of the sidebar, click **Publish**
3. The editor sets the status to `published`, saves, and triggers a full site build
4. The build status shows "Building..." then "Build complete"
5. Click **Preview** to open the published page in a new tab
6. To revert, click **Unpublish** — the status returns to `draft` and the site rebuilds

### Upload and insert media

1. Insert a figure block (type `/` → select "Figure", or use the block palette)
2. In the figure controls, click **Browse** to open the media picker
3. Upload an image by clicking the upload zone or dragging a file onto it
4. Or click an existing image in the media grid to select it
5. The image appears in the figure block with the correct `src` path
6. Media files are stored in the `media/` directory and served at `/media/`

### Search

1. Type in the search box in the document browser
2. Results update after 300ms — full-text search across titles, descriptions, and content
3. Click a result to load it

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Mod+B` | Bold |
| `Mod+I` | Italic |
| `Mod+K` | Insert/remove link |
| `Mod+Z` | Undo |
| `Mod+Shift+Z` | Redo |
| `/` | Open block palette (in empty paragraph) |
| `Mod+Shift+8` | Toggle bullet list |
| `Mod+Shift+9` | Toggle ordered list |

### Components

- **Insert:** type `/` in an empty paragraph and choose a component from the palette (grouped, filterable). Block components land as a block; an inline one (like blink-wc) lands in the paragraph.
- **Settings:** with the cursor in a component (or the component selected) a settings panel shows its attributes as a form, built from the package's manifest; rarely used attributes sit under an advanced heading. Text, code and block content is edited in the page itself.
- **Inline wrap:** select text and use the component select in the toolbar to wrap it in an inline component; the same select unwraps it.
- **States:** a component whose package is not turned on for the site shows the label "<name> is not on for this site"; one whose script fails to import shows "<name> couldn't load". The post still saves; Publish and Update refuse a post that uses a package that is not on. Turn packages on from the site's Components screen.
- **Gallery:** `/editor/components-gallery.html` on `vp serve` shows every element with a theme switcher.

### AST inspector

Click the **AST** button in the toolbar to toggle the debug inspector. It shows the live Vanilla Press block AST as the document is edited — useful for verifying the round-trip between ProseMirror and the content model.

### Export

Click **Export** in the toolbar to download the current document as a `.json` file in the Vanilla Press document format.

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
| `components/meta-panel.js` | Metadata form + publish/unpublish |
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
│   │   ├── _meta-panel.css       # Meta sidebar + publish buttons
│   │   ├── _doc-browser.css      # Document browser
│   │   └── _media-picker.css     # Media picker modal
│   └── js/
│       ├── editor.js             # Main init + API integration
│       ├── api-client.js         # Content API fetch wrapper
│       ├── schema.js             # ProseMirror schema
│       ├── ast.js                # PM ↔ block AST converter
│       ├── keymap.js             # Keyboard shortcuts
│       ├── menu.js               # Formatting toolbar
│       ├── input-rules.js        # Markdown-style input rules
│       ├── meta-state.js         # Shared metadata state
│       ├── blocks/               # 7 NodeViews (code, callout, etc.)
│       └── components/           # UI components (shell, browser, etc.)

src/server/
├── index.js                      # HTTP server + static file serving
├── router.js                     # URL routing + body parsing
└── api.js                        # API route handlers
```
