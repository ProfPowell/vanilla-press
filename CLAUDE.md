# Vanilla Press

A platform-first content system where the component model, the editor, the storage, and the output are all built on web standards.

## What This Is

Vanilla Press stores content as a typed block AST that maps 1:1 to a web component model. A `callout` block in the content store is the same `callout` that exists as a Vanilla Breeze `<status-message>` element in the browser, for example, the same `callout` that renders as `> **Warning:**` in markdown output. One concept, multiple serializations, no lossy conversion.

The system produces static output served from Cloudflare Pages. A thin Cloudflare Worker handles content negotiation — same URL serves HTML to browsers, markdown to LLM agents, JSON to API consumers, and HTML fragments to html-star (hypermedia) requests.

## Architecture

```
content-schema.js          ← single source of truth for block types
        │
        ├── renderers/     ← pure functions: AST → string
        │   ├── html.js    ← semantic HTML with custom elements
        │   ├── markdown.js← clean markdown with frontmatter
        │   └── feed.js    ← RSS/Atom
        │
        ├── store/         ← SQLite/D1 content API
        │   └── content.js
        │
        ├── build/         ← static publisher
        │   └── publish.js
        │
        └── worker/        ← Cloudflare Worker
            └── index.js   ← content negotiation + scope routing
```

## Key Concepts

**Block AST:** Documents are JSON arrays of typed blocks. Blocks have `type`, optional `attrs`, and `children` or leaf `value`. The schema in `content-schema.js` defines all block types and is shared across the entire system.

**Rendering Scope:** Every piece of content renders at one of five scopes: `page` (full HTML document), `content` (article body only), `block` (single block), `collection` (list of document cards), `meta` (document metadata). The scope is a function parameter, not a code path. This eliminates the template duplication problem that htmx/hypermedia integrations normally suffer from.

**Content Negotiation:** The Cloudflare Worker reads `Accept` headers and `X-Star-Request` (html-star) headers to determine format and scope. Static files are pre-generated at build time for common scopes. Dynamic queries (search, arbitrary filters) hit Cloudflare D1.

## Tech Stack

- **Language:** Vanilla JavaScript (ES modules, no TypeScript, no build step for client code)
- **Storage:** SQLite locally via better-sqlite3, Cloudflare D1 in production
- **Deployment:** Cloudflare Pages + Workers
- **CSS:** Vanilla Breeze — native @layer, @import, custom elements as style hooks
- **Testing:** Node.js native test runner (`node --test`)
- **Editor (future):** ProseMirror with custom NodeViews rendering Vanilla Breeze components

## Coding Conventions

- ES modules throughout (`import`/`export`, no CommonJS except where Node requires it)
- Named exports only, no default exports
- Pure functions for renderers — no side effects, no state
- JSDoc for public APIs
- camelCase for variables/functions, PascalCase for classes, kebab-case for custom elements
- No frameworks, no ORMs, no build tools for application code
- SQL is fine — write it directly, no query builders

## Project Phases

See `docs/IMPLEMENTATION.md` for the full plan. The current phase determines what's in scope:

- **Phase 1:** Content schema + renderers + test fixtures
- **Phase 1E:** Editor prototype (runs in parallel — standalone ProseMirror + Vanilla Breeze components)
- **Phase 2:** SQLite store + static publisher + Cloudflare Worker
- **Phase 3:** CLI for content management
- **Phase 4:** Editor integration (merges prototype into CMS pipeline)
- **Phase 5:** WordPress migration tooling
- **Phase 6:** Collaboration / hosted features

## Documentation

- `docs/VISION.md` — Full architectural vision and thesis
- `docs/HYPERMEDIA.md` — Rendering scopes, html-star/montane integration
- `docs/IMPLEMENTATION.md` — Phased implementation plan with task breakdowns
- `docs/EDITOR-PROTOTYPE.md` — Standalone editor prototype plan (Phase 1E)
- `docs/EDITOR.md` — Production editor guide, API reference, demo walkthrough (Phase 4)
- `docs/CONTENT-MODEL.md` — Block AST specification and examples
- `docs/RENDERING.md` — Renderer API, scope negotiation, output formats
