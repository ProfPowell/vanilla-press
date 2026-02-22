# Vanilla Press: Hypermedia Rendering

*Addendum to the Vanilla Press vision. This covers how the CMS natively supports hypermedia interactions (html-star), client-side reactivity (montane), and multi-scope rendering — eliminating the awkward fragment handling that plagues every htmx + CMS integration.*

---

## The Problem Everyone Has

The standard htmx integration looks like this:

```python
# Every framework's htmx tutorial, roughly
def post_detail(request, slug):
    post = get_post(slug)
    if request.headers.get('HX-Request'):
        return render('partials/post-body.html', post)
    else:
        return render('pages/post.html', post)
```

Two templates for the same content. Or worse, one template with conditional blocks:

```html
{% if not htmx_request %}
<!doctype html>
<html>
<head>...</head>
<body>
  <header>...</header>
  <main>
{% endif %}

    <article>{{ post.body }}</article>

{% if not htmx_request %}
  </main>
  <footer>...</footer>
</body>
</html>
{% endif %}
```

This is the state of the art and it's terrible. The content doesn't change — only the wrapping does. But template systems can't express "render this content at a different scope" without duplicating or conditionalizing the template itself.

The block AST eliminates this entirely. The content is data. The scope is a rendering parameter. There are no templates to duplicate.


---

## Rendering Scopes

Every piece of content can be rendered at five scopes. The scope is determined by the request, not the content:

```
┌─ page ──────────────────────────────────┐
│  <!doctype html>                        │
│  <html>                                 │
│  <head>...</head>                       │
│  <body>                                 │
│    <site-header>...</site-header>       │
│    <main>                               │
│    ┌─ content ─────────────────────┐    │
│    │  <article>                    │    │
│    │  ┌─ block ──────────────┐     │    │
│    │  │  <ui-callout>        │     │    │
│    │  │    Warning text...   │     │    │
│    │  │  </ui-callout>       │     │    │
│    │  └──────────────────────┘     │    │
│    │  ┌─ block ──────────────┐     │    │
│    │  │  <p>Paragraph...</p> │     │    │
│    │  └──────────────────────┘     │    │
│    │  </article>                   │    │
│    └───────────────────────────────┘    │
│    </main>                              │
│    <site-footer>...</site-footer>       │
│  </body>                                │
│  </html>                                │
└─────────────────────────────────────────┘

┌─ collection ───────────────────────────────┐
│  <article data-doc="post-1">               │
│    <h2><a href="/posts/first/">Title</a></h2>│
│    <p>Excerpt...</p>                       │
│  </article>                                │
│  <article data-doc="post-2">               │
│    <h2><a href="/posts/second/">Title</a></h2>│
│    <p>Excerpt...</p>                       │
│  </article>                                │
└────────────────────────────────────────────┘
```

| Scope | Returns | Use Case |
|-------|---------|----------|
| `page` | Full HTML document with head, chrome, scripts | Browser navigation, initial load, SSG output |
| `content` | `<article>` body, no chrome | html-star page swap, agent fragment |
| `block` | Single rendered block | Inline editing save, partial update |
| `collection` | List of rendered document cards/summaries | html-star list swap, filtered results, pagination |
| `meta` | Document metadata as HTML (title, tags, date) | html-star head update, sidebar refresh |


---

## How This Works with html-star

### Navigation: Full Content Swap

A typical html-star navigation link swaps `<main>` content without a full page load:

```html
<a href="/posts/css-layers/"
   data-star-target="#main"
   data-star-swap="innerHTML">
  CSS Layers Guide
</a>
```

html-star sends the request with a header indicating it wants a fragment. The server returns just the `content` scope — the `<article>` body — and html-star swaps it into `<main>`.

No special template. No conditional wrapping. The renderer just runs at a different scope.

### Filtered List: Collection Swap

A tag filter replaces a post list:

```html
<nav aria-label="Filter by tag">
  <a href="/posts/?tag=css"
     data-star-target="#post-list"
     data-star-swap="innerHTML">
    CSS
  </a>
  <a href="/posts/?tag=components"
     data-star-target="#post-list"
     data-star-swap="innerHTML">
    Components
  </a>
</nav>

<div id="post-list">
  <!-- Collection scope renders here -->
</div>
```

The server queries the content store with the tag filter and returns a `collection` scope render — a list of article cards. No JavaScript filtering. No client-side state. The server does the query, renders the HTML, html-star swaps it in.

