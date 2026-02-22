# Vanilla Press: A Platform-First Content System

*Working name. The point is: this isn't a CMS bolted onto a framework. It's a content system built on the web platform, where the component model, the editor, the storage, and the output are all the same thing: standards.*

---

## The Thesis

Every CMS makes the same mistake. They store content in a format that privileges one output — usually HTML for a browser — and then try to derive other formats after the fact. WordPress stores serialized block comments. Sanity stores portable text. Contentful stores rich text as a proprietary AST. Markdown-based systems store prose that can't express structure.

The result: content is always being translated, and every translation is lossy.

The alternative: **store content as a typed block AST that maps 1:1 to your component model.** The blocks ARE the components. A `callout` block in the content store is the same `callout` that exists as a `<ui-callout>` custom element in the browser, the same `callout` that appears as a `> **Warning:**` in markdown output, the same `callout` that renders in the editor. One concept, multiple serializations, no lossy conversion.

This is what it means to go platform-first at the content layer.


---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                      CONTENT STORE                       │
│                                                          │
│   SQLite / Cloudflare D1 / filesystem                    │
│   Tables: documents, blocks, media, authors              │
│   Content: typed block AST (JSON)                        │
└──────────────────┬──────────────────┬────────────────────┘
                   │                  │
         ┌─────────┘                  └─────────┐
         ▼                                      ▼
┌─────────────────┐                  ┌─────────────────────┐
│     EDITOR      │                  │    BUILD / PUBLISH   │
│                 │                  │                      │
│  Block editor   │  writes to ───▶  │  Reads content store │
│  (web app)      │  content store   │  Renders to:         │
│  Custom element │                  │   • HTML pages       │
│  block palette  │                  │   • Markdown (agent) │
│                 │                  │   • RSS / Atom       │
└─────────────────┘                  │   • llms.txt         │
                                     │   • JSON API         │
                                     └──────────┬──────────┘
                                                │
                                                ▼
                                     ┌─────────────────────┐
                                     │    STATIC OUTPUT     │
                                     │                      │
                                     │  _site/              │
                                     │  ├── posts/          │
                                     │  │   └── index.html  │
                                     │  ├── md/posts/       │
                                     │  │   └── index.md    │
                                     │  ├── api/posts.json  │
                                     │  ├── feed.xml        │
                                     │  └── llms.txt        │
                                     └──────────┬──────────┘
                                                │
                                                ▼
                                     ┌─────────────────────┐
                                     │   CLOUDFLARE PAGES   │
                                     │                      │
                                     │  _worker.js handles  │
                                     │  content negotiation │
                                     │  Accept: text/md ──▶ │
                                     │    serve /md/ tree   │
                                     └─────────────────────┘
```


---

## Part 1: The Content Model

### Block AST

A document is an ordered array of typed blocks. Each block has a `type`, optional `attrs`, and either `children` (nested blocks/inline content) or leaf data.

```json
{
  "id": "doc_abc123",
  "type": "document",
  "meta": {
    "title": "Getting Started with Vanilla Breeze",
    "slug": "getting-started",
    "collection": "docs",
    "author": "author_t1",
    "created": "2026-02-14",
    "updated": "2026-02-14",
    "description": "A guide to building with web standards",
    "tags": ["tutorial", "css", "web-components"],
    "status": "published"
  },
  "blocks": [
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "Vanilla Breeze is a " },
        { "type": "text", "value": "platform-first", "marks": ["strong"] },
        { "type": "text", "value": " CSS framework." }
      ]
    },
    {
      "type": "callout",
      "attrs": { "variant": "tip" },
      "children": [
        {
          "type": "paragraph",
          "children": [
            { "type": "text", "value": "No build step required. " },
            {
              "type": "link",
              "attrs": { "href": "/docs/install" },
              "children": [
                { "type": "text", "value": "See installation" }
              ]
            },
            { "type": "text", "value": "." }
          ]
        }
      ]
    },
    {
      "type": "heading",
      "attrs": { "level": 2 },
      "children": [
        { "type": "text", "value": "Quick Start" }
      ]
    },
    {
      "type": "code_block",
      "attrs": { "language": "html", "filename": "index.html" },
      "value": "<link rel=\"stylesheet\" href=\"/css/main.css\"/>"
    },
    {
      "type": "figure",
      "attrs": {
        "src": "/images/architecture.svg",
        "alt": "CSS layer cascade diagram"
      },
      "children": [
        {
          "type": "figcaption",
          "children": [
            { "type": "text", "value": "How @layer controls the cascade" }
          ]
        }
      ]
    },
    {
      "type": "collapsible",
      "attrs": { "summary": "Advanced: Custom token configuration" },
      "children": [
        {
          "type": "paragraph",
          "children": [
            { "type": "text", "value": "Override tokens in " },
            { "type": "text", "value": "_tokens.css", "marks": ["code"] },
            { "type": "text", "value": " to customize the design system." }
          ]
        }
      ]
    }
  ]
}
```

### Block Type Registry

The block types are the component model. They're defined once and shared across the editor, the renderers, and the schema validation.

```js
// content-schema.js — the single source of truth

