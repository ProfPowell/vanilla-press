# Vanilla Press step 3a: the new look

Date: 2026-11-07 · Status: draft for approval

Builds on step 1 (`2026-11-02-vp-app-core-design.md`) and step 2
(`2026-11-03-vp-components-design.md`). Step 3b, media
(`2026-11-03-vp-media-design.md`), is built inside this look afterwards.

The visual spec is `docs/design/README.md` and its mockups in
`docs/design/mockups/`. This document doesn't repeat them. It says what
this step builds from them, what it leaves for later, and the decisions
the mockups don't make.

## Intent

The app works but looks like a developer tool. The user designed it as a
**quiet writing tool**:
- the post dominates, and the controls recede;
- one primary action per screen;
- Vanilla Breeze tokens throughout.

The user wants the new look in place before media, so the Media screen is
built once, in the final design.

## Decided by the user

- **Order:** step 3a is the new look: app shell, Sites, Posts and editor.
  Step 3b is media, built into it. The Theme screen and per-post page
  themes stay in step 4.
- **The editor gets the full redesign:**
  - the title is an editable H1 in the document;
  - a floating toolbar over the selection replaces the fixed toolbar;
  - `+` and drag handles sit in the gutter;
  - Unpublish moves to a "⋯" menu;
  - Post settings is a toggleable side panel.
- **Media design changes (for 3b, recorded here):**
  - no "Replace file";
  - keep the "Decorative (alt="")" checkbox from the mockup;
  - keep my "Missing file" filter, which the mockup lacks.

## Goals

1. **Tokens and type.**
   - All new and restyled CSS uses the VB tokens in the README's token
     table. No hex values.
   - It stays under the existing `@layer` setup in `app/assets/app.css`
     and `editor/assets/css/*.css`.
   - App controls use `--font-sans`; writing and titles use
     `--font-serif`; paths and slugs use `--font-mono`.
   - Contrast is at least 4.5:1. Primary controls are at least
     `--size-touch-min`.
2. **Sites screen** (`Main.dc.html`):
   - a top bar with the wordmark and the local address;
   - site cards with name, path, published/draft counts (the `posts`
     collection, matching the Posts screen), Git status and last backup;
   - the data comes cheaply from `/api/sites`, without opening each site.
     It gains per site:
     - `siteUrl`;
     - `lastBackupAt`, read from git: the time of the last commit VP made
       that is on the remote. Today's value is in memory and lost on
       restart;
     - `ahead` and `behind` counts against the remote branch's last fetch.
       "In sync" means both are 0;
   - actions "View live ↗" and "Open" on each card;
   - "Clone from GitHub" and "Add site" at the top.

   The existing add, clone and folder-browser panels keep their behavior
   and are restyled to match.
3. **Site shell** (shared rail):
   - "← All sites", the site name and "View live site ↗" (hidden when the
     site has no live URL);
   - sections become addressable as `site.html?id=…&section=media`, so
     Back and links work, with `aria-current="page"` on the current one;
   - nav: Posts, Media, **Components**, Theme (my call: Components shipped
     in step 2, so it stays in the nav);
   - a "Coming later" group with Programs, Analytics and Social, shown
     disabled and not as buttons;
   - sync and backup status pinned to the bottom (`role="status"`).

   The rail stacks above the content at phone width. Media and Theme keep
   their "coming soon" bodies until 3b and step 4, restyled. One
   exception: the **Theme** section hosts today's theme picker, restyled,
   because it is the only UI that sets the site theme. Step 4 replaces it
   with the full Theme screen.