### Inline Edit Save: Block Scope

The editor saves a single block and updates it in-place on the published page:

```html
<ui-callout data-block-id="block_abc123" data-variant="warning">
  <p>This API is deprecated.</p>
</ui-callout>
```

On save, the editor posts the updated block AST. The server re-renders just that block at `block` scope and returns the new HTML. html-star swaps the specific element. The rest of the page is untouched.


---

## How This Works with montane

montane handles client-side reactivity — things that don't need a server round-trip. The CMS supports this by rendering markup that montane can bind to.

### Theme Toggle

No server involvement. Pure client-side state via montane:

```html
<div data-montane="{ dark: false }">
  <button data-on:click="dark = !dark">
    Toggle theme
  </button>
  <body data-bind:class="dark ? 'dark' : 'light'">
  </body>
</div>
```

### Search-as-You-Type with Server Backing

montane handles the input reactivity. html-star handles the server query:

```html
<div data-montane="{ query: '' }">
  <input type="search"
         data-model="query"
         data-star-trigger="input changed delay:300ms"
         data-star-get="/search?q={query}"
         data-star-target="#results"/>

  <div id="results">
    <!-- Server returns collection scope HTML -->
  </div>
</div>
```

montane manages the reactive input binding. When the debounced input fires, html-star sends the search query to the server, which queries the content store's full-text search index and returns rendered results at `collection` scope.

### The Boundary

The rule is simple: **if the data changes, it's html-star (server round-trip). If the UI state changes, it's montane (client-side).** The CMS doesn't need to know about montane — it just renders HTML with the right attributes. montane picks them up in the browser.


---

## The Renderer API

The rendering pipeline from the original vision gets a `scope` parameter:

```js
// renderers/html.js

export function render(doc, { scope = 'page', layout, site } = {}) {
  switch (scope) {
    case 'page':
      return renderPage(doc, layout, site);
    case 'content':
      return renderContent(doc);
    case 'block':
      return renderBlock(doc);      // doc is a single block here
    case 'collection':
      return renderCollection(doc); // doc is an array of documents
    case 'meta':
      return renderMeta(doc);
    default:
      return renderContent(doc);
  }
}

function renderPage(doc, layout, site) {
  const body = renderContent(doc);
  return applyLayout(body, doc.meta, layout, site);
}

function renderContent(doc) {
  const blocks = renderBlocks(doc.blocks, { meta: doc.meta });
  return `<article data-doc="${doc.id}">\n${blocks}\n</article>`;
}

function renderBlock(block) {
  const renderer = blockRenderers[block.type];
  return renderer ? renderer(block, {}) : '';
}

function renderCollection(docs) {
  return docs.map(doc => {
    const excerpt = doc.blocks
      .find(b => b.type === 'paragraph');
    const excerptHtml = excerpt
      ? renderBlocks([excerpt], {})
      : '';

    return `<article data-doc="${doc.id}">
  <h2><a href="/${doc.collection}/${doc.slug}/">${escapeHtml(doc.meta.title)}</a></h2>
  ${excerptHtml}
  <time datetime="${doc.meta.created}">${formatDate(doc.meta.created)}</time>
</article>`;
  }).join('\n');
}

function renderMeta(doc) {
  return `<header data-doc-meta="${doc.id}">
  <h1>${escapeHtml(doc.meta.title)}</h1>
  ${doc.meta.description ? `<p>${escapeHtml(doc.meta.description)}</p>` : ''}
  ${doc.meta.tags?.length ? `<ul data-tags="">${doc.meta.tags.map(t => `<li>${t}</li>`).join('')}</ul>` : ''}
  <time datetime="${doc.meta.created}">${formatDate(doc.meta.created)}</time>
</header>`;
}
```


---

## Request Routing

### Scope Negotiation

The scope is determined by a combination of request headers and the Accept type. This replaces the clumsy `HX-Request` boolean check with proper content negotiation:

```js
// routing/negotiate.js

export function negotiateResponse(request) {
  const accept = request.headers.get('accept') || '';
  const starRequest = request.headers.get('X-Star-Request');    // html-star header
  const starTarget = request.headers.get('X-Star-Target');      // what element is being swapped

  // Agent wants markdown
  if (wantsMarkdown(accept)) {
    return { format: 'markdown', scope: 'content' };
  }

  // API consumer wants JSON
  if (wantsJson(accept)) {
    return { format: 'json', scope: 'content' };
  }

  // html-star fragment request
  if (starRequest) {
    return { format: 'html', scope: inferScope(starTarget, request) };
  }

  // Full page for browsers
  return { format: 'html', scope: 'page' };
}

function inferScope(target, request) {
  // If targeting main content area, return content scope
  if (target === '#main' || target === 'main') return 'content';

  // If targeting a specific block, return block scope
  if (target?.startsWith('[data-block-id=')) return 'block';

  // If targeting a list container, return collection scope
  if (target === '#post-list' || request.url.includes('?')) return 'collection';

  // Default to content
  return 'content';
}

function wantsMarkdown(accept) {
  const types = accept.split(',').map(t => t.trim().split(';')[0]);
  const mdIdx = types.findIndex(t => t === 'text/markdown' || t === 'text/plain');
  const htmlIdx = types.findIndex(t => t === 'text/html');
  return mdIdx !== -1 && (htmlIdx === -1 || mdIdx < htmlIdx);
}

function wantsJson(accept) {
  const types = accept.split(',').map(t => t.trim().split(';')[0]);
  const jsonIdx = types.findIndex(t => t === 'application/json');
  const htmlIdx = types.findIndex(t => t === 'text/html');
  return jsonIdx !== -1 && (htmlIdx === -1 || jsonIdx < htmlIdx);
}
```

### Static vs Dynamic

There's a spectrum here and the system should support both ends:

**Fully static (SSG mode):** The publisher pre-renders every scope into files at build time:

```
_site/
├── posts/first-post/
│   ├── index.html              # page scope
│   └── _fragment.html          # content scope
├── md/posts/first-post/
│   └── index.md                # markdown
├── api/posts/first-post.json   # json
├── _collections/
│   ├── posts.html              # full post list, collection scope
│   └── posts/
│       ├── tag-css.html        # filtered by tag
│       └── tag-components.html
```

The Cloudflare worker maps scope to file path. No runtime rendering. Everything is cached at the edge.

This works for most content sites. The limitation: you can't do arbitrary queries (search, multi-faceted filtering) without pre-generating every permutation.

**Hybrid (SSG + dynamic endpoints):** Static pages for published content, dynamic Cloudflare Worker routes for queries that can't be pre-generated:

```js
// _worker.js

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const negotiated = negotiateResponse(request);

    // Search endpoint — always dynamic
    if (url.pathname === '/search') {
      return handleSearch(url.searchParams.get('q'), env, negotiated);
    }

    // Static content with scope routing
    const staticPath = resolveStaticPath(url, negotiated);
    const response = await env.ASSETS.fetch(new Request(new URL(staticPath, request.url)));

    if (response.ok) {
      return addHeaders(response, negotiated);
    }

    // Fallback to full page
    return env.ASSETS.fetch(request);
  },
};

function resolveStaticPath(url, { format, scope }) {
  const path = url.pathname;

  if (format === 'markdown') {
    return `/md${path}${path.endsWith('/') ? '' : '/'}index.md`;
  }

  if (format === 'json') {
    return `/api${path.replace(/\/$/, '')}.json`;
  }

  if (scope === 'content') {
    return `${path}${path.endsWith('/') ? '' : '/'}${path.endsWith('/') ? '' : '/'}`.replace(/\/+$/, '/') + '_fragment.html';
  }

  if (scope === 'collection') {
    const tag = new URL(`https://x${url.search}`).searchParams.get('tag');
    if (tag) return `/_collections${path}tag-${tag}.html`;
    return `/_collections${path.replace(/\/$/, '')}.html`;
  }

  return path;
}

async function handleSearch(query, env, negotiated) {
  // Query D1 full-text search
  const results = await env.DB.prepare(
    'SELECT d.* FROM documents_fts f JOIN documents d ON f.rowid = d.rowid WHERE documents_fts MATCH ? LIMIT 20'
  ).bind(query).all();

  const docs = results.results.map(r => ({
    ...r,
    meta: JSON.parse(r.meta || '{}'),
    blocks: JSON.parse(r.blocks),
  }));

  if (negotiated.format === 'json') {
    return new Response(JSON.stringify(docs), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Render as collection scope HTML
  const html = renderCollection(docs);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Vary': 'Accept, X-Star-Request',
    },
  });
}