export const blockTypes = {

  // --- Structural ---
  paragraph:    { category: 'prose',     children: 'inline' },
  heading:      { category: 'prose',     children: 'inline',  attrs: { level: { type: 'number', min: 2, max: 6 } } },
  blockquote:   { category: 'prose',     children: 'block' },
  list:         { category: 'prose',     children: 'list_item', attrs: { ordered: { type: 'boolean' } } },
  list_item:    { category: 'prose',     children: 'block' },
  hr:           { category: 'prose',     leaf: true },

  // --- Media ---
  figure:       { category: 'media',     children: ['figcaption'], attrs: { src: 'string', alt: 'string' } },
  figcaption:   { category: 'media',     children: 'inline' },
  embed:        { category: 'media',     leaf: true, attrs: { url: 'string', type: { enum: ['video', 'codepen', 'observable'] } } },

  // --- Code ---
  code_block:   { category: 'code',      leaf: true, attrs: { language: 'string', filename: 'string' } },

  // --- Vanilla Breeze Components ---
  callout:      { category: 'component', children: 'block',  attrs: { variant: { enum: ['note', 'tip', 'warning', 'danger'] } } },
  collapsible:  { category: 'component', children: 'block',  attrs: { summary: 'string' } },
  card:         { category: 'component', children: 'block',  attrs: { href: 'string' } },
  tabs:         { category: 'component', children: 'tab' },
  tab:          { category: 'component', children: 'block',  attrs: { label: 'string' } },
  steps:        { category: 'component', children: 'step' },
  step:         { category: 'component', children: 'block',  attrs: { title: 'string' } },
};

export const inlineTypes = {
  text:         { marks: ['strong', 'em', 'code', 'strikethrough'] },
  link:         { children: 'inline', attrs: { href: 'string', title: 'string' } },
  footnote_ref: { leaf: true, attrs: { id: 'string' } },
};
```

This schema does three jobs simultaneously: it validates content on write, it configures the editor's block palette, and it tells renderers what to expect. Add a block type here and it propagates everywhere.


### Why Not Portable Text or MDX?

**Portable Text** (Sanity's format) is close but opinionated in ways that create friction. It uses `_type` and `_key` fields, has its own inline mark model, and its tooling assumes Sanity as the host. The shape is right but the implementation ties you to their ecosystem.

**MDX** goes the wrong direction — it takes markdown (limited structure) and adds JSX (framework-specific). You end up with content that only works in a React build pipeline. The opposite of platform-first.

**The AST format above** is intentionally minimal and generic. It looks like a simplified ProseMirror document model, which is deliberate — ProseMirror/TipTap can work with this shape natively as the editor, and the format itself has no framework or vendor dependencies. It's just JSON with a schema.


---

## Part 2: The Rendering Pipeline

Each output format is a renderer — a pure function that walks the block AST and emits a string. Renderers are composable: the HTML renderer calls into a sub-renderer for inline content, the markdown renderer has its own inline handler, and so on.

### HTML Renderer

Emits semantic HTML with Vanilla Breeze custom elements.

```js
// renderers/html.js

