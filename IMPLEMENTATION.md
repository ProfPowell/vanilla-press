# Implementation Plan

Phased delivery plan for Vanilla Press. Each phase produces a working, deployable artifact. No phase depends on a future phase being completed.

---

## Phase 1: Content Schema + Renderers

**Goal:** Define the block type schema and build the HTML and markdown renderers. Validate with hand-written test fixtures. This is the foundation — everything else consumes these modules.

**Deliverables:**
- `src/schema/content-schema.js` — block type registry (the single source of truth)
- `src/schema/validate.js` — validates a document against the schema
- `src/renderers/html.js` — HTML renderer with all scopes (page, content, block, collection, meta)
- `src/renderers/markdown.js` — markdown renderer (content scope with frontmatter)
- `src/renderers/shared.js` — escape utilities, date formatting
- `test/fixtures/` — hand-written JSON documents covering every block type
- `test/` — tests for schema validation, HTML output, markdown output

### Tasks

**1.1 Content schema definition**
- Define `blockTypes` and `inlineTypes` in `content-schema.js`
- Include: paragraph, heading, blockquote, list, list_item, hr, figure, figcaption, embed, code_block, callout, collapsible, card, tabs, tab, steps, step
- Include inline types: text (with marks), link, footnote_ref
- Export `blockTypes`, `inlineTypes`, and a `categories` grouping

**1.2 Schema validator**
- `validate(doc)` → returns `{ valid: boolean, errors: string[] }`
- Validates meta required fields (title, slug, collection, status)
- Validates block types exist in schema
- Validates required attrs are present
- Validates children match expected content model (inline vs block)
- Validates marks are from the allowed set

**1.3 Test fixtures**
- `test/fixtures/simple-post.json` — paragraph, heading, list, code block, image
- `test/fixtures/component-rich.json` — callout, collapsible, tabs, steps, card
- `test/fixtures/inline-marks.json` — all mark combinations, links, footnotes
- `test/fixtures/edge-cases.json` — empty paragraphs, nested lists, code with special chars
- `test/fixtures/minimal.json` — smallest valid document (one paragraph)

**1.4 HTML renderer — inline and block rendering**
- `renderInline(children, ctx)` — text with marks, links
- `blockRenderers` object with one function per block type
- `renderBlocks(blocks, ctx)` — walks array, dispatches to block renderers
- Escaping: all text values escaped for HTML, attrs escaped for attribute context

**1.5 HTML renderer — scope functions**
- `render(doc, { scope: 'content' })` → `<article data-doc="...">` body
- `render(doc, { scope: 'block' })` → single rendered block (doc is one block)
- `render(docs, { scope: 'collection' })` → list of article cards with title, excerpt, date
- `render(doc, { scope: 'meta' })` → metadata header with title, description, tags, date
- `render(doc, { scope: 'page', layout, site })` → full HTML document (page scope uses simple string template for now, not a template engine)

**1.6 Markdown renderer**
- `renderInline(children, ctx)` — text with marks, links
- `blockRenderers` with markdown equivalents for every block type
- Component degradation: callout → blockquote, collapsible → bold heading, tabs → sections, steps → numbered list
- `renderDocument(doc)` → YAML frontmatter + markdown body

**1.7 Tests**
- Every fixture renders through both HTML and markdown renderers without errors
- HTML output contains expected custom elements for component blocks
- Markdown output contains expected degraded equivalents
- Schema validator accepts valid fixtures, rejects malformed ones
- Renderer coverage test: every block type in schema has a corresponding renderer entry

---

## Phase 1E: Editor Prototype (parallel track)

**Goal:** A standalone browser-based editor for exploring the authoring UX with Vanilla Breeze components. Runs independently — no database, no server, no build step. Answers the critical UX questions before committing to an editor architecture.

**See `docs/EDITOR-PROTOTYPE.md` for the full plan.**

This phase runs in parallel with Phases 1-3. It shares only two artifacts with the main project: `content-schema.js` (block type definitions) and the test fixtures (sample documents to load and edit).

