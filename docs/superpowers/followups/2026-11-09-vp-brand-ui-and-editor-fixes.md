# Branded UI and editor fixes: rulings and follow-ups

Spec: `docs/superpowers/specs/2026-11-09-vp-brand-ui-and-editor-fixes-design.md`. Plan:
`docs/superpowers/plans/2026-11-09-vp-brand-ui-and-editor-fixes.md`.

## Rulings made while building

Each has its cost if it's wrong.

- **R1, dark in-between colors:** the builder chose muted `#CFC8B8`, subtle
  `#B4B0A6`, surface-alt `#2E3D5E`, border `#46577D` and border-subtle
  `#2C3A5A`, each within the contrast floors. *Cost:* a re-tint.
- **R2, extra Task 5 fixes:** dark error text (`#FF908A`) and the
  `--color-surface` mapping were fixed in Task 5 instead of deferred.
  *Cost:* none.
- **R3, the seal at 28px:** the bars and rail use the medium drawing, which
  keeps its scalloped edge on retina. The brand README now says so. *Cost:*
  swap one asset.
- **R4, pressed state on ink bars:** treated as Important. Pressed and open
  buttons get a 3px vanilla underline. *Cost:* none.
- **R5, the editor bar:** it carries the seal without the "Vanilla Press"
  name, to save room on phones. *Cost:* add a wordmark.
- **R6, selection in figure fields:** verified real (invisible after Tab)
  and fixed. *Cost:* none.

## Deferred

**Editor behavior:**
- Typing `/` on a selected media block inserts a literal `/`; the palette
  doesn't open.
- Backspace that deletes the trailing paragraph (which the plugin re-adds)
  marks the post Unsaved.
- `applyInlineMark` flattens inner marks; `removeStoredMark` inside a bold
  run un-bolds the text that follows.
- `x*it*` doesn't turn italic.
- An inline component with content inside the delimiters may throw off the
  replaced range (`input-rules.js`, found by reading).
- The more-menu doesn't re-place when its items change while open, and its
  listeners aren't removed if it's disconnected while open.

**Look:**
- The Browse button is oversized in the figure's fields row.
- The figure/embed selection ring uses `--color-primary`; other blocks use
  `--color-accent`.
- Light subtle text on surface-alt is 4.44:1 (both values fixed by the spec).
- Borders are below 3:1 in both modes (dark 2.36/1.80; light 1.45 by spec).
- The dark empty-state seal at 35% reads olive.
- Five dark-chrome hexes are duplicated in `.on-ink`.
- The README's "unchanged tokens" row for error text shows only the light
  value.

**Tests:**
- No committed test covers paste staying literal, or a post ending in an
  image opening as "Saved". Both pass in the browser.
- The input-rule guards (code block, title, code mark) have no committed
  test.
- There is no `applyInlineMark` test for link attributes.
- Missing navigation tests: ↑ from a media block at the top, → from a
  caption's end, Enter reusing an empty paragraph mid-post.
- There is no unit test for click-to-select on a figure, or for the
  `theme-picker.js` change.
- The VB re-declare test checks the dark `[data-theme]` blocks only for
  `--color-background`.
- Popover placement has no test for equal room, or for `prefer: 'above'`
  with neither side fitting.
- Small cleanups: the `scrollHeight + 2` constant, the misleading
  `centeredLeft` name, and the `ast.js` comment framing the trailing-paragraph
  strip as editor-only.
- The figure drag fix is checked in Chromium only.
