# Vanilla Press step 2: the component system

Date: 2026-11-03 · Status: draft for approval

Builds on step 1, `docs/superpowers/specs/2026-11-02-vp-app-core-design.md`.
Media management, `2026-11-03-vp-media-design.md`, moves to step 3 and
builds on this.

## Intent

Vanilla Breeze is a family, not one package. Besides VB's own ~100
elements, the user has a set of theme-aware web components:

| Package | Element | npm |
|---|---|---|
| `@profpowell/code-block` | `<code-block>`, `<code-block-group>` | 2.9.0 |
| `@profpowell/browser-window` | `<browser-window>` | 1.4.7 |
| `@profpowell/terminal-window` | `<terminal-window>` | 2.1.0 |
| `@profpowell/code-playground` | `<code-playground>` | 0.2.0 |
| `@profpowell/pdf-viewer` | `<pdf-viewer>` | 0.2.0 |
| `@profpowell/bg-wc` | `<bg-wc>` | 0.4.0 (local 0.5.0) |
| `@profpowell/border-wc` | `<border-wc>` | 0.2.0 |
| `@profpowell/marquee-wc` | `<marquee-wc>` | not published (local 1.6.0) |
| `@profpowell/blink-wc` | `<blink-wc>` | not published (local 1.4.1) |
| `@profpowell/image-editor` | `<image-editor>` | 0.1.0 |

A post should be able to use any of them as easily as a paragraph. You
should be able to drop a browser-window demo, a terminal session, a code
playground, a PDF, or something silly like a marquee into a post, see it
working in the editor in the site's theme, and have it work on the live
site.

Today the editor knows a fixed set of hand-built blocks: callout,
collapsible, card, tabs, steps, figure, embed, code. Each new one costs a
schema entry, a renderer case, an editor view and a palette entry.
Hand-building ten more doesn't scale. And the live site doesn't load what
these elements need. thomasapowell.com loads only the VB bundle, so a
`<code-block>` in a post shows as plain text.

The user's direction: integrate VB and its larger ecosystem deeply into the
editor. Media (audio, video, PDF, image editing) is the first big consumer,
so this comes first.

## What exists to build on

- **Element descriptions:** every package above, and VB itself, ships a
  `custom-elements.json` manifest.
  - The manifests list attributes, with types; enum unions give the
    choices.
  - Most don't list slots or what content the element takes.
- **Cook `autoComponents`** (off by default). It scans each built page for
  custom elements and does one of three things:
  - drops the VB bundle when only CSS-only elements are used;
  - with a manifest mapping tags to JS files, writes a per-page import map
    that loads only the elements on that page;
  - otherwise keeps the bundle.
- **Cook `prerender-code-blocks`** renders `<code-block>` at build time with
  `@profpowell/code-block/ssr`, so code is highlighted with no client-side
  work.
- **VP:**
  - VP already depends on `@profpowell/code-block` and uses it in the
    editor.
  - The content schema has a `component` category.
  - The renderer is a `switch` on block type
    (`src/renderers/html.js`).
  - thomasapowell.com copies VB from npm with a `prebuild` vendor script.

## Goals

1. **One generic component block** in the content model. It stores:
   - `tag`: the element name;
   - `attrs`: its attributes;
   - its content, in one of the forms of goal 3.

   It renders to that element in the page HTML, with attributes escaped
   and only those the element declares. The existing hand-built blocks stay
   as they are. Nothing is migrated.
2. **A catalog of the components VP offers.** Each entry names:
   - the npm package;
   - the elements;
   - the JS file that defines each element;
   - for the editor: a label, an icon, a short description, the content
     kind (goal 3), whether it sits in a line of text (inline) or on its
     own (block), default attributes for a new insert, and which
     attributes are hidden as advanced.

   The settings form comes from the package's `custom-elements.json`. The
   catalog only adds what the manifests lack, so a new package joins with a
   catalog entry and no new editor code. The first catalog holds the ten
   packages above, plus VB elements that make sense inside a post (the
   builder proposes the VB list, starting from audio-player, video-player,
   image-gallery, youtube-player, social-embed, foot-notes, accordion-wc,
   carousel-wc, chart-wc, diagram-wc, geo-map, qr-code).
3. **Content kinds,** so each element gets the editing it needs:
   - **none:** settings only, e.g. `<pdf-viewer src>`, `<browser-window
     url>`;
   - **text:** one plain string, e.g. `<marquee-wc>`;
   - **code:** a code string with a language, e.g. `<code-playground>`,
     `<terminal-window>`;
   - **blocks:** rich content edited in place inside the element, e.g.
     `<border-wc>`, `<bg-wc>`, `<browser-window>` used as a frame;
   - **inline:** text inside a paragraph, for inline elements like
     `<blink-wc>`. This needs an inline node type alongside the block one.
4. **Inserting from the editor:**
   - The block palette (the `/` menu) gains the catalog's components,
     grouped and searchable.
   - Inline components are offered from the text selection menu: select
     words and wrap them in `<blink-wc>`.
   - Only components the site has turned on are offered (goal 6).
