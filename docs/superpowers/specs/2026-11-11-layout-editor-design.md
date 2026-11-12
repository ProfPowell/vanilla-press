# Layout editor

Status: draft for review (2026-11-11)
Builds on: `docs/superpowers/specs/2026-11-11-layouts-design.md` (phases 1–3 shipped: format 1,
the checker, inheritance, `data-if`/`data-unless`, regions, the per-document Layout choice).
Repos: `~/src/cook` (layout tree, serializer, preview render) and `~/src/vanilla-press` (the editor).

## Why

The user wants "a very generalized mechanism with a full editor" and asked to get to it quickly. Phases 1–3
fixed the layout format so that hand-written layouts and editor-made layouts are the same files; this is
phase 4: the editor. In the user's words, it "can only open correct layouts either made by it or properly
by hand". The user asked to skip the questions, so every product decision below that the user didn't make
is marked *(my call)*.

Real material exists: thomasapowell.com has seven format-1 layouts (abstract `base`, `page`, `post`,
`essay`, `guide`, `reference`, `landing`) covering every Vanilla Breeze page structure and every region
kind, plus Cook's `starters/vanilla-breeze/` set. Both are the editor's test fixtures.

## What it is

A **Layouts** screen in each site (beside Posts, Media, Programs, Components, Theme), and a layout editor
that opens from it. The editor edits one layout file (or one include) as a tree of blocks from the format-1
vocabulary, with a live preview of a real document rendered through that layout, and saves canonical
format-1 HTML back to `src/layouts/<name>.html` (or `src/includes/<name>.html`).

## Goals

1. List, open, edit, create, duplicate and delete layouts and includes, from the site's Layouts screen.
2. Open only correct layouts (`listLayouts` → `editable: true`); explain why anything else can't open.
3. Edit everything format 1 can express, and nothing it can't: page structure, regions, text with fields,
   images, containers, lists, menus, includes, components, conditions, the head, and the info block.
4. Preview: the layout rendered with a chosen document of the site (or sample values), at desktop and
   narrow widths, updating as you edit.
5. Save: canonical HTML that passes the checker, never overwriting a file changed on disk since it was
   opened.

## Non-goals and anti-goals

- **No new template language or logic.** The editor writes format 1 exactly as the layouts spec defines it.
- **No silent fixing.** A layout that isn't correct is never opened, partly opened or rewritten.
- **No free-form HTML block.** Arbitrary markup is what makes a layout uneditable; Components are the only
  opaque block, as in the format.
- **Not a pixel design tool.** No drag-to-resize grid areas or per-element styling; structure comes from
  Vanilla Breeze page layouts and layout elements, look from the theme and the site's CSS. (VB's
  `vb-composer` can be considered later; not in scope.)