**Deliverables:**
- `editor-prototype/` — standalone web app
- ProseMirror schema derived from `content-schema.js`
- Custom NodeViews for every Vanilla Breeze component block (callout, code-block, collapsible, figure, tabs, steps, card)
- Block palette (slash command menu)
- AST inspector (live debug view of the block AST)
- AST round-trip: fixture → ProseMirror → block AST → compare
- Document of UX decisions and findings

### Steps (see EDITOR-PROTOTYPE.md for details)

1. Editor shell + prose editing (paragraph, heading, list, marks)
2. AST inspector (live debug panel)
3. Code block NodeView
4. Callout NodeView (first Vanilla Breeze component — critical UX test)
5. Collapsible NodeView
6. Tabs NodeView (most complex — nested editing regions)
7. Steps NodeView
8. Figure NodeView
9. Card NodeView
10. Block palette (slash commands)
11. Meta panel (title, slug, tags, status sidebar)
12. Fixture load/save and round-trip validation

### UX Questions to Answer

- Does editing inside styled custom elements feel natural or constrained?
- What's the right trigger for block insertion — slash, plus button, both?
- How should you enter and exit component blocks (callout, collapsible)?
- How should tabbed content editing work — all visible or one at a time?
- Where should block controls live — inline hover, toolbar, sidebar?
- Is ProseMirror the right foundation, or does the component model need something different?

---

## Phase 2: Storage + Publisher + Worker

**Goal:** Store content in SQLite, build a static site publisher, deploy to Cloudflare Pages with content negotiation.

**Deliverables:**
- `src/store/schema.sql` — database schema
- `src/store/content.js` — CRUD + query functions
- `src/store/migrate.js` — schema creation / migration runner
- `src/build/publish.js` — reads store, renders all outputs, writes to `_site/`
- `src/build/templates/` — page layout templates (base, post, page, doc)
- `src/build/feeds.js` — RSS/Atom, sitemap, llms.txt generation
- `src/worker/index.js` — Cloudflare Worker for content negotiation
- `wrangler.toml` — Cloudflare configuration
- Vanilla Breeze CSS and component JS in `src/build/assets/`

### Tasks

**2.1 SQLite schema**
- `documents` table with id, collection, slug, title, description, status, author_id, created_at, updated_at, published_at, meta (JSON), blocks (JSON)
- `documents_fts` virtual table for full-text search
- `media` table for asset tracking
- `authors` table
- Indexes on collection+status, slug
- `schema.sql` file and `migrate.js` that creates tables if missing

**2.2 Content store API**
- `getDocument(db, collection, slug)` → parsed document or null
- `listCollection(db, collection, { limit, offset, tag })` → array of document summaries
- `saveDocument(db, doc)` → id (upsert)
- `deleteDocument(db, id)` → boolean
- `searchDocuments(db, query)` → array of results from FTS
- `getAllTags(db, collection)` → unique tag list
- All functions take a `db` handle as first argument (dependency injection for SQLite vs D1)

**2.3 Seed script**
- `scripts/seed.js` — inserts test fixtures into a local SQLite database
- Used for development and testing the publisher

**2.4 Page templates**
- Simple string-template-based layouts (tagged template literals, no engine dependency)
- `base.html` — doctype, head (meta, CSS link, alternate link), body shell, script tag
- `post.html` — extends base, adds post metadata header, article wrapper
- `page.html` — extends base, simple content wrapper
- `doc.html` — extends base, adds sidebar nav for docs collection
- Templates reference Vanilla Breeze CSS (`/assets/css/main.css`)

**2.5 Static publisher**
- Reads all published documents from SQLite
- For each document: renders page scope, content scope (_fragment.html), markdown, JSON
- For each collection: renders collection scope (all + per-tag filtered)
- Generates RSS/Atom feed, sitemap.xml, llms.txt
- Copies static assets (CSS, JS, images) to `_site/assets/`
- Output: complete `_site/` directory ready for deployment

