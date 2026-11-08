# Vanilla Press step 3b: media

Date: 2026-11-03, revised 2026-11-07 · Status: revised; the user asked to
skip the questions, so everything under "My calls" is mine to be checked.

Builds on step 1 (`2026-11-02-vp-app-core-design.md`), the component system
(`2026-11-03-vp-components-design.md`) and the new look
(`2026-11-07-vp-new-look-design.md`, merged at c184c82). The visual spec is
`docs/design/mockups/Media.dc.html` and `docs/design/README.md`.

## Decided by the user

- Media is step 3b, built in the new look, following the Media mockup.
- Media uses the VB family:
  - `<image-editor>` (`@profpowell/image-editor`) in the detail panel for
    crop, rotate and filters. **Saving creates a new copy**, so existing
    posts never change.
  - Audio, video and PDF are media types, inserted with VB's
    `audio-player` and `video-player` and `<pdf-viewer>`.
- There is **no "Replace file"**.
- Keep the mockup's **"Decorative (alt="")"** checkbox. An empty alt set on
  purpose is stored apart from alt text never written; only the second
  counts as missing.
- Keep the **Missing file** filter alongside the mockup's All / Needs alt
  text / Unused.
- Fit the image editor and audio, video and PDF into the same detail panel.
- Unpublishing removes the post's page, so its old URL returns 404. (Already
  true; recorded because delete rules below lean on it.)

## Intent

Media should work the way it does in Ghost. You drop a file into a post or
onto the Media screen, it shows up, you can find it again later, and it
appears on the live site when the post is published. Today VP does the
minimum:

- an upload endpoint and a picker modal in the editor, images only;
- random file names (`3f9a2c1b.jpg`), with the original name lost;
- no size or type check, no delete, no alt editing;
- `content/media.json` is written but never read back, so a fresh clone or
  a second machine starts with an empty library even though the files are
  in `src/media`;
- the site's Media section is a "coming soon" placeholder.

## What exists to build on

- **Store and API:** the `media` table (id, filename, mime_type, size, alt
  nullable, created); `GET`/`POST /api/media`, served per site at
  `/api/sites/:siteId/media`.
- **Files:** uploads go to `<site>/src/media/` (`ws.mediaDir`);
  `writeMediaJson` writes `content/media.json`.
- **Git and publish:** backups stage `content/`, `src/media` and
  `config/vp.json` (`BACKUP_PATHS`); publish stages the same plus the
  post's pages, so a file uploaded seconds before Publish goes out with
  the post.
- **Display:** the app serves `/sites/<id>/media/<file>`; the editor maps
  stored `/media/<file>` URLs to it (step 1 Ruling H). Stored and published
  URLs stay `/media/<file>`.
- **Responsive images:** Cook's build makes AVIF/WebP at several widths and
  rewrites `<img>` into `<picture>`. VP resizes nothing.
- **Editor:**
  - the `figure` block (src, alt, variant, figcaption);
  - the `embed` block (url, type `video`|`codepen`|`observable`); a
    self-hosted `video` embed already renders as
    `<video-player><video controls><source src>…` and a YouTube URL as
    `<youtube-player>`;
  - `<pdf-viewer>` and `<image-editor>` are catalog components, and VP has
    both packages installed;
  - component settings fields for `src`/`url`/`href`/`poster` attributes
    (`component-model.js` `URL_NAMES`);
  - `<media-picker>` and the palette's Image entry.
- **Known bugs** (step 1 follow-ups), fixed here:
  - a figure with no caption can't be saved (400);
  - the media route serves SVG same-origin with no sandbox;
  - `POST /media` is not in the writes queue;
  - the picker uses `alert()`.

## Goals

1. **The Media screen** replaces the placeholder in the site rail
   (`site.html?site=<id>&section=media`), laid out as the mockup:
   - header: "Media", "N files in src/media · M missing alt text", and
     Upload;
   - filters (`aria-pressed`): All, Needs alt text, Unused, Missing file;
     a type select (All types, Images, Video, Audio, PDF); search over
     filename, original name and alt text;
   - a grid of tiles, newest first. Images show a thumbnail; other types
     show a type icon and label. A tile marks missing alt text or a
     missing file. Tiles are buttons with `aria-pressed` for the selected
     one;
   - a drop zone line under the grid ("Drop files here, or paste…");
   - an empty state per filter.
2. **Uploading works everywhere you'd expect:**
   - drop or pick several files on the Media screen; paste an image there;
   - drop or paste a file into the editor's writing area: it uploads and
     inserts the matching block where it was dropped (goal 6);
   - the picker in the editor uploads and picks from the same library.

   Each file shows its own progress and its own error; one bad file never
   stops the others.