const blockRenderers = {
  paragraph:   (block, ctx) => `<p>${renderInline(block.children, ctx)}</p>`,
  heading:     (block, ctx) => `<h${block.attrs.level}>${renderInline(block.children, ctx)}</h${block.attrs.level}>`,
  blockquote:  (block, ctx) => `<blockquote>${renderBlocks(block.children, ctx)}</blockquote>`,
  hr:          () => `<hr/>`,
  code_block:  (block) => {
    const meta = block.attrs.filename ? `<span class="code-filename">${block.attrs.filename}</span>` : '';
    return `<code-block data-language="${block.attrs.language}">${meta}<pre><code>${escapeHtml(block.value)}</code></pre></code-block>`;
  },
  figure:      (block, ctx) => {
    const caption = block.children?.find(c => c.type === 'figcaption');
    const captionHtml = caption ? `<figcaption>${renderInline(caption.children, ctx)}</figcaption>` : '';
    return `<figure><img src="${block.attrs.src}" alt="${block.attrs.alt}"/>${captionHtml}</figure>`;
  },
  callout:     (block, ctx) => `<ui-callout data-variant="${block.attrs.variant}">${renderBlocks(block.children, ctx)}</ui-callout>`,
  collapsible: (block, ctx) => `<details><summary>${block.attrs.summary}</summary>${renderBlocks(block.children, ctx)}</details>`,
  tabs:        (block, ctx) => renderTabs(block, ctx),
  steps:       (block, ctx) => `<ol data-steps="">${block.children.map(s => `<li><strong>${s.attrs.title}</strong>${renderBlocks(s.children, ctx)}</li>`).join('')}</ol>`,
  list:        (block, ctx) => {
    const tag = block.attrs.ordered ? 'ol' : 'ul';
    return `<${tag}>${block.children.map(li => `<li>${renderBlocks(li.children, ctx)}</li>`).join('')}</${tag}>`;
  },
};

function renderInline(children, ctx) {
  return children.map(child => {
    if (child.type === 'text') {
      let text = escapeHtml(child.value);
      for (const mark of (child.marks || [])) {
        text = wrapMark(mark, text);
      }
      return text;
    }
    if (child.type === 'link') {
      return `<a href="${child.attrs.href}">${renderInline(child.children, ctx)}</a>`;
    }
    return '';
  }).join('');
}

function wrapMark(mark, text) {
  const tags = { strong: 'strong', em: 'em', code: 'code', strikethrough: 's' };
  const tag = tags[mark];
  return tag ? `<${tag}>${text}</${tag}>` : text;
}

export function renderDocument(doc) {
  return renderBlocks(doc.blocks, { meta: doc.meta });
}
```

### Markdown Renderer

Emits clean markdown, gracefully degrading components to the closest markdown equivalent.

```js
// renderers/markdown.js

const blockRenderers = {
  paragraph:   (block, ctx) => renderInline(block.children, ctx),
  heading:     (block, ctx) => `${'#'.repeat(block.attrs.level)} ${renderInline(block.children, ctx)}`,
  blockquote:  (block, ctx) => renderBlocks(block.children, ctx).split('\n').map(l => `> ${l}`).join('\n'),
  hr:          () => '---',
  code_block:  (block) => `\`\`\`${block.attrs.language}\n${block.value}\n\`\`\``,
  figure:      (block, ctx) => {
    const caption = block.children?.find(c => c.type === 'figcaption');
    const captionText = caption ? renderInline(caption.children, ctx) : '';
    return `![${block.attrs.alt}](${block.attrs.src})${captionText ? `\n*${captionText}*` : ''}`;
  },

  // Component graceful degradation
  callout:     (block, ctx) => {
    const label = { note: 'Note', tip: 'Tip', warning: 'Warning', danger: 'Danger' }[block.attrs.variant] || 'Note';
    const body = renderBlocks(block.children, ctx);
    return body.split('\n').map((l, i) => i === 0 ? `> **${label}:** ${l}` : `> ${l}`).join('\n');
  },
  collapsible: (block, ctx) => {
    return `**${block.attrs.summary}**\n\n${renderBlocks(block.children, ctx)}`;
  },
  tabs:        (block, ctx) => {
    return block.children.map(tab =>
      `### ${tab.attrs.label}\n\n${renderBlocks(tab.children, ctx)}`
    ).join('\n\n');
  },
  steps:       (block, ctx) => {
    return block.children.map((step, i) =>
      `${i + 1}. **${step.attrs.title}**\n\n${renderBlocks(step.children, ctx)}`
    ).join('\n\n');
  },
  list:        (block, ctx) => {
    return block.children.map((li, i) => {
      const prefix = block.attrs.ordered ? `${i + 1}.` : '-';
      return `${prefix} ${renderBlocks(li.children, ctx)}`;
    }).join('\n');
  },
};