**2.6 Cloudflare Worker**
- Content negotiation: Accept header parsing for markdown, JSON, HTML
- html-star scope inference from X-Star-Request and X-Star-Target headers
- Static file routing: maps scope to correct file path (_fragment.html, /md/, /api/)
- Vary header for proper CDN caching
- X-Markdown-Tokens response header on markdown responses
- Fallback: unknown paths serve standard HTML

**2.7 Wrangler configuration**
- `wrangler.toml` with Pages project config
- Asset binding for `_site/` directory
- D1 binding for dynamic queries (search)

**2.8 Vanilla Breeze assets**
- `src/build/assets/css/main.css` — @layer hub importing reset, tokens, base, layout, sections, components
- `src/build/assets/css/_tokens.css` — design tokens
- `src/build/assets/css/components/` — styles for each custom element (callout, card, code-block, etc.)
- `src/build/assets/js/main.js` — progressive enhancement entry point
- `src/build/assets/js/components/` — web component definitions for interactive elements

**2.9 Integration tests**
- Publisher produces expected file tree from seeded database
- Worker serves correct format for each Accept header combination
- html-star fragment requests return content scope (no page chrome)
- Markdown output includes frontmatter with correct metadata
- Collection endpoints return filtered results

---

## Phase 3: CLI

**Goal:** A command-line tool for managing content without the editor. Used for development, scripting, and CI/CD.

**Deliverables:**
- `bin/vp.js` — CLI entry point
- Subcommands for CRUD, publishing, importing

### Tasks

**3.1 CLI framework**
- Minimal argument parsing (no dependency — use `process.argv` or `parseArgs` from `node:util`)
- Subcommand routing: `vp <command> [args] [--flags]`
- Help text for each command
- Reads database path from env var `VP_DB` or defaults to `./content.db`

**3.2 Content commands**
- `vp new <collection> <slug>` — create a new draft document (opens $EDITOR with JSON template)
- `vp list <collection>` — list documents with title, status, date
- `vp get <collection> <slug>` — print document JSON to stdout
- `vp edit <collection> <slug>` — open document in $EDITOR
- `vp publish <collection> <slug>` — set status to published, set published_at
- `vp unpublish <collection> <slug>` — set status to draft
- `vp delete <collection> <slug>` — remove document (with confirmation)

**3.3 Build commands**
- `vp build` — run the publisher, output to `_site/`
- `vp serve` — build + serve locally with file watcher
- `vp deploy` — build + `wrangler pages deploy`

**3.4 Import commands**
- `vp import:json <file>` — import a document from JSON file
- `vp import:markdown <file>` — parse markdown + frontmatter into block AST, import
- `vp import:dir <path>` — bulk import a directory of markdown or JSON files

**3.5 Utility commands**
- `vp validate <collection> <slug>` — validate a document against the schema
- `vp render <collection> <slug> --format=html|md|json --scope=page|content` — render to stdout
- `vp search <query>` — full-text search across all documents
- `vp stats` — document counts, tag counts, storage size

---

## Phase 4: Editor Integration ✓

**Status: Complete** — 252 tests passing. See `docs/EDITOR.md` for full documentation and demo walkthrough.

**Goal:** Merge the editor prototype (Phase 1E) into the CMS pipeline. Connect to the content store API. Replace fixture loading with real CRUD operations.

**What was built:**
- `src/server/` — Node.js HTTP dev server (router, API handlers, static file serving)
- `editor/` — Production editor migrated from prototype, connected to content API
- `editor/assets/js/api-client.js` — Browser-side fetch wrapper for all API endpoints
- `editor/assets/js/components/doc-browser.js` — Document list with collection/status filters, search, create/delete
- `editor/assets/js/components/media-picker.js` — Modal for browsing/uploading media with drag-and-drop
- `editor/assets/js/editor.js` — Rewritten for API persistence: auto-save (500ms debounce), load/create/delete via API, URL hash routing
- `editor/assets/js/components/meta-panel.js` — Publish/unpublish toggle, preview, build status indicator
- `test/server/api.test.js` — API integration tests (CRUD, search, validation, error handling)
- `test/server/editor-integration.test.js` — Round-trip tests for all fixtures through the API

