# Layouts: one format for hand-written and editor-made page templates

Status: draft for review (2026-11-11)
Repos: `~/src/cook` (format, checker, Cook features, starter set) and
`~/src/vanilla-press` (per-document layouts, regions, the layout editor).

## Why

Vanilla Press (VP) edits content only. Every page's chrome comes from Cook
layouts in the site repo, chosen per collection (`posts` → `post`,
`pages` → `page`). A document can't pick a layout or put anything outside
its body, and nothing in VP can make or change a layout.

The user wants "a very generalized mechanism with a full editor" and wants
to "get there quickly". For now **the user writes the layouts by hand**.
Later a layout editor in VP makes the same files. In the user's words:
the editor "can only open correct layouts either made by it or properly by
hand."

That decides the shape of the work. A **layout format** comes first. It
is plain Cook HTML with a small, fixed vocabulary, and a **checker** says
whether a file follows it. Hand-written layouts follow it from day one.
The editor comes last and is a visual way to make those same files. It
adds no new ideas.

## What exists today (and is kept)

- **Cook layouts** are full HTML documents in `src/layouts/<name>.html`.
  - Placeholders: `${content}`, `${title}` and other `${var}`s, and
    `${slot:name}`.
  - A page fills a slot with `<template slot="name">…</template>`.
  - Shared pieces come in with `<div data-include="/includes/x.html">`.
  - Lists come from `data-repeat="collections.blog | limit:5 as post"`.
  - Custom elements are expanded from `src/components/`.
  - A page picks its layout with `layout:` front matter or
    `data-template` on `<html>`/`<body>`
    (`scripts/plugins/apply-template.js`).
  - Gaps: no layout inheritance, no conditionals, no collection default
    layout, no pagination, no tag pages.
- **VP writes** `src/<path>/<slug>.html`: front matter (`title`,
  `description`, `date`, `published`, `updated`, `author`, `tags`,
  `image`, `theme`, `themeScope`, `layout`, `slug`, `vp_id`) followed by
  the rendered body. The layout comes from the collection config
  (`src/sync/paths.js`).
- **Vanilla Breeze (VB)** page structure:
  - `data-page-layout` on `<body>` gives one of: `""`/`stack`,
    `sidebar-left`, `sidebar-right`, `holy-grail`, `app-shell`,
    `dashboard`, `article`, `landing`.
  - Direct children `header`, `nav` (up to two), `main`, `aside` and
    `footer` place themselves.
  - Inner layout uses `layout-*` elements or `data-layout` values.
- **VB's Astro and Eleventy "support"** is two copy-in starter kits. There
  is no Cook kit.

## Goals

1. **One layout format (format 1).** Layouts in it build with Cook, can be
   written by hand, and are what the editor reads and writes.
2. **A checker,** shared by Cook, VP and a command line. It says whether a
   layout is correct, why not (with line numbers), and what the layout
   offers: its regions, fields and parent.
3. **The Cook features layouts need:** inheritance, and conditional
   sections.
4. **Per-document layouts in VP:** a layout choice for each document, and
   an editable block area for each region the layout offers.
5. **A VB starter set in format 1** (base, page, post, docs, landing). It
   is the user's starting point, Cook's VB integration kit, and the
   editor's test material.
6. **The layout editor** (last phase): open, edit and create correct
   layouts and includes, with a live preview.

## Non-goals and anti-goals

- **No new template language.** No loops beyond `data-repeat` and no
  logic beyond `data-if`/`data-unless`. If a layout needs more, it isn't a
  format-1 layout. It still builds with Cook; the editor just won't open
  it.
- **Existing sites must not change.** Every Cook addition is opt-in. A
  site that uses none of it builds byte-identically. thomasapowell.com and
  the VB docs site are the regression checks.
- **The editor never opens an incorrect layout.** It doesn't half-open it
  and it doesn't "fix" it silently.
- **Not in this design:** a drag-the-grid-areas visual composer (VB's
  `vb-composer` lab may slot in later), and editing layouts outside VP.

## The layout format (format 1)

A layout is one HTML file in `src/layouts/`. It is either a **base**
layout (a whole document) or a **child** layout (built on a parent).
Includes in `src/includes/` can also be **fragments** in the same
vocabulary.

### Layout info

Every correct layout carries one info block. The editor writes it, and a
hand author adds it to say "this layout is format 1":

```html
<script type="application/json" data-layout-info>
{ "format": 1, "label": "Blog post", "description": "A dated article with an optional sidebar.",
  "abstract": false, "slots": { "aside": { "label": "Sidebar" } } }
</script>
```