5. **WYSIWYG in the editor:**
   - A component shows as the real, working element in the site's current
     VB theme, with its JS loaded into the editor. It doesn't show as a
     gray placeholder.
   - Selecting it opens its settings beside it. The form is built from the
     manifest: text, number, checkbox, choice, and a URL field that can pick
     from media once step 3 exists.
   - Edits to the settings update it live.
   - Blocks-kind content is typed into directly. Text and code kinds get an
     input in the settings panel.
6. **Per-site components** (the first piece of the "features" idea):
   - The site screen gains a **Components** section listing the catalog,
     each with on/off, its version, and a short demo.
   - **Turning a component on** adds its package to the site's
     `package.json` dependencies, runs `npm install`, and records it in
     the site's config. Cloudflare installs the same versions from npm, so
     the live build matches.
   - **Turning one off** while a post uses it is refused, with the posts
     listed. Otherwise the package is removed.
   - These changes ride the same backup and commit rules as everything
     else. VP's owned paths grow to include `package.json` and
     `package-lock.json`, staged only when VP made the change.
7. **The live site loads exactly what each page uses**, with no
   site-specific script to maintain:
   - The site's build gets the JS for each enabled component to the output,
     and builds the tag-to-file manifest from the packages themselves.
   - Cook's `autoComponents` loads only the elements on each page.
   - `<code-block>` is prerendered by Cook as today.
   - A page that uses no JS elements ships no component JS.
   - The work goes into Cook, not into each site. I'd extend
     `autoComponents` to read `components: { packages: [...] }` and copy and
     map those packages itself, so every Cook + VB site gets it. That needs
     a Cook release.
8. **Theme aware throughout:**
   - The editor, Preview and the live site render components with the
     site's VB theme and tokens.
   - The catalog test runs each component under the VB base themes and
     checks it renders and responds to a theme change.
   - Packages that don't read VB tokens are listed as follow-ups in their
     own repos.
9. **Safe and honest content:**
   - The schema validates a component block against the catalog and the
     manifest: known tag, declared attributes, values matching
     enum/boolean/number types.
   - Unknown attributes are dropped with a notice, never silently kept.
   - A post that uses a component the site has since turned off shows a
     clear "not on for this site" state in the editor. Publish refuses it
     and names the component.

## Non-goals

- Migrating callout, tabs, steps and the rest to the generic block.
- Components from outside the VB family, and arbitrary npm packages typed
  in by name.
- A raw HTML block.
- Editing a component's CSS custom properties per insert (that belongs to
  theme work, step 4).
- Publishing marquee-wc, blink-wc or bg-wc 0.5.0 to npm. That's the user's
  action with their OTP. The step depends on it for those three on the
  live site.
- Improving the packages' own manifests upstream (follow-ups per repo).
- The media uses: image-editor in the Media screen, and audio, video and
  PDF media types. That's step 3, using this system.

## Anti-goals

- Hand-coding an editor block per component.
- An element that looks right in the editor but is plain text or broken
  on the live site, or the other way round.
- Loading every component's JS on every page.
- A per-site vendor script the user has to keep up to date.
- A component's settings form that accepts values the element ignores or
  breaks on.
- Editor slowdown from loading components the post doesn't use.

## Constraints

- Everything from step 1 holds:
  - Node with no front-end framework;
  - VB for the UI;
  - localhost only;
  - VP stages only its own paths;
  - the site's files in git are the source of truth.
- Post JSON stays readable without VP. A component block is
  `{ "type": "component", "tag": "...", "attrs": {...}, ... }`, and its
  HTML output is the plain element.
- Sites get component code from npm only, at the versions in their
  lockfile.
- The editor gets component code from VP's own install of the same
  packages. When the site's version differs from VP's, the editor uses the
  site's copy from its `node_modules` and VP's catalog hints.
- Cook changes go through Cook's normal release: version bump,
  `npm publish` with the user's OTP, and the site's `cook-ssg` range
  bumped.

## Decided by the user

- Integrate VB and its larger ecosystem deeply into the editor, as
  prebuilt, theme-aware widgets.
- The component system comes before media management.
- The packages in scope are the ten listed above, plus VB's own elements
  (including the audio ones).

## My calls (the user can override)

- **One generic block** driven by `custom-elements.json` plus a catalog of
  editor hints, not a hand-built block per element.
- **Live elements in the editor,** not placeholders.
- **Per-site on/off,** with packages added to the site's `package.json`
  from npm.
- **Per-page loading lives in Cook** (extend `autoComponents`), not in
  per-site vendor scripts.
- **Existing blocks stay hand-built.**
- **Roadmap renumbered:**
  1. core app (done);
  2. components (this document);
  3. media;
  4. themes and features;
  5. new site from a domain;
  6. programs;
  7. analytics;
  8. social.

## Left to the builder

- The catalog's file format and where it lives in VP.
- The settings panel's layout, and how the editor shows a selected
  component.
- How the editor loads component JS (import map, per-component module
  loading) and isolates a component that throws.
- How content kinds map onto ProseMirror nodes.
- The exact VB elements in the first catalog, and their hints.
- Message wording, as long as each failure says what happened and what to
  do.