function addHeaders(response, { format }) {
  const headers = new Headers(response.headers);
  headers.set('Vary', 'Accept, X-Star-Request');

  if (format === 'markdown') {
    headers.set('Content-Type', 'text/markdown; charset=utf-8');
  }

  return new Response(response.body, { headers });
}
```


---

## Publisher Updates

The static publisher from the original vision now generates fragment outputs alongside full pages:

```js
// build/publish.js (updated)

for (const doc of docs) {
  const full = getDocument(db, collection, doc.slug);
  const url = `/${collection}/${doc.slug}/`;

  // Full page
  const htmlBody = render(full, { scope: 'content' });
  const htmlPage = render(full, { scope: 'page', layout: collection, site });
  write(`_site${url}index.html`, htmlPage);

  // Content fragment for html-star swaps
  write(`_site${url}_fragment.html`, htmlBody);

  // Markdown for agents
  const markdown = renderMarkdown({ ...full, meta: { ...full.meta, url: `${site.url}${url}` } });
  write(`_site/md${url}index.md`, markdown);

  // JSON for API consumers
  write(`_site/api/${collection}/${doc.slug}.json`, JSON.stringify(full, null, 2));
}

// Collection outputs
for (const collection of collections) {
  const allDocs = listCollection(db, collection);
  const collectionHtml = render(allDocs, { scope: 'collection' });
  write(`_site/_collections/${collection}.html`, collectionHtml);

  // Tag-filtered collections
  const allTags = [...new Set(allDocs.flatMap(d => d.meta?.tags || []))];
  for (const tag of allTags) {
    const filtered = allDocs.filter(d => d.meta?.tags?.includes(tag));
    write(`_site/_collections/${collection}/tag-${tag}.html`,
      render(filtered, { scope: 'collection' }));
  }
}
```


---

## The Complete Request Matrix

Every URL, every consumer, one content source:

| Consumer | Accept / Header | Scope | Response |
|----------|----------------|-------|----------|
| Browser (navigate) | `text/html` | `page` | Full HTML document |
| html-star (swap main) | `text/html` + `X-Star-Request` | `content` | `<article>` fragment |
| html-star (swap list) | `text/html` + `X-Star-Request` | `collection` | List of article cards |
| html-star (swap block) | `text/html` + `X-Star-Request` | `block` | Single re-rendered block |
| LLM agent | `text/markdown` | `content` | Markdown with frontmatter |
| API client | `application/json` | `content` | Block AST + metadata |
| RSS reader | `/feed.xml` | (dedicated) | Atom/RSS feed |
| Agent index | `/llms.txt` | (dedicated) | Content directory |

One content store. One block AST. One schema. Six output formats. The rendering scope is a function parameter, not a code path.


---

## What html-star and montane Need from the CMS

### html-star needs:

1. **Fragment endpoints** — content scope renders, pre-generated as static files or served dynamically
2. **Consistent element IDs** — `data-doc`, `data-block-id` attributes on rendered output so swap targets are predictable
3. **Collection endpoints** — filtered/paginated lists as HTML fragments
4. **Head metadata** — title and description fragments for `document.title` updates on navigation

### montane needs:

Nothing from the CMS. montane is client-side reactivity. The CMS just needs to render markup with the right `data-montane`, `data-on:*`, and `data-bind:*` attributes. These go in the layout templates, not in the content blocks. Content is content. UI reactivity is chrome.

The clean separation: **content comes from the block AST via renderers. Interactivity comes from html-star (server) and montane (client). The CMS handles the first. The layout templates wire up the second.**


---

## Revised Architecture Diagram

```
                         Request
                            │
                            ▼
                   ┌─────────────────┐
                   │  Cloudflare     │
                   │  Worker         │
                   │                 │
                   │  Negotiates:    │
                   │  • Accept hdr   │
                   │  • X-Star-*     │
                   │  • URL params   │
                   └────────┬────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
         ┌─────────┐  ┌─────────┐  ┌──────────┐
         │ Static  │  │ Static  │  │ Dynamic  │
         │ HTML    │  │ MD/JSON │  │ D1 Query │
         │         │  │         │  │          │
         │ page or │  │ agent   │  │ search,  │
         │ fragment│  │ output  │  │ filter   │
         └─────────┘  └─────────┘  └──────────┘
              │             │             │
              └─────────────┼─────────────┘
                            │
                            ▼
              ┌──────────────────────────┐
              │  Content Store (SQLite)  │
              │                          │
              │  block AST → renderer    │
              │  scope: page | content   │
              │         block | collection│
              │  format: html | md | json│
              └──────────────────────────┘
```