- In a base layout it goes in `<head>`. In a child it is the first child
  of `<body>`.
- Cook removes it from output.
- `abstract: true` means the layout exists only to be extended, so VP
  doesn't offer it to documents.
- `slots` labels the slots the layout fills from the document. Every
  `${slot:x}` the layout uses must appear here, and nothing else may.
- **`head` is a reserved slot.** A base may put `${slot:head}` last in
  `<head>`. A child fills it with `<template slot="head">`, which may hold
  only head items (`meta`, `link`, `script`, `style`). That's how a child
  adds `og:` meta or a stylesheet. Documents don't fill it.
- A file without an info block is a **plain layout**. It builds and VP can
  pick it, but it isn't format 1.

### Base layout shape

```html
<!doctype html>
<html lang="en">
<head>
  <script type="application/json" data-layout-info>{…}</script>
  <meta charset="utf-8">
  <title>${title} · ${siteTitle}</title>
  <link rel="stylesheet" href="/assets/css/vanilla-breeze.css">
</head>
<body data-page-layout="${pageLayout}">
  <div data-include="/includes/header.html"></div>
  <main>${content}</main>
  <aside data-if="slot:aside">${slot:aside}</aside>
  <div data-include="/includes/footer.html"></div>
</body>
</html>
```

- **`<head>`** may contain only `meta`, `link`, `title`, `script`, `style`
  and `base`. Text and attribute values may use fields. The editor treats
  each one as an item in a list. Inline `script` and `style` are edited
  as code.
- **`<body>`** has `data-page-layout` set to one of the VB values above,
  or to `${pageLayout}` so a child can choose it (see Inheritance).
- **Body children** may be `header`, `nav` (two at most), `main` (exactly
  one), `aside`, `footer`, or include blocks.

### Child layout shape

```html
<body data-template="base" data-page-layout="article">
  <script type="application/json" data-layout-info>{…}</script>
  <article>
    <h1>${title}</h1>
    <p data-if="date"><time datetime="${date}">${date}</time></p>
    ${content}
  </article>
  <template slot="aside">${slot:aside}</template>
</body>
```

- The body's blocks become the parent's `${content}`.
- `<template slot="x">` fills the parent's slot `x`.
- Other `data-*` attributes on `<body>` become parent variables, as Cook
  already does for pages. `data-page-layout="article"` becomes
  `${pageLayout}`.

### The block vocabulary

Inside `main`, `header`, `nav`, `aside`, `footer`, a child body, slot
templates and fragments, every element must be one of the blocks below.
Blocks nest where the table says so.

Any block may carry `id`, `class`, `aria-*`, `role`, `lang`, `data-if`,
`data-unless`, and VB attributes (`data-layout*`, `data-*` state). The
checker ignores whitespace, attribute order and quote style.

| Block | Markup | Holds |
|---|---|---|
| Content | `${content}`, exactly once per layout, inside `main` (base) or the child body | — |
| Slot | `${slot:name}`, alone inside its parent element | — |
| Field | Text or attribute values containing `${field}`, on a text-level element (below) | text, fields |
| Text | `h1`–`h6`, `p`, `small`, `figcaption`, `blockquote`, with static text and the inline elements `a`, `strong`, `em`, `span`, `time`, `br`, `img`, `abbr`, `code` | text, fields |
| Image | `img`, `picture`/`source`, or `figure` around them, with static or field `src`/`alt` | — |
| Container | VB `layout-*` elements, or `div`/`section`/`article`/`header`/`footer`/`nav`/`aside` that carry `data-layout` or are sectioning elements | blocks |
| List | Any container or `ul`/`ol`/`menu` with `data-repeat="<source> \| pipes as item"`; inside it, `${item.x}` fields | blocks |
| Menu | `ul`/`ol`/`menu` without `data-repeat`, whose children are `li`; an `li` holds Text-level content (so `<li><a href="/about/">About</a></li>`) or blocks | `li` |
| Include | `<div data-include="/includes/x.html"></div>` | — |
| Component | Any custom element (hyphenated tag), including Cook components and VB elements; attributes and inner HTML are kept as they are | opaque |
| Comment | `<!-- … -->` | — |

- **List sources:** `collections.<name>`, `programs`,
  `programAreas.<area>`, and top-level arrays in `config/data.js`.
- **Fields:**
  - document fields: the front-matter keys VP writes, plus `url`,
    `imageAlt` (new, see VP) and `pageLayout`, plus any extra keys the
    site lists in `config/main.js` as `layouts: { fields: ['ogImage', …] }`
    (for hand-written front matter; checked by the command too);
  - site fields: the top-level keys of the site's `config/data.js`;
  - item fields, inside a list.

  An unknown field is an error, so typos are caught.