4. **Posts** (`Site.dc.html`):
   - "Preview site" and "New post" in the header;
   - All / Published / Drafts filters with counts (`aria-pressed`), plus
     search by title and description;
   - rows with a serif title, a one-line description ("No description" in
     italic when it's empty), the path in mono, status with a dot, and the
     date. The whole row links to the editor;
   - an empty state for each filter;
   - "Preview site" opens the site's dev server (`previewUrl`), with
     today's "run npm run dev" message when it's down.
5. **Editor top bar** (`Editor.dc.html`):
   - "← Posts", the site name, and a save-state pill: "Saved · not live
     yet" in warning colors for published posts with unpublished edits,
     plain otherwise;
   - Preview, a Post settings toggle (`aria-pressed`), and "⋯";
   - the primary action: Publish for drafts, Update for published posts;
   - "⋯" is a menu (`role="menu"`, arrow keys, Escape) holding:
     - Export JSON, Show block tree (AST) and View live page;
     - **Delete post…**, which today lives in the doc browser;
     - Unpublish… (danger).
   - Unpublish runs immediately today. It gains an in-page confirmation
     naming the live URL that will go away. Delete gets the same, and
     refuses a published post until it is unpublished. No browser dialogs.
   - The action state ("Publishing…", then a "Live ↗" link) shows next to
     the primary button.
   - The site name comes from the site record (`/api/sites`).
   - The publish/update report and its errors keep their current behavior,
     restyled.
6. **Title in the document:**
   - The post's title is the first line of the writing area, an H1 in
     the serif face, below a meta line ("Published Nov 3, 2026 · posts",
     or "Draft · posts"), as in the mockup.
   - It edits `meta.title`. It is not a block in the stored AST, so post
     JSON and rendered HTML don't change.
   - Enter in the title moves to the first block. Backspace at the start
     of the first block moves into the title. The title holds plain text
     only: no marks, and no pasted blocks.
   - Slug auto-follows the title only while the post has never been
     published and the slug hasn't been edited by hand. This is a fix:
     today, retitling a published post rewrites its slug and changes its
     live URL.
   - New posts start with an empty title and an "Untitled" placeholder.
     Lists still show "Untitled" for an empty title.
   - This is the riskiest editor work. Prototype it first: Enter,
     Backspace, undo, paste and selection across the title/body edge.
7. **Formatting without a fixed toolbar:**
   - **Floating toolbar** over a non-empty text selection: Bold, Italic,
     Inline code, Highlight, Link, then More. More holds the current
     toolbar's other inline marks and the "wrap in inline component" entry
     from step 2.
     - It is a `role="toolbar"` with arrow-key navigation.
     - It is reachable from the keyboard: my call is Alt+F10, the common
       editor convention.
     - It never covers the selected text.
   - **Gutter handles** on the hovered or cursor block. "The block" is the
     top-level block. Inside a list, tabs or callout, the handles and the
     keyboard move act on the innermost item that can move within its
     parent:
     - `+` opens the block palette, inserting after that block;
     - the drag handle moves the block by dragging, or with the keyboard:
       my call is Alt+Shift+↑/↓ on the cursor block, so moving doesn't
       need a mouse.
   - **Empty line hint** "Type / for blocks". It is a placeholder only and
     is never stored.
   - Lift (Mod+[) and the other toolbar commands keep their shortcuts,
     and appear in More.
   - Block types the fixed toolbar used to set (headings, lists, quote,
     code) come from the palette and the existing Markdown-style input
     rules.
   - Blockquotes render headings at normal heading sizes.
8. **Post settings panel** (right side, toggleable, remembered per
   browser):
   - a publishing status box replaces the Status dropdown;
   - URL, with the `/posts/` prefix shown;
   - Description, with its hint;
   - Tags;
   - Collection, as a select filled from the site's `collections` config.
     It keeps the current value even when that value isn't in the list.
   - an Appearance section reading "Page theme: site theme". Its action
     arrives in step 4.

   Component settings from step 2 move into this panel: my call is a
   "Component" section that appears at the top while the cursor is in a
   component. When the panel is closed, entering a component doesn't open
   it; the settings toggle shows a dot instead.
   - A save conflict still forces the panel open, as today.
   - The AST inspector, when shown, replaces the panel's contents until
     it is closed.
9. **Fluid layout:** every screen works at phone width (rail stacks, the
   settings panel drops below or overlays the writing area). A
   phone-tuned editor is not designed yet; it only has to stay usable.

## Non-goals

- The Theme screen, per-post page themes, and the editor's theme picker as
  a site setting (step 4). The editor still renders the post in the site's
  theme as today.
- The Media screen (3b).
- A dark scheme for the app itself, and a phone-tuned editor.
- New behavior on Sites or Posts beyond what the mockups show: filters,
  search and counts are included; sorting options and bulk actions are not.
- Programs, Analytics, Social.

## Anti-goals

- Hex values or one-off colors in CSS.
- Losing any current function in the move. Every action today has a home:
  - Export and AST go in "⋯";
  - Tools goes in the panel or "⋯";
  - Delete post goes in "⋯";
  - the site theme picker goes in the Theme section;
  - Status is shown, not edited;
  - the doc browser stays in `vp serve` mode.
- An editor that can't be driven from the keyboard after the fixed
  toolbar goes.
- Changing the stored post format or the rendered HTML.
- Unpublish sitting next to Update.

## Constraints

- Everything from steps 1 and 2 holds:
  - no front-end framework;
  - VB elements and tokens;
  - localhost only;
  - stored URLs and post JSON unchanged.
- `vp serve` (fixture mode, no `?site=`) keeps working with the same
  editor. It gets the same top bar without the site parts: no "← Posts" and
  no site name. It keeps the save state, Preview, the settings toggle and
  "⋯", with Publish/Unpublish as today's fixture actions. Its doc browser
  and the theme picker stay in the side panel.
- The mockups are visual specs (README "How to read the mockups"):
  semantic markup and real data, not their templating or inline styles.
- Browser checks at desktop and phone widths are part of done. So is an
  axe or keyboard pass on each screen.

## Left to the builder

- Exact component boundaries, for example whether the rail is a custom
  element.
- How the title is held in ProseMirror: a schema node outside the blocks,
  or a separate input styled into the column. It must behave as goal 6
  says.
- Floating-toolbar positioning code. The drag implementation, within
  ProseMirror's drag-and-drop.
- Wording, as long as it matches the mockups where they show text.
- "Not designed yet" states (add/clone panels, progress, conflict): match
  the look with existing components.