function renderInline(children, ctx) {
  return children.map(child => {
    if (child.type === 'text') {
      let text = child.value;
      if (child.marks?.includes('strong')) text = `**${text}**`;
      if (child.marks?.includes('em')) text = `*${text}*`;
      if (child.marks?.includes('code')) text = `\`${text}\``;
      if (child.marks?.includes('strikethrough')) text = `~~${text}~~`;
      return text;
    }
    if (child.type === 'link') {
      return `[${renderInline(child.children, ctx)}](${child.attrs.href})`;
    }
    return '';
  }).join('');
}

export function renderDocument(doc) {
  const fm = [
    '---',
    `title: "${doc.meta.title}"`,
    doc.meta.description ? `description: "${doc.meta.description}"` : null,
    doc.meta.created ? `date: ${doc.meta.created}` : null,
    doc.meta.tags?.length ? `tags: [${doc.meta.tags.join(', ')}]` : null,
    `url: ${doc.meta.url}`,
    '---',
  ].filter(Boolean).join('\n');

  return `${fm}\n\n${renderBlocks(doc.blocks, { meta: doc.meta })}`;
}
```

### HTML Fragment Renderer

For the "Option 2" we discussed — serves the `<main>` content as clean HTML, stripped of page chrome. Maximum semantic fidelity, still 80% token reduction.

```js
// renderers/fragment.js

import { renderDocument as renderHtml } from './html.js';

export function renderFragment(doc) {
  const body = renderHtml(doc);
  const tokenEstimate = Math.ceil(body.length / 4);

  return {
    content: body,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Mode': 'fragment',
      'X-Markdown-Tokens': String(tokenEstimate),
    },
  };
}
```

### Adding a Renderer

The pattern is always the same: implement a `blockRenderers` object with one function per block type, implement `renderInline`, export `renderDocument`. The block type registry guarantees you've covered every case. A new output format (AMP, email, epub) is just another renderer file — the content never changes.


---

## Part 3: Storage

### Design Principles

The content store should be boring. No ORM. No migrations framework. Just SQL. The data is JSON documents in a relational wrapper for querying.

**Primary:** SQLite for local development and self-hosted. Cloudflare D1 for production on Cloudflare's stack. Both speak the same SQL dialect.

**Why not filesystem JSON?** You lose querying. "Give me all published posts tagged 'css' sorted by date" becomes "read every file, parse JSON, filter in memory." SQLite gives you that query for free and still stores on disk as a single file you can copy, back up, and version.

### Schema

```sql
-- Documents: the unit of content
CREATE TABLE documents (
  id          TEXT PRIMARY KEY,
  collection  TEXT NOT NULL,            -- 'posts', 'docs', 'pages'
  slug        TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT DEFAULT 'draft',     -- 'draft', 'published', 'archived'
  author_id   TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now')),
  published_at TEXT,
  meta        TEXT,                     -- JSON: tags, custom fields
  blocks      TEXT NOT NULL,            -- JSON: the block AST
  UNIQUE(collection, slug)
);

-- Full-text search on content
CREATE VIRTUAL TABLE documents_fts USING fts5(
  title, description, content,
  content='documents',
  content_rowid='rowid'
);

-- Media assets
CREATE TABLE media (
  id          TEXT PRIMARY KEY,
  filename    TEXT NOT NULL,
  alt_text    TEXT,
  mime_type   TEXT,
  width       INTEGER,
  height      INTEGER,
  size_bytes  INTEGER,
  uploaded_at TEXT DEFAULT (datetime('now')),
  meta        TEXT                      -- JSON: focal point, attribution
);

-- Authors
CREATE TABLE authors (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT,
  avatar_url  TEXT,
  bio         TEXT
);

-- Indexes
CREATE INDEX idx_docs_collection ON documents(collection, status, published_at);
CREATE INDEX idx_docs_slug ON documents(slug);
```

### Content API

A thin layer over SQLite. No REST framework — just functions.

```js
// store/content.js

export function getDocument(db, collection, slug) {
  const row = db.prepare(
    'SELECT * FROM documents WHERE collection = ? AND slug = ? AND status = ?'
  ).get(collection, slug, 'published');

  if (!row) return null;
  return {
    ...row,
    meta: JSON.parse(row.meta || '{}'),
    blocks: JSON.parse(row.blocks),
  };
}