- **Not in scope:** renaming a layout *(my call — renaming means rewriting every document's `meta.layout`
  and every child's `data-template`; deferred)*, editing `src/components/` templates, editing site CSS,
  pagination and tag pages (phase 5 of the layouts spec).
- **Anti-goal:** a save that changes how any other page builds without the user seeing it. Every save shows
  which documents use the layout (and which layouts build on it) before writing.

## Constraints

- Plain vanilla JS / Node / SQLite in VP; ProseMirror for the editing surface (already a dependency);
  no new dependencies in either repo.
- The site's own installed Cook is the authority (layouts ruling P1): VP checks, parses, serializes and
  previews through `cook-ssg/layouts` loaded from the site's `node_modules`. A site whose Cook lacks the
  new exports gets the Layouts screen as a read-only list with the message
  `This site's Cook is too old to edit layouts; update cook-ssg` *(my call)*.
- Existing guarantees hold: Cook sites that use none of this build byte-identically; VP's hand-edit guard
  (refuse to overwrite a file changed on disk) applies to layout files.
- Accessibility matches the post editor: everything works from the keyboard; status is text, not colour.

## The layout tree (Cook)

The editor never manipulates HTML strings. Cook gains a **layout tree**: a plain JSON description of a
format-1 file, the single model both repos share *(my call — it mirrors VP's block AST ↔ ProseMirror split,
and keeps the format's rules in one place, Cook)*.

New exports from `cook-ssg/layouts`:

- `parseLayout(html, { fragment? }) → { ok, tree, problems }` — `tree` only when `checkLayout` passes.
- `serializeLayout(tree) → string` — canonical format-1 HTML.
- `layoutUsage(siteDir) → Promise<Record<layoutName, string[]>>` — every page in `src/` (HTML with front
  matter, markdown, `data-template` on `<html>`/`<body>`) and every layout that names each layout, so VP's
  "Used by" and the Delete refusal count hand-written pages too, not only VP documents *(my call)*.

**Preview** *(my call)*: rather than a new in-memory pipeline (a large refactor that would put the
byte-identity guarantee at risk), VP keeps a **preview working copy** of the site under its own cache
directory (`<workspace>/.vp/layout-preview/<site>/`): the site's `src/`, `config/` and `plugins/` mirrored
(incrementally) with `node_modules` symlinked, unsaved layout/include sources written over it, and the
site's own Cook building it (`cook build`, production) with site plugins included. So the preview is
exactly what `cook build` produces. Nothing is ever written into the site itself. The built `dist/` of
that copy is served by a VP route (`/api/sites/:id/layout-preview/...`), so the preview iframe loads the
page with its real CSS, scripts, components and media. The iframe is sandboxed with `allow-scripts` but
**not** `allow-same-origin` (Vanilla Breeze elements and components run; the page can't reach VP). Large
sites preview more slowly (a full build per refresh); acceptable for now, noted as a follow-up.

Tree shape (exact field names are the builder's, this is the content):

- **Root:** `kind` (`base` | `child` | `fragment`), `info` (label, description, abstract, slots with labels),
  `parent` and body `data-*` variables (child), `pageLayout` (base: a VB value or `"${pageLayout}"`),
  `head` (base: ordered head items — title, meta, link, script, style, base — each with attributes and
  text; field placeholders allowed in text and attribute values; `${slot:head}` as an item).
- **Body:** base → the region elements (`header`, up to two `nav`, `main`, `aside`, `footer`) and include
  blocks in order; child → its blocks plus its `<template slot>` pieces; fragment → its blocks.
- **Blocks** (one node per row of the block table as Cook 2.8.0's checker implements it — the shipped
  checker is the authority wherever it has moved past the first spec): content, slot, text (tag + inline
  runs of text, inline elements, and field placeholders), image (incl. `figure`/`figcaption`), container
  (tag or `layout-*` element + attributes), menu (`ul`/`ol`/`menu` + `li` items, each holding inline runs
  or blocks), include (path), component (tag, attributes, raw inner HTML kept verbatim), comment. Every
  block carries its global attributes, `data-*`/`aria-*`, `data-if` / `data-unless`, and an optional
  **repeat** (source, pipes, alias, index name) — repeating is an attribute any block can carry (an `li`,
  a component, a container…), not a block type.

**Canonical form** *(my call)*: two-space indentation; one block per line; attributes in the order the
format lists them (`data-template`, then `data-page-layout`, then the rest alphabetically, then `data-if` /
`data-unless` last); double-quoted values; the info block first in head (base) or body (child), pretty JSON
with two-space indent; comments kept where they were; component inner HTML and inline `script`/`style`
bodies byte-for-byte. Round-trip tests: for every layout in the starter set and thomasapowell.com,
`parse → serialize → parse` gives the same tree, and building with the serialized file gives the same page
(whitespace aside).

## Vanilla Press

### Layouts screen

- New rail entry **Layouts**. Lists layouts (by label, with file name), then includes, each with status:
  `Editable`, `Can't be edited here: <first problem>` (with **Show all problems**), or `Plain layout: add a
  layout info block to edit it here` for plain files. Each layout shows **Used by N posts** (from
  `meta.layout` and the collection defaults) and **Built on <parent>** / **Base for: …**.
- Actions: **New layout**, **Open**, **Duplicate**, **Delete**.
  - **New layout** asks for a label (the file name is derived, `^[A-Za-z0-9_][A-Za-z0-9_.-]*$`, editable)
    and a start: **Built on <abstract or base layout>** (a child with the parent's `pageLayout` and an
    empty body holding `${content}`), **Copy of <layout>**, or **Blank base** (a base with header, main
    `${content}` and footer). *(my call — Cook's starter set isn't in the npm package, so it isn't offered;
    Copy covers the same need on a site that has layouts.)*
  - **Delete** is refused while any document uses the layout or any layout builds on it; the refusal names
    them. Otherwise it confirms and removes the file.
- Everything goes through server routes that load the site's Cook (P1); none of them take a file path
  from the request except a layout/include name validated by the pattern above.

### The editor

A page of its own (like the post editor), three panes *(my call)*:

1. **Outline / canvas** — the ProseMirror surface showing the layout's blocks as labelled boxes in their
   real nesting: regions as wide bands ("Header", "Main", "Sidebar"…), containers as outlined boxes with
   their VB layout name, text blocks editable in place with fields shown as tokens (`Title`, `Date`,
   `post.title`), the content block as a fixed "Document body goes here" band, slots as "Region: Sidebar"
   bands, lists as a box with a "Repeats for each post in posts (5)" header, includes and components as
   single labelled tiles. The block palette (the same `/` menu as the post editor) offers only blocks valid
   at the caret; drag handles move blocks within valid places.
2. **Inspector** — the selected block's settings: tag/heading level, VB layout element and its attributes
   (gap, ratio…), list source (pick from the site's collections, `programs`, `programAreas.*`, data arrays),
   limit/offset, alias; field picker (document fields, site fields, declared `layouts.fields`, item fields
   inside a list); **Show only when** (`data-if` / `data-unless` with a field or region picker); component
   attributes from VB's `custom-elements.json` when known; `id` / `class` / `aria-label`.
3. **Preview** — an iframe (sandboxed like the Theme preview) of `renderPreview` for a chosen document of
   the site (default: the most recent document using this layout, else the most recent post), with a
   **Desktop / Narrow** width switch. It re-renders after edits settle (debounced) from the unsaved tree.

Above the panes: the layout's **label**, **description**, **page structure** select (the VB page layouts;
for a base also "Chosen by layouts built on this one" = `${pageLayout}`), **Abstract** toggle (base only),
the **Head** button (base only: a dialog listing head items to add, reorder, edit and remove) and **Save**.
The info block's `slots` is maintained automatically from the slot blocks the layout contains; their labels
are edited on the slot blocks *(my call — the checker's "slots must match" rule can then never fail)*.

### Saving and publishing *(my call — modelled on the Theme screen's Apply/Publish)*

- **Save** serializes the tree, re-checks it with the site's Cook, and writes the file only if the check
  passes and the file's hash still matches the one read at open; otherwise it shows the problem (or
  **This layout changed on disk since you opened it** with **Reload**) and writes nothing. A successful
  save is committed locally through the site's git queue (message `Layout: <label>`); `src/layouts/` and
  `src/includes/` files VP wrote join the paths VP owns (`src/app/site-git.js`). Nothing is pushed.
- **Publish layout** pushes the saved layout commits, which redeploys the site. It shows the impact first:
  `Used by N pages; base for: post, essay`, and asks to confirm when N > 0.
- The Layouts screen marks layouts with saved-but-unpublished changes.
- Unsaved changes are guarded on leaving the page (the editor's existing guard).
- After a save, the posts editor's Layout choice and region areas pick up the change on their next load
  (the layouts listing isn't cached).

### Includes

Correct fragments (`<!-- layout-fragment -->` includes) open in the same editor in fragment mode: no head,
no info block, no page structure; the canvas holds their blocks. The preview renders a chosen layout that
uses the include. Plain includes are listed but don't open.

## Phases

1. **Cook:** layout tree, `parseLayout`, `serializeLayout`, `layoutUsage`, round-trip tests on the starter
   set and a copy of thomasapowell.com. Released as a Cook minor version only with the user's OK; until
   then VP is built and tested against a linked local Cook (`node_modules/cook-ssg` → `~/src/cook`), as
   phase 3 of the layouts work did.
2. **VP server:** layout routes (list with usage, read tree, check, save with hash guard and local
   commit, publish, create, duplicate, delete), the preview working copy and its serving route, all via
   the site's Cook.
3. **VP Layouts screen.**
4. **VP layout editor:** schema + tree↔ProseMirror conversion, canvas, palette rules, inspector, head dialog,
   preview pane, save flow.
5. **Includes in fragment mode.**

## Left to the builder

- Exact tree field names and module layout; ProseMirror node names and NodeViews.
- Preview debounce interval and how preview errors are shown (in the preview pane, as text).
- Visual styling of the canvas boxes, within the existing editor look.

## Calls I made (the user skipped the questions)

- One shared layout tree in Cook, with parse / serialize / preview exports; VP converts tree ↔ ProseMirror.
- Canonical serialization rules above; comments, component inner HTML and inline script/style kept verbatim.
- Three panes: canvas, inspector, live preview of a real document.
- New layouts start "Built on…", "Copy of…" or "Blank base"; no starter-set import.
- Rename is out of scope; delete is refused while anything uses the layout.
- Info-block `slots` is derived from the slot blocks, labels edited on the blocks.
- Sites whose Cook lacks the new exports see a read-only list.
- Usage counts every page and layout in the site (Cook `layoutUsage`), not only VP documents.
- Preview = a cached working copy of the site built by its own Cook, served to a script-enabled,
  origin-isolated iframe; never writes into the site.
- Save commits locally; Publish pushes (like Theme). Layout and include files VP wrote become VP-owned
  paths for git.
- Repeat is an attribute on any block, following the shipped 2.8.0 checker.
- Cook release between phases only with the user's OK; VP develops against a linked local Cook.
