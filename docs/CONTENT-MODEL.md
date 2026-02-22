# Content Model

The block AST specification for Vanilla Press.

## Document Structure

A document has two parts: metadata and content blocks.

```json
{
  "id": "doc_abc123",
  "meta": {
    "title": "Document Title",
    "slug": "document-title",
    "collection": "posts",
    "description": "Brief description for feeds and agents",
    "author_id": "author_t1",
    "status": "published",
    "created": "2026-02-14",
    "updated": "2026-02-14",
    "published": "2026-02-14",
    "tags": ["css", "web-components"]
  },
  "blocks": []
}
```

### Meta Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Document title |
| `slug` | string | yes | URL-safe identifier, unique within collection |
| `collection` | string | yes | Content collection name (posts, docs, pages) |
| `description` | string | no | Short summary for SEO, feeds, agent frontmatter |
| `author_id` | string | no | Reference to authors table |
| `status` | enum | yes | `draft`, `published`, `archived` |
| `created` | ISO date | yes | Creation date |
| `updated` | ISO date | yes | Last modification date |
| `published` | ISO date | no | Publication date (null for drafts) |
| `tags` | string[] | no | Categorization tags |

Custom fields go in a `custom` object within meta to avoid collision with core fields.


## Block Types

Blocks are the content primitives. Every block has a `type` and either `children` (nested content) or a leaf `value`.

### Inline Content

Inline content appears inside blocks that accept `children: 'inline'`. An inline node is either text or a link.

**Text node:**
```json
{ "type": "text", "value": "plain text" }
{ "type": "text", "value": "bold text", "marks": ["strong"] }
{ "type": "text", "value": "code", "marks": ["code"] }
{ "type": "text", "value": "bold italic", "marks": ["strong", "em"] }
```

**Available marks:** `strong`, `em`, `code`, `strikethrough`

Marks are combinable. Order does not matter.

**Link node:**
```json
{
  "type": "link",
  "attrs": { "href": "/docs/install", "title": "Installation guide" },
  "children": [
    { "type": "text", "value": "See installation" }
  ]
}
```

**Footnote reference:**
```json
{ "type": "footnote_ref", "attrs": { "id": "fn1" } }
```


### Prose Blocks

**paragraph** — Standard text paragraph.
```json
{
  "type": "paragraph",
  "children": [
    { "type": "text", "value": "Vanilla Breeze is a " },
    { "type": "text", "value": "platform-first", "marks": ["strong"] },
    { "type": "text", "value": " CSS framework." }
  ]
}
```

**heading** — Section heading. Levels 2-6 (h1 is reserved for the document title from meta).
```json
{
  "type": "heading",
  "attrs": { "level": 2 },
  "children": [
    { "type": "text", "value": "Quick Start" }
  ]
}
```

**blockquote** — Block quotation. Contains block-level children.
```json
{
  "type": "blockquote",
  "children": [
    {
      "type": "paragraph",
      "children": [{ "type": "text", "value": "The web is the platform." }]
    }
  ]
}
```

**list** — Ordered or unordered list.
```json
{
  "type": "list",
  "attrs": { "ordered": false },
  "children": [
    {
      "type": "list_item",
      "children": [
        {
          "type": "paragraph",
          "children": [{ "type": "text", "value": "First item" }]
        }
      ]
    },
    {
      "type": "list_item",
      "children": [
        {
          "type": "paragraph",
          "children": [{ "type": "text", "value": "Second item" }]
        }
      ]
    }
  ]
}
```

**hr** — Thematic break. Leaf block with no children.
```json
{ "type": "hr" }
```


### Media Blocks

**figure** — Image with optional caption.
```json
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
}
```

The `children` array is optional. A figure without a figcaption child renders as a bare `<figure><img/></figure>`.

**embed** — External content embed.
```json
{
  "type": "embed",
  "attrs": {
    "url": "https://codepen.io/user/pen/abc123",
    "type": "codepen"
  }
}
```

Embed types: `video`, `codepen`, `observable`. Renderers handle each type appropriately (iframe, oembed, etc.).


### Code Blocks

**code_block** — Fenced code with language and optional filename.
```json
{
  "type": "code_block",
  "attrs": { "language": "css", "filename": "_tokens.css" },
  "value": ":root {\n  --color-primary: #2563eb;\n}"
}
```

The `value` is the raw code string, not parsed. The `language` attr drives syntax highlighting in HTML output and fence annotation in markdown.


### Component Blocks

These map directly to Vanilla Breeze custom elements.

**callout** — Highlighted content with variant.
```json
{
  "type": "callout",
  "attrs": { "variant": "warning" },
  "children": [
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "This API is deprecated." }
      ]
    }
  ]
}
```
Variants: `note`, `tip`, `warning`, `danger`

HTML: `<ui-callout data-variant="warning">...</ui-callout>`
Markdown: `> **Warning:** This API is deprecated.`

**collapsible** — Expandable content section.
```json
{
  "type": "collapsible",
  "attrs": { "summary": "Advanced configuration" },
  "children": [
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "Override tokens in " },
        { "type": "text", "value": "_tokens.css", "marks": ["code"] },
        { "type": "text", "value": " to customize." }
      ]
    }
  ]
}
```
HTML: `<details><summary>Advanced configuration</summary>...</details>`
Markdown: `**Advanced configuration**\n\nOverride tokens in \`_tokens.css\` to customize.`

**card** — Linked content card.
```json
{
  "type": "card",
  "attrs": { "href": "/docs/css-layers" },
  "children": [
    {
      "type": "heading",
      "attrs": { "level": 3 },
      "children": [{ "type": "text", "value": "CSS Layers Guide" }]
    },
    {
      "type": "paragraph",
      "children": [{ "type": "text", "value": "Learn cascade control." }]
    }
  ]
}
```

**tabs** — Tabbed content panels.
```json
{
  "type": "tabs",
  "children": [
    {
      "type": "tab",
      "attrs": { "label": "HTML" },
      "children": [
        { "type": "code_block", "attrs": { "language": "html" }, "value": "<ui-callout>...</ui-callout>" }
      ]
    },
    {
      "type": "tab",
      "attrs": { "label": "CSS" },
      "children": [
        { "type": "code_block", "attrs": { "language": "css" }, "value": "ui-callout { display: block; }" }
      ]
    }
  ]
}
```

**steps** — Numbered instruction steps.
```json
{
  "type": "steps",
  "children": [
    {
      "type": "step",
      "attrs": { "title": "Install the stylesheet" },
      "children": [
        { "type": "code_block", "attrs": { "language": "html" }, "value": "<link rel=\"stylesheet\" href=\"/css/main.css\"/>" }
      ]
    },
    {
      "type": "step",
      "attrs": { "title": "Add your first component" },
      "children": [
        { "type": "paragraph", "children": [{ "type": "text", "value": "Use custom elements directly in your HTML." }] }
      ]
    }
  ]
}
```


## Extending the Schema

New block types are added to `src/schema/content-schema.js`. The schema definition drives:

1. **Validation** — blocks are validated against the schema on write
2. **Editor** — the block palette shows available types by category
3. **Renderers** — each renderer must handle every block type

When adding a block type, you must add a corresponding entry in every renderer. The test suite validates that all renderers cover all block types.


## Conventions

- Block `type` values are lowercase with underscores: `code_block`, `list_item`
- Attribute names are lowercase with underscores: `author_id`, `src`
- IDs use a `prefix_` followed by a short random string: `doc_abc123`, `author_t1`
- Dates are ISO 8601 date strings: `2026-02-14`
- All string content is unescaped. Escaping is the renderer's responsibility.