export function listCollection(db, collection, { limit = 50, offset = 0, tag } = {}) {
  let query = 'SELECT id, collection, slug, title, description, published_at, meta FROM documents WHERE collection = ? AND status = ?';
  const params = [collection, 'published'];

  if (tag) {
    query += " AND json_each.value = ?";
    // SQLite JSON query for tag filtering
    query = `SELECT d.* FROM documents d, json_each(d.meta, '$.tags') WHERE d.collection = ? AND d.status = ? AND json_each.value = ?`;
    params.push(tag);
  }

  query += ' ORDER BY published_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(...params).map(row => ({
    ...row,
    meta: JSON.parse(row.meta || '{}'),
  }));
}

export function saveDocument(db, doc) {
  const id = doc.id || `doc_${crypto.randomUUID().slice(0, 12)}`;
  db.prepare(`
    INSERT INTO documents (id, collection, slug, title, description, status, author_id, meta, blocks, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      slug = excluded.slug,
      status = excluded.status,
      meta = excluded.meta,
      blocks = excluded.blocks,
      updated_at = datetime('now')
  `).run(id, doc.collection, doc.slug, doc.title, doc.description, doc.status || 'draft', doc.author_id, JSON.stringify(doc.meta), JSON.stringify(doc.blocks));

  return id;
}

export function searchDocuments(db, query) {
  return db.prepare(
    'SELECT d.* FROM documents_fts f JOIN documents d ON f.rowid = d.rowid WHERE documents_fts MATCH ? ORDER BY rank'
  ).all(query);
}
```

### Storage Portability

The API layer abstracts the database. For Cloudflare D1, swap `db.prepare(...).get()` for `env.DB.prepare(...).first()`. Same SQL, same schema. The content store travels between local development (SQLite file) and production (D1) without changes.

For people who want filesystem storage, offer an export/import that writes each document as a JSON file in a directory structure:

```
content/
├── posts/
│   ├── getting-started.json
│   └── css-layers-guide.json
└── docs/
    └── installation.json
```

This gives you git-based version control for content without giving up queryability at runtime.


---

## Part 4: The Editor

### Architecture

The editor is a web application built with the same stack it produces: custom elements, vanilla JS, Vanilla Breeze CSS. It eats its own dog food.

**Editing engine:** ProseMirror. Not TipTap (which wraps ProseMirror in a framework-flavored API), but ProseMirror directly. It's lower-level but it's a library, not a framework. You define a schema that maps to your block types, and ProseMirror gives you collaborative editing, undo/redo, input rules, and key bindings. The schema IS your content-schema.js from Part 1 — one definition, used everywhere.

**Why not build the editor from scratch?** Because rich text editing is a genuinely hard problem. Selection, cursor movement, IME support, paste handling, undo history — these are years of edge cases. ProseMirror solves them and stays out of your way architecturally. It's the "use the platform" of text editors.

### Editor Shell

```
editor/
├── index.html                    # Editor SPA shell
├── assets/
│   ├── css/
│   │   ├── main.css              # Vanilla Breeze + editor styles
│   │   └── editor/
│   │       ├── _prosemirror.css   # ProseMirror base styles
│   │       ├── _toolbar.css       # Block palette, formatting bar
│   │       └── _sidebar.css       # Document meta, settings
│   └── js/
│       ├── editor.js              # Editor initialization
│       ├── schema.js              # ProseMirror schema from content-schema.js
│       ├── blocks/                # Custom block node views
│       │   ├── callout-view.js
│       │   ├── code-block-view.js
│       │   └── figure-view.js
│       ├── commands/              # Editor commands
│       │   ├── insert-block.js
│       │   └── toggle-mark.js
│       └── store/                 # Content API client
│           └── api.js
├── components/                    # Editor UI web components
│   ├── editor-shell.js            # Main editor layout
│   ├── block-palette.js           # Insert block menu
│   ├── document-sidebar.js        # Meta editor (title, slug, tags)
│   ├── media-picker.js            # Image/media selector
│   └── collection-browser.js      # Document list, navigation
```

### ProseMirror Schema Derivation

The content schema drives the ProseMirror schema automatically:

```js
// editor/schema.js

import { Schema } from 'prosemirror-model';
import { blockTypes, inlineTypes } from '../../content-schema.js';