**Quick demo:**
```bash
npm install && npm run setup && npm run dev
# Open http://localhost:3000/editor/
```

### API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/documents` | List (query: `collection`, `status`) |
| `GET` | `/api/documents/:id` | Get one |
| `POST` | `/api/documents` | Create |
| `PUT` | `/api/documents/:id` | Update |
| `DELETE` | `/api/documents/:id` | Delete |
| `GET` | `/api/collections` | List collections |
| `GET` | `/api/search?q=` | Full-text search |
| `POST` | `/api/media` | Upload (multipart) |
| `GET` | `/api/media` | List media |
| `POST` | `/api/publish` | Trigger site build |

### Deferred to Phase 6
- Deploy configuration (Cloudflare Access, hosted editor)
- Media storage on Cloudflare R2 (currently local `media/` dir)

---

## Phase 5: WordPress Migration

**Goal:** Import content from WordPress (Gutenberg blocks and Classic Editor) into the block AST.

### Tasks

**5.1 WordPress export parser**
- Parse WordPress XML export (WXR format)
- Extract posts, pages, media, authors, categories, tags

**5.2 Gutenberg block mapper**
- Map `core/paragraph` → `paragraph`
- Map `core/heading` → `heading`
- Map `core/image` → `figure`
- Map `core/code` → `code_block`
- Map `core/quote` → `blockquote`
- Map `core/list` → `list`
- Handle unknown blocks: extract innerHTML, parse as rich text

**5.3 Classic Editor converter**
- Parse Classic Editor HTML content
- Convert to block AST via HTML-to-AST parser
- Handle common patterns: `<p>`, headings, images, lists, blockquotes

**5.4 Media migration**
- Download media files from WordPress uploads
- Store locally and update references in block AST
- Track original URLs for redirect mapping

**5.5 CLI integration**
- `vp import:wordpress <export.xml>` — full import with progress reporting
- `vp import:wordpress <export.xml> --dry-run` — preview without writing

---

## Phase 6: Collaboration + Hosted

**Goal:** Real-time collaborative editing and a hosted option for non-technical users.

### Tasks

**6.1 Collaborative editing**
- Integrate Yjs + y-prosemirror for real-time collaboration
- Cloudflare Durable Objects for collaboration state
- Presence indicators (cursors, selections)

**6.2 Authentication**
- Cloudflare Access or simple email-based auth
- Role model: admin (all access), editor (content CRUD), author (own content only)

**6.3 Hosted dashboard**
- Multi-site management
- Usage analytics (publish frequency, content volume)
- Custom domain configuration

**6.4 Content API (public)**
- Read-only JSON API for headless CMS use cases
- API key authentication
- Rate limiting via Cloudflare

---

## Working Approach

### For Claude Code

The project uses `CLAUDE.md` at the root as the primary context file. Each phase has clear boundaries — start a phase by reading CLAUDE.md and the relevant docs.

Typical workflow:
1. Read `CLAUDE.md` for project context
2. Read `docs/CONTENT-MODEL.md` or `docs/RENDERING.md` for the relevant spec
3. Implement against test fixtures
4. Run tests with `node --test`

### File Naming

- Source modules: `src/<subsystem>/<module>.js`
- Tests: `test/<subsystem>/<module>.test.js`
- Test fixtures: `test/fixtures/<name>.json`
- Docs: `docs/<NAME>.md`
- Build output: `_site/` (gitignored)
- Database: `content.db` (gitignored)

### Testing Strategy

- Unit tests for renderers (input AST → expected output string)
- Unit tests for schema validation
- Unit tests for store CRUD operations (using in-memory SQLite)
- Integration tests for publisher (seed DB → build → verify file tree)
- Test fixtures are the contract: hand-written JSON documents that every subsystem must handle correctly
