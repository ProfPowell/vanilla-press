# Programs: rulings and follow-ups

Spec: `docs/superpowers/specs/2026-11-09-vp-programs-design.md`. Plan:
`docs/superpowers/plans/2026-11-09-vp-programs.md`.

## Rulings made while building

Each has its cost if it's wrong.

- **R1/R1a, the program server's start:**
  - The program server binds right after the app server.
  - The routes read its address at request time.
  - *Cost:* none.
- **R2, upload paths:** uploads send each file with its relative path as
  the filename, so a picked folder's own name arrives on every path. The
  server strips one common top folder. *Cost:* uploads would land flat
  if a browser dropped the path.
- **R3, area collisions:**
  - At creation, Vanilla Press refuses an area whose name is already
    any `src/` entry, including `src/<area>.html`.
  - Cook, at build time, accepts the area's own list page.
  - *Cost:* add the area first, then its list page (see R12).
- **R4, the Update token:** the preview's token hashes every file's
  content, so a same-size edit between Preview and Apply is caught.
  *Cost:* hashing up to 50 MB twice per Update.
- **R5, drafts in program commits:** program commits carry pending
  draft saves, as Publish and Apply do. *Cost:* a draft can ride along
  in a "Programs:" commit.
- **R6, whole-area commits:** each program commit stages
  `config/programs.json` and every area folder, so a card and its folder
  always go live together. *Cost:* a commit can carry another program's
  leftover change.
- **R7, a reserved name:** the area name `areas` is refused, because it
  clashes with a route. *Cost:* one name unavailable.
- **R8, Used in:** the program list reports "Used in" for every program.
  *Cost:* one usage pass per load.
- **R9, listing:** listing is refused for a card whose folder is missing,
  not only for a folder without `index.html`. *Cost:* none.
- **R10, colliding areas (Cook):** an area that starts to collide, for
  example when a README is dropped into `src/programs/`:
  - still protects its program folders and keeps their sandbox rules;
  - only warns, and drops out of the `programs`/`programAreas` lists.
  - *Cost:* nested pages in a folder wrongly configured as an area ship
    as raw source.
- **R11, the commit check:** before every program commit, the import
  rules run over program folders git reports as new or changed. A
  secret, a dotfile, a symlink or an oversize file refuses the commit
  with a 422 naming it. *Cost:* see R14.
- **R12, the list page order:** add an area first, then its list page
  (documented in the README). *Cost:* a little friction.
- **R13, the commit check's timing:**
  - It runs after the route's change. On a 422, the change stays on disk
    uncommitted.
  - The next successful program write commits it.
  - *Cost:* an edit waits until the bad file is fixed.
- **R14, a strict commit check:**
  - It also refuses dotfiles that git ignores.
  - It looks inside `node_modules/` and `.git/` of changed program
    folders.
  - *Cost:* a harmless ignored file blocks commits until it's removed.

## Deferred

**Worth a small fix soon:**
- **Commit-check limits:** the check totals the size limits across all
  changed folders of an area. Two uncommitted programs of 30 MB each,
  each fine on its own, refuse together.
- **Tracked dotfiles:** a dotfile already tracked in a program refuses
  every later commit once that folder changes.
- **Empty images:** VP writes `"image": ""`. The test site's card then
  renders `<img src="">`, hidden by CSS. Omit the key when there's no
  image, and give the site's card a way to skip the image.

**Cook:**
- A `cook dev` full rebuild appends the sandbox rules to `dist/_headers`
  again; `cook build` is unaffected.
- The dev program-copy path has no test.
- The standalone fragment and format fallbacks don't skip program
  folders; builds never reach them.
- In a colliding area, cards with bad slugs are dropped without a
  warning.

**Import and upload:**
- **Races and odd files:**
  - A parent-folder symlink swapped between the scan and the copy.
  - Hard links aren't refused.
  - Bidi and format characters in file names aren't refused.
- **Update preview:**
  - An Update replaces the live folder, so live dotfiles (e.g.
    `.well-known/`) disappear without being listed in the preview.
  - The preview reads the live folder outside the lock.
- **Upload limits:**
  - An upload holds about 2 × 51 MB in memory, with no limit on
    concurrent uploads.
  - It stages every file before the file-count limit is checked.
  - Content between 50 and 51 MB gets 422 rather than 413.
- **Upload messages and names:**
  - A missing `area` field reads "There is no area /undefined/".
  - Upload file names aren't percent-decoded (`"` arrives as `%22`).

**Program server:**
- It accepts any configured area string.
- There is a small window between its checks and the file read.
- It reads whole files synchronously.
- No test covers `#` names or the port + 1 placement.

**Routes:**
- **Performance:** loading the program list and Remove both render every
  document. A follow-up for large sites.
- `setProgramSource` failing after an install leaves the files and card
  uncommitted.
- The folder check is by path, so a user-made symlinked `src/<area>` is
  followed.
- A no-change card save reports `committed: true`.
- Deleting an area leaves its list page pointing at an empty
  `programAreas.<area>`.

**Programs screen:**
- **Refresh and focus:**
  - Any refresh closes an open Update preview.
  - Focus is lost after Update's Apply.
- **Accessibility and tests:**
  - The whole Update preview is a `role="status"` live region.
  - The sandbox attribute string isn't asserted in the unit tests.
  - axe reports the same moderate landmark issue as Media.
- **Polish:** label spacing in the detail panel is tight.

**Test site (thomasapowell.com):**
- The card CSS has literal fallbacks in `var()`.
- Tags render as a comma string.
- The footer sits flush against the last card.
- Both demos carry the same date, so newest-first ordering isn't
  visible yet.

**Tests:**
- Some program-route tests depend on running in order.
- The GET audit fills unknown route parameters with `x`.