function deriveNodes() {
  const nodes = {
    doc: { content: 'block+' },
    text: { group: 'inline' },
  };

  for (const [name, def] of Object.entries(blockTypes)) {
    nodes[name] = {
      group: def.leaf ? 'block' : 'block',
      content: def.leaf ? undefined : deriveContent(def.children),
      attrs: deriveAttrs(def.attrs),
      parseDOM: [deriveParseDom(name, def)],
      toDOM: (node) => deriveToDom(name, node),
    };
  }

  return nodes;
}

function deriveMarks() {
  return {
    strong: {
      parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
      toDOM: () => ['strong', 0],
    },
    em: {
      parseDOM: [{ tag: 'em' }, { tag: 'i' }],
      toDOM: () => ['em', 0],
    },
    code: {
      parseDOM: [{ tag: 'code' }],
      toDOM: () => ['code', 0],
    },
    link: {
      attrs: { href: {}, title: { default: null } },
      parseDOM: [{ tag: 'a[href]', getAttrs: dom => ({ href: dom.getAttribute('href') }) }],
      toDOM: (mark) => ['a', { href: mark.attrs.href }, 0],
    },
  };
}

export const schema = new Schema({
  nodes: deriveNodes(),
  marks: deriveMarks(),
});
```

### Block Palette

A command palette that lists available block types by category. Authors type `/` in an empty paragraph and get a filtered menu — same pattern as Notion or Sanity, but the block types come from your schema, not a hardcoded list.

```js
// editor/components/block-palette.js

class BlockPalette extends HTMLElement {
  connectedCallback() {
    // Group blocks by category from the schema
    // Render as a popover menu
    // Filter on keystroke
    // Insert selected block type into ProseMirror
  }
}

customElements.define('block-palette', BlockPalette);
```

### Editing Vanilla Breeze Components

Each component block type gets a custom ProseMirror NodeView. This is where the editor renders the block as the actual custom element — so what you see while editing IS the output:

```js
// editor/blocks/callout-view.js

export class CalloutView {
  constructor(node, view, getPos) {
    this.dom = document.createElement('ui-callout');
    this.dom.setAttribute('data-variant', node.attrs.variant);
    this.contentDOM = document.createElement('div');
    this.dom.appendChild(this.contentDOM);
  }

  update(node) {
    if (node.type.name !== 'callout') return false;
    this.dom.setAttribute('data-variant', node.attrs.variant);
    return true;
  }
}
```

The author sees `<ui-callout>` in the editor styled by the same Vanilla Breeze CSS that styles the published site. WYSIWYG through shared components, not through a parallel rendering engine.


---

## Part 5: The Build Pipeline

### Publisher

The publisher reads from the content store and writes static files. It's a script, not a framework.

```js
// build/publish.js

import Database from 'better-sqlite3';
import { renderDocument as renderHtml } from '../renderers/html.js';
import { renderDocument as renderMarkdown } from '../renderers/markdown.js';
import { blockTypes } from '../content-schema.js';

const db = new Database('./content.db');

function publish() {
  const collections = ['posts', 'docs', 'pages'];

  for (const collection of collections) {
    const docs = listCollection(db, collection);

    for (const doc of docs) {
      const full = getDocument(db, collection, doc.slug);
      const url = `/${collection}/${doc.slug}/`;

      // HTML page — apply layout template
      const htmlBody = renderHtml(full);
      const htmlPage = applyLayout(htmlBody, full.meta, collection);
      write(`_site${url}index.html`, htmlPage);

      // Markdown for agents
      const markdown = renderMarkdown({ ...full, meta: { ...full.meta, url } });
      write(`_site/md${url}index.md`, markdown);

      // JSON API
      write(`_site/api/${collection}/${doc.slug}.json`, JSON.stringify(full, null, 2));
    }
  }

  // Feeds
  generateRss(db);
  generateSitemap(db);
  generateLlmsTxt(db);
}

function applyLayout(body, meta, collection) {
  // Read layout template (Nunjucks, plain string interpolation, whatever)
  // Inject body, meta tags, navigation, Vanilla Breeze CSS/JS links
  // Return complete HTML document
}
```

### Template System

For the HTML shell (head, nav, footer), use a simple template engine or even tagged template literals. The content body comes from the renderer. The chrome comes from templates. Keep them separate:

```
build/
├── templates/
│   ├── base.html          # <!doctype>, <head>, <body> shell
│   ├── post.html          # Post layout (extends base)
│   ├── page.html          # Static page layout
│   └── partials/
│       ├── head.html       # <meta>, <link>, tokens
│       ├── header.html     # <site-header>
│       └── footer.html     # <site-footer>
```

You can use 11ty for this step if you want its template composition, or you can use a minimal templating function. The publisher is the only part that cares about page layout — the renderers only produce the content body.

### Local Development

```bash
# Watch content DB + templates, rebuild on change
node build/watch.js