3. **Readable, stable file names:** a new upload is
   `<slug of original name>-<6-char id>.<ext>` (`garden-path-3f9a2c.jpg`).
   The name never changes. Existing random-named files keep their names.
   The original name is kept as `original_name`.
4. **The detail panel** (right side, as the mockup; stacks below at phone
   width) for the selected item:
   - a preview that fits the type: the image; `audio-player`;
     `video-player`; for PDF, `<pdf-viewer>` from VP's own copy;
   - filename, original name, type, file size, upload date, and pixel
     dimensions for images;
   - **alt text** (images only), saved as you type (debounced), with the
     mockup's hint and the **Decorative (alt="")** checkbox. Checking it
     stores `alt: ""` and disables the field; unchecking restores the
     field empty;
   - **URL** `/media/<file>` with Copy;
   - **Used in:** each post using the file, linked to its editor, with
     draft/published status;
   - **Edit image** (JPEG, PNG and WebP only; goal 5);
   - **Delete…** (goal 9).
5. **Editing an image makes a copy:**
   - "Edit image" swaps the preview for `<image-editor>` loaded with the
     file, with Save copy and Cancel.
   - Save copy exports in the original's format (JPEG/PNG/WebP), uploads
     it as a new item named `<original slug>-edited-<6-char id>.<ext>`,
     copies the alt text and decorative state, records `edited_from` (the
     source filename), and selects the copy.
   - The original and every post using it are untouched.
   - GIF (animation would be lost), SVG (vector) and AVIF (the editor
     can't export it) don't offer Edit image.
6. **Inserting each type in a post:**
   - **Image** → `figure` block, alt from the library (`""` if decorative;
     if never written, the figure's alt field opens).
   - **Video** → `embed` block, type `video`, as today.
   - **Audio** → `embed` block, new type `audio`, rendered as
     `<audio-player><audio controls src="…"></audio>…</audio-player>` with
     a download-link fallback like video's.
   - **PDF** → `<pdf-viewer src="…">` component when the site has
     `@profpowell/pdf-viewer` enabled; otherwise a paragraph with a link
     to the file (its original name as the text), and a one-line note
     saying the PDF viewer can be enabled in Components.
   - The palette gains Audio and Video entries next to Image; each opens
     the picker filtered to its type, with upload.
   - Component settings: any `src` or `poster` field gets a **Choose…**
     button that opens the picker (filtered to images for `poster`, by
     the element's type where known: `pdf-viewer` → PDF, `image-editor` →
     images; otherwise all) and fills in `/media/<file>`.
7. **Alt text gets attention without nagging:**
   - uploading offers the alt field (Media screen: the detail panel opens
     on the new item; picker: an alt field beside the upload);
   - the library's alt is the default when an image is inserted; editing a
     figure's alt changes only that post; editing the library's alt never
     rewrites posts;
   - **Publish and Update warn, without blocking,** when the post has a
     figure with empty alt that isn't decorative: an in-page panel next
     to the primary button names the images, with "Publish anyway" and
     "Cancel".

     Decorative here means the figure's own alt is `""` and the library
     marks that file decorative. A figure with empty alt on a file the
     library doesn't mark decorative warns.
8. **Featured image:** Post settings gains **Featured image**, chosen from
   the library or uploaded there, and removable. It is stored as
   `meta.image` (`/media/<file>`), written as `image` in the page's front
   matter and the post JSON, and counts in Used in. Showing it is the
   site's business: I add it to the thomasapowell.com post layout and its
   `og:image` as part of this step, as a local commit in that repo (not
   pushed).
9. **Deleting never breaks the live site:**
   - the confirmation is the new look's in-page `confirm-panel`, never a
     browser dialog;
   - a file used by a **published** post can't be deleted; the panel
     lists those posts;
   - a file used only by drafts can be deleted after the panel names
     those drafts; their blocks are left as they are and the editor shows
     them as missing;
   - delete removes the file and the entry; git drops the file at the next
     backup.
10. **The library lives in git and follows the site:**
    - `content/media.json` plus the files in `src/media` are the source of
      truth, like posts.
    - **Opening a site** loads `media.json` into the store and checks it
      against `src/media`:
      - a file on disk with no entry is adopted (original name = filename,
        alt never written);
      - an entry whose file is missing shows as **Missing file**, never
        deleted automatically.
    - Pull-on-open brings the other machine's uploads in.
    - Upload, alt edits, edit-copy and delete go through the writes queue
      (step 1 Ruling O) and schedule the same draft backup (`[CI Skip]`).
11. **Upload limits:**
    - accepted types, checked from the file's contents, not only its
      extension:
      - images: JPEG, PNG, WebP, AVIF, GIF, SVG;
      - video: MP4 (incl. `.m4v`), WebM;
      - audio: MP3, M4A/AAC, OGG/Opus, WAV;
      - PDF;
    - files over **25 MB** are refused, with the size in the message:
      Cloudflare Pages won't serve a file larger than 25 MiB;
    - files over **5 MB** upload with a "large file" note: everything is
      committed to git, so the repo grows with it.
12. **Files are safe in the app.** Media responses carry
    `Content-Security-Policy: sandbox` and `X-Content-Type-Options:
    nosniff`, so an SVG or PDF with script can't act as the app (which can
    push to GitHub). The live site serves files as Cook copies them.

## Non-goals

- Replacing a file in place under the same URL.
- Editing video, audio or PDF; reading their duration, page count or
  dimensions.
- Captions/subtitles (`.vtt`) and video posters as their own feature
  (`poster` can still be set through component settings' Choose…).
- Folders, albums or tags; bulk actions beyond multi-file upload.
- External storage (R2, a CDN) or Git LFS.
- Resizing or format conversion in VP, beyond what the image editor's copy
  does.
- Rewriting posts when an item's alt changes.
- Other file types (ZIP, Office documents, fonts).

## Anti-goals

- A published post showing a broken file on the live site, from a delete or
  from a file that never reached GitHub.
- An empty library on a fresh clone or second machine while the files sit
  in `src/media`.
- Renaming files after upload, or the image editor overwriting a file.
- Browser `alert()`/`confirm()`/`prompt()` dialogs.
- A silent upload failure: every file ends uploaded, or with an error
  saying why and what to do.
- Cluttering the writing screen: drop, paste, the palette's media entries,
  Choose… in component settings and Featured image are the editor's whole
  media surface.
- Hex colors or one-off styles; everything uses VB tokens like 3a.

## Constraints

- Everything from steps 1, 2 and 3a holds: Node, no front-end framework,
  VB elements and tokens, localhost only behind the Host/Origin guard, VP
  stages only its own paths, site files win, stored URLs and post JSON
  keep their format.
- No new runtime dependencies. Image pixel dimensions come from a small
  header reader in VP (PNG, JPEG, GIF, WebP, AVIF, and SVG
  `width`/`height`/`viewBox`); unknown is not an error. Type sniffing is
  the same reader's magic-byte check.
- `media.json` grows `original_name`, `width`, `height`, `edited_from`.
  Old files without them still load; the store gets a matching migration.
  `alt` keeps three states: `null` (never written), `""` (decorative),
  text.
- The `embed` block's `type` enum gains `audio`; nothing else in the AST
  changes. `meta.image` is a new optional meta field.
- `vp serve` (fixture mode) keeps working, with media in the repo's
  `media/` folder.
- Browser checks at desktop and phone widths, plus keyboard and axe passes
  on the Media screen, are part of done. Browser checks run as
  time-limited scripts (3a's freeze lesson).

## My calls (the user can override)

- **Size limits:** 25 MB hard limit for every type, from Cloudflare Pages'
  per-file limit; 5 MB "large file" note.
- **Accepted types:** the lists in goal 11.
- **Audio** is a new `embed` type rather than a component, because VB's
  players wrap a native `<audio>`/`<video>` the component system can't
  author; this matches how video already works.
- **PDF** inserts as `<pdf-viewer>` only where the site enabled it, else
  as a link, so a post never ships a component the live site won't load.
- **Image editor:** JPEG/PNG/WebP only; the copy keeps the original's
  format; named `-edited-<id>`; alt copied.
- **Decorative** is stored as `alt: ""`; missing is `alt: null`.
- **Publish alt warning** is an in-page panel with "Publish anyway".
- **File names:** slug-plus-id, never renamed.
- **Delete:** blocked while a published post uses the file; allowed with a
  named warning for drafts.
- **Featured image:** in this step, with the thomasapowell.com layout
  change committed locally there.
- **Missing files** are flagged, never deleted; stray files are adopted.
- **Type filter** as a select beside the mockup's filter buttons.

## Left to the builder

- Component boundaries (e.g. `<media-library>` shared by the screen and
  the picker, or separate).
- How Used in is computed: a scan of post bodies (figure `src`, embed
  `url`, component `src`/`poster`) and `meta.image` for `/media/<file>`,
  on request or cached; it must be right after any save.
- Upload progress display.
- Message wording, as long as each says what happened and what to do.
- Thumbnails: originals scaled by the browser are fine.