- **`data-if` / `data-unless`** take one key: a field, `slot:name`, or
  `item.x`. A key is false when it is missing, `""`, `[]` or `false`; the
  element is removed or kept on that basis.
- Anything else (a bare `div`, `table`, `form`, an element with inline
  event handlers, `${…}` expressions that aren't a plain key) makes the
  layout incorrect. The checker reports each problem as
  `file:line: <problem>`.

### Includes as fragments

An include file that contains only blocks from the vocabulary, plus at
most one `header`, `nav` or `footer` wrapper, is a correct **fragment**.
The editor can open it. Includes are still not parameterised.

## The checker

It lives in Cook as a new export, `cook-ssg/layouts`, built on linkedom,
which Cook already depends on. Signatures are the builder's to finalise;
this is the contract:

- `checkLayout(html, { fields, lists, parentInfo? })` returns
  `{ ok, kind: 'base'|'child'|'fragment'|'plain', info, parent, slots, fields, problems: [{ line, message }] }`.
  - Slots and fields are reported **even for plain and incorrect
    layouts**, from a best-effort scan, so VP can offer regions for any
    layout.
- `listLayouts(siteDir)` returns every layout with its check result and
  resolves inheritance. **Slots are forwarded explicitly**: a document
  can fill only the slots of the layout it names, so a child that wants
  a parent's `aside` to be fillable writes
  `<template slot="aside">${slot:aside}</template>` and lists `aside` in
  its info. A forwarded slot that the document left empty counts as
  empty, so the parent's `data-if="slot:aside"` removes the aside.
  `listLayouts` also reports cycles and missing parents.
- **"Correct" belongs to the whole chain.** A layout is editable only if
  it and every parent above it are format 1. A format-1 child of a plain
  parent is reported as "built on a plain layout (`name`)". VP still
  offers regions for any layout from the best-effort slot scan.
- `cook check-layouts` checks every layout and include in the current
  site and prints `file:line: message`. It exits 1 on any problem in a
  file that has an info block. Plain layouts are listed as "plain" and
  aren't failures.
- **Round-trip property** (it's a test): for every correct layout,
  parse → serialize → parse gives the same tree, and a Cook build with the
  original and with the serialized file gives the same page apart from
  whitespace.

## Cook additions

All are opt-in, in `~/src/cook`, as a minor release. Publishing to npm
needs the user's OK.

1. **Layout inheritance.**
   - A layout whose `<html>` or `<body>` has `data-template="parent"` is
     applied, and its result is then applied to the parent. Its body
     becomes the parent's `${content}`, its `<template slot>`s fill the
     parent's slots, and its `data-*` attributes become variables.
   - Depth is at most 5. A cycle is a build error that names the chain.
   - It works for HTML pages and for markdown pages, which load layouts
     separately in `process-markdown.js`.
   - Page content that contains `<main>`, `<template>` or `${` must never
     be re-parsed as layout structure. Apply on the parsed child, not by
     re-scanning the filled output.
2. **Conditional sections.**
   - `data-if="key"` / `data-unless="key"` remove or keep an element, then
     the attribute is stripped.
   - They must work for page fields, slots, site fields and list items.
     Note that today HTML-page layouts see global data only in a later
     pass, so the builder places evaluation where all four are known.
3. **Info block stripping,** and the checker and command above.
4. **Later, independent, as needs arise:**
   - a default layout per collection (`config/main.js`);
   - pagination for a list page;
   - generated tag pages.

   None is needed by VP, which always writes `layout:`. They are sketched
   only and get their own short design when wanted.

## VB starter set

- **Location:** `~/src/cook/starters/vanilla-breeze/` (my call; VB's repo
  can link to it later). It holds layouts, includes, a sample
  `config/data.js`, and a few sample pages.
- **Layouts:**
  - `base`: abstract, owns `<head>` and the header/footer includes;
  - `page`: `data-page-layout="stack"`;
  - `post`: `article` page layout, title/date/author/featured image
    fields, tags, `aside` slot;
  - `docs`: `sidebar-left`, `nav` slot;
  - `landing`: `landing`, `hero` and `cta` slots.
- **Includes:** `header`, `footer` and `site-nav`, all correct fragments.
- **Tests:** every file passes `cook check-layouts`, and the sample site
  builds to the expected pages.
- Its post and page layouts must accept what VP writes today, so a VP
  site can switch to it without content changes.

## Vanilla Press: per-document layouts and regions

- **Layout choice.**
  - Documents gain an optional `meta.layout`. Front matter `layout` is
    `meta.layout` if set, otherwise the collection layout.
  - Document settings get a **Layout** choice listing the site's
    non-abstract layouts:
    - format-1 layouts by `info.label`;
    - plain layouts by filename;
    - the default first, as "Collection default (post)".
  - VP reads the site's layouts with `listLayouts`, using its own
    `cook-ssg` dependency, and re-reads them when the files change.
  - **The site's Cook must be new enough.** VP reads the version of
    `cook-ssg` the site has installed. If it is older than the release
    with inheritance and conditionals, the Layout choice and regions
    still show, with a warning ("This site's Cook is too old for layouts
    built on other layouts; update cook-ssg"), and child layouts are
    marked unusable. VP never upgrades the site's Cook.
- **Regions.**
  - Documents gain `regions: { [slotName]: Block[] }`, saved in the
    content JSON.
  - Under the main body, the editor shows one labelled block area for
    each slot the chosen layout offers (labels from `info.slots`, or the
    slot name).
  - Region content uses the same blocks as the body.
  - **Switching layouts never deletes region content.** Regions the
    current layout doesn't offer are kept and shown, collapsed, as "Not
    shown by this layout".
- **Publishing.** Each non-empty region the layout offers is written as
  `<template slot="name">…rendered…</template>` before the body, in the
  published HTML.
- **Every content walk includes regions.** That means media "Used in",
  alt check, search, link checks and the editor's word count. This list
  is the builder's to complete by grepping for walks over `doc.blocks`.
- **Featured image alt.** Front matter gains `imageAlt`, so layouts can
  write `alt="${imageAlt}"`.

## The layout editor (last phase)

The requirements are fixed here. Its screens get a short design pass when
the phase starts.

- **A Layouts screen per site.** It lists layouts and includes with their
  status: "Editable", or "Can't be edited here: `<first problem>`" with a
  "Show all problems" option. It can create a new layout, either from a
  starter-set layout or as "Built on <parent>".
- **Editing.**
  - The editor is a tree of blocks from the vocabulary. You add a block
    from a palette that offers only blocks valid at that point.
  - Each block has an inspector:
    - fields: a picker of known fields;
    - lists: source, limit, offset and item fields;
    - conditionals: show only when…;
    - VB layout elements: their attributes;
    - components: attributes from VB's `custom-elements.json` when
      known, otherwise raw attributes.
  - A live preview renders the layout with Cook and a chosen real
    document of the site.
  - Undo and redo, fully usable from the keyboard.
  - My call: reuse the ProseMirror editor with a layout schema, since the
    palette, drag handles and current-block highlight already exist.
- **Saving.**
  - The editor saves canonical format-1 HTML, and the saved file must
    pass the checker. Hand formatting is not kept; comments are.
  - If the file changed on disk since it was opened, the save is refused
    and the editor offers to reload. A hand edit is never overwritten
    unseen.
  - Saving changes only the one file.

## Phases

1. **Cook:** format 1, the checker and command, inheritance, conditionals,
   info stripping.
2. **Cook:** the VB starter set.
3. **VP:** layout choice, regions, `imageAlt`, region-aware content walks.
4. **VP:** the layout editor.
5. **Cook, when wanted:** collection default layouts, pagination, tag
   pages.

Phases 1–3 let the user write layouts by hand against a stable format.
Phase 4 builds directly on the checker's parse tree.

## Left to the builder

- Function signatures and module layout inside Cook and VP.
- Where conditional evaluation sits in Cook's pipeline, within the
  constraint above.
- Canonical serialization details: indentation and attribute order.
- The exact error message wording, in plain language with line numbers.

## Calls I made (for the user to check)

- The info block is a JSON `<script>` that Cook strips. It is required for
  "correct".
- A child layout is a `<body data-template>` file, reusing Cook's existing
  page mechanism. Its `data-page-layout` reaches the base as
  `${pageLayout}`.
- Unknown fields are errors.
- Includes that fit the vocabulary are editable fragments.
- The starter set lives in the Cook repo.
- Region content survives layout switches.
- The editor is built on ProseMirror.
- Collection default layouts, pagination and tag pages are deferred.
- Menus (`ul`/`ol`/`menu` with `li`) are a block, so a nav can be
  hand-written, not only repeated.
- Sites can add document fields in `config/main.js`
  (`layouts.fields`), so hand-written front matter like `ogImage` checks.
- Slots are forwarded explicitly, child by child. `head` is a reserved
  slot a child may fill.
- "Correct" means the whole chain is format 1.
- VP warns, and doesn't upgrade, when the site's Cook is too old.