# Serve with live reload
npx serve _site

# Or use the editor directly against the local DB
node editor/server.js
```


---

## Part 6: Content Negotiation on Cloudflare

### Multi-Format Worker

The edge worker handles three content types from the same URL:

```js
// _worker.js

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const accept = request.headers.get('accept') || '';
    const format = negotiateFormat(accept);

    if (format === 'html') {
      return env.ASSETS.fetch(request);
    }

    // Try to serve alternative format
    const altPath = format === 'markdown'
      ? `/md${url.pathname}${url.pathname.endsWith('/') ? '' : '/'}index.md`
      : `/api${url.pathname.replace(/\/$/, '')}.json`;

    try {
      const response = await env.ASSETS.fetch(new Request(new URL(altPath, request.url)));
      if (!response.ok) return env.ASSETS.fetch(request);

      const body = await response.text();
      const contentType = format === 'markdown'
        ? 'text/markdown; charset=utf-8'
        : 'application/json; charset=utf-8';

      return new Response(body, {
        headers: {
          'Content-Type': contentType,
          'X-Markdown-Tokens': String(Math.ceil(body.length / 4)),
          'Vary': 'Accept',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    } catch {
      return env.ASSETS.fetch(request);
    }
  },
};

function negotiateFormat(accept) {
  const types = accept.split(',').map(t => t.trim().split(';')[0]);
  const mdIdx = types.findIndex(t => t === 'text/markdown' || t === 'text/plain');
  const jsonIdx = types.findIndex(t => t === 'application/json');
  const htmlIdx = types.findIndex(t => t === 'text/html');

  if (mdIdx !== -1 && (htmlIdx === -1 || mdIdx < htmlIdx)) return 'markdown';
  if (jsonIdx !== -1 && (htmlIdx === -1 || jsonIdx < htmlIdx)) return 'json';
  return 'html';
}
```

This gives you three representations from every URL:
- Browser: `Accept: text/html` → full HTML page
- LLM agent: `Accept: text/markdown` → clean markdown with frontmatter
- API consumer: `Accept: application/json` → full block AST with metadata


---

## Part 7: What This Enables

### For Vanilla Breeze adopters

A turnkey content system that speaks their component language. Authors write content using the same blocks that render as custom elements. No impedance mismatch between the CMS and the frontend.

### For the Vanilla Breeze docs site

Migrate from Astro + markdown to the editor + block AST. The docs themselves become the reference implementation. Every pattern in the docs is authored using the pattern it describes.

### For the teaching mission

Students see a complete system: content modeling, rendering pipelines, database design, web components, CSS architecture, HTTP content negotiation, edge computing. Every layer uses web standards. No framework magic to wave away.

### For WordPress users who want out

Import WordPress posts (Gutenberg blocks → block AST mapping), keep the editorial workflow they're used to (block editor, media library, drafts/publish), lose the PHP/MySQL operational burden.


---

## Implementation Phases

### Phase 1: Content Model + Renderers
Define the block type schema. Build the HTML and markdown renderers. Test with hand-written JSON documents. Validate that the same AST produces correct output in both formats.

### Phase 2: Static Publisher
Build the publish script that reads JSON files (filesystem storage first) and outputs a static site with HTML + markdown + JSON trees. Deploy to Cloudflare Pages with the content negotiation worker. This is a working site.

### Phase 3: SQLite Store
Replace filesystem JSON with SQLite. Add the content API functions. Full-text search. Tag queries. This is still a developer-facing tool — you're editing JSON or using a CLI.

### Phase 4: Editor
Build the ProseMirror-based block editor as a web app. Custom element UI. Vanilla Breeze styling. Connect to the content API. This is where authors can use it.

### Phase 5: WordPress Migration
Build a Gutenberg block → block AST importer. Map WordPress blocks to your schema. Handle media import. Provide a migration path for existing sites.

### Phase 6: Collaborative / Hosted
If there's demand: add real-time collaboration (ProseMirror has native support via `y-prosemirror` + Yjs). Consider a hosted offering using Cloudflare Durable Objects for collaboration state and D1 for storage.
