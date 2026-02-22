# Rendering Pipeline

How content flows from block AST to output formats and rendering scopes.

## Renderer Architecture

Each output format is a module that exports a `render(doc, options)` function. Renderers are pure functions — no side effects, no database access, no network calls. They take a document (or block array) and return a string.

```
src/renderers/
├── html.js       ← semantic HTML with Vanilla Breeze custom elements
├── markdown.js   ← clean markdown with YAML frontmatter
├── feed.js       ← RSS/Atom entry content
└── shared.js     ← utilities shared across renderers (escaping, date formatting)
```

### Renderer Contract

Every renderer must:

1. Handle every block type defined in `content-schema.js`
2. Handle every inline type and mark
3. Gracefully degrade unknown block types (render children if present, skip if leaf)
4. Perform its own escaping — input strings are raw/unescaped
5. Be a pure function with no side effects


## Rendering Scopes

The scope determines how much wrapping surrounds the content. This is the mechanism that makes hypermedia (html-star) work without template duplication.

| Scope | Returns | Typical Consumer |
|-------|---------|------------------|
| `page` | Full HTML document | Browser initial load, SSG output |
| `content` | `<article>` body | html-star swap, agent fragment |
| `block` | Single rendered block | Inline edit update |
| `collection` | List of article cards | html-star list swap, filtered results |
| `meta` | Document metadata as HTML | Title/sidebar update |

### API

```js
import { render } from './renderers/html.js';

// Full page — needs layout templates and site config
render(doc, { scope: 'page', layout: 'post', site: siteConfig });

// Article body only
render(doc, { scope: 'content' });

// Single block
render(singleBlock, { scope: 'block' });

// List of documents as cards
render(docArray, { scope: 'collection' });

// Document metadata
render(doc, { scope: 'meta' });
```

The markdown renderer only supports `content` scope (the full document as markdown with frontmatter). `page`, `block`, and `collection` scopes are HTML-only concerns.


## Content Negotiation

The Cloudflare Worker maps request headers to format + scope:

| Accept Header | html-star Header | Result |
|--------------|------------------|--------|
| `text/html` | absent | `html`, `page` |
| `text/html` | `X-Star-Request: true` | `html`, `content` (or inferred scope) |
| `text/markdown` | — | `markdown`, `content` |
| `application/json` | — | `json`, raw AST |

The `Vary: Accept, X-Star-Request` header ensures CDN caches partition correctly.


## Static Output Structure

The publisher generates all scopes as static files:

```
_site/
├── posts/first-post/
│   ├── index.html                ← page scope
│   └── _fragment.html            ← content scope
├── md/posts/first-post/
│   └── index.md                  ← markdown
├── api/posts/first-post.json     ← raw AST + metadata
├── _collections/
│   ├── posts.html                ← all posts, collection scope
│   └── posts/
│       ├── tag-css.html          ← filtered by tag
│       └── tag-components.html
├── feed.xml                      ← RSS/Atom
├── llms.txt                      ← agent content directory
└── sitemap.xml
```


## HTML → Custom Element Mapping

Component blocks render as Vanilla Breeze custom elements:

| Block Type | HTML Output |
|-----------|-------------|
| `callout` | `<ui-callout data-variant="...">` |
| `collapsible` | `<details><summary>...</summary>` |
| `card` | `<content-card href="...">` |
| `code_block` | `<code-block data-language="...">` |
| `tabs` | `<ui-tabs>` with radio-button CSS pattern |
| `steps` | `<ol data-steps="">` |

Standard prose blocks use semantic HTML: `<p>`, `<h2>`–`<h6>`, `<blockquote>`, `<ul>`/`<ol>`, `<figure>`, `<hr/>`.


## Markdown Degradation Strategy

Component blocks that have no markdown equivalent degrade gracefully:

| Block Type | Markdown Output |
|-----------|----------------|
| `callout` | `> **Warning:** content` (blockquote with bold label) |
| `collapsible` | `**Summary**\n\ncontent` (bold heading, inline content) |
| `card` | `### [Title](href)\n\ncontent` (linked heading) |
| `tabs` | `### Tab Label\n\ncontent` per tab (sequential sections) |
| `steps` | `1. **Step title**\n\ncontent` (numbered list) |

The degradation is lossy but preserves semantic intent. An LLM reading `> **Warning:**` understands the content is cautionary even without the `<ui-callout>` wrapper.
