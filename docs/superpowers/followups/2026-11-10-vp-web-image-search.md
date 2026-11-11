# Web image search: rulings and follow-ups

Spec: `docs/superpowers/specs/2026-11-10-vp-web-image-search-design.md`. Plan:
`docs/superpowers/plans/2026-11-10-vp-web-image-search.md`.

## Rulings made while building

Each ruling ends with its cost if it's wrong.

- **R1, Unsplash in pickers with no caption:**
  - An Unsplash photo used as a featured image or component source is
    published with no credit. Its linked library item keeps the credit
    (see "Linked Unsplash items" below), but nothing shows it there.
  - This is as the user decided: "There needs to be some trust".
  - *Cost:* the writer must credit it by hand.
- **R2, a corrupt key file:** a corrupt `services.json` is set aside
  (0600) before the next save, so the other keys aren't silently dropped.
  *Cost:* none.
- **R3, Openverse public-domain credit:** CC0 and PDM credits leave out
  the license keys; empty strings are dropped everywhere. *Cost:* one line.
- **R4, accepted import choices:**
  - filenames get a hex suffix (`pexels-123-a1b2c3.jpg`);
  - the proxy sniffs the type and refuses anything that isn't an image;
  - an edited copy of a credited image inherits the credit, marked
    adapted;
  - a blank description gives a null alt, not decorative;
  - the Unsplash ping answers 409 when there's no key;
  - relative credit links are allowed at the model level (the Media form
    requires http(s));
  - import under `vp serve` answers 503.

  *Cost:* small reverts.
- **R5, linkedom:** pinned 0.18.15 as a devDependency, for DOM tests only.
  *Cost:* one devDependency.
- **R6, proxy limits:**
  - The proxy fetches up to 60 MiB within 60 seconds, so huge originals
    can be downsized in the browser.
  - Import keeps the 25 MiB limit.
  - *Cost:* memory for one 60 MB buffer per request.
- **R7, credit autosave:** the credit autosaves like alt text, with no
  unsaved-changes guard. *Cost:* a half-typed link may save, then be
  refused with a message.
- **R8, Load more past the end:** a 4xx (not a key error, not 429) on page
  2 or later counts as "no more results", which covers an expired cached
  page. *Cost:* a rare other error on a later page is hidden.
- **R9, the Services link in search:** it opens in a new tab, because the
  editor has no unsaved-changes guard. *Cost:* none.

## Linked Unsplash items (2026-11-11)

- Choosing an Unsplash result (any picker, or Add from web on the Media
  screen) adds a **linked** library item: a row with the photo's
  `images.unsplash.com` URL (`url` column, in `media.json`) and credit,
  named `unsplash-<id>`, with no file. The server pings Unsplash's
  `download_location` once per choice (`imageSearch.pingDownload`, shared
  with the old ping route); choosing the same photo again pings and
  reuses the item.
- It shows in the Media screen as "Linked from Unsplash", previews from
  Unsplash, can't be edited, and keeps alt and credit editing. Delete
  removes only the row. "Used in" matches its exact URL.
- The library search now includes Unsplash (its cards offer "Add" only).

## Deferred

**Worth a small fix soon:**
- A remote SVG imported from the web is inert inside a post (`<img>`),
  but is unrestricted if its file is opened directly on the live site.
- The `image-load` counter (swapped-picture detection) miscounts if the
  first load fails or is superseded. Compare the src or blob instead.
- Out-of-order alt and credit responses can leave a stale copy in the
  Media screen's client list until refresh. The server is correct.
- From Services, the only way back is "All sites", not the site you came
  from.

**Robustness:**
- Credit strings have no length cap.
- The proxy and import re-download the image each time; there is no
  sharing of in-flight requests.
- An upload can store a web `source` with no credit. An edited copy can't
  drop an inherited credit.
- A blank description gives a whitespace alt on import.
- Any credit text that isn't recognised is read back as a license (it
  renders the same).
- `appendQuery` appends after a `#fragment`. `withUrl` guards `url` but
  not `thumb`.
- Corrupt key-file edge cases: non-object JSON, EACCES, a same-millisecond
  set-aside.

**Interaction polish:**
- A second click while an image is being added is ignored silently.
- Escape with an editor tool open, while focus is on Save or Cancel, does
  nothing.
- Focus is lost if Load more returns only duplicates.
- Credit link clicks in the editor aren't covered by `stopEvent`.
- A dead Enter-to-save handler remains on the credit form.
- A repeated Services announcement relies on a trailing no-break space.
- The Openverse card has an empty middle.

**Tests and cleanup:**
- The 0600 temp-file test would pass without `{ mode }`.
- No behavioural test covers an import error after the dialog closes.
- The edit-step styles are duplicated in `app.css`.
- `mountServiceRoutes` has unused options.
- A pre-existing `MaxListenersExceededWarning` appears in the API tests.
