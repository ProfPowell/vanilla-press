# Vanilla Press step 2: media management

Date: 2026-11-03 · Status: approved, now step 3. It waits on the
component system (`2026-11-03-vp-components-design.md`).

**To revise before planning:** the user wants media to use the VB family.
Two changes follow:
- `<image-editor>` (`@profpowell/image-editor`) in the Media detail panel
  for crop, rotate and filters. Saving creates a new copy, so existing posts
  never change.
- Audio, video and PDF as media types, inserted with VB's `audio-player`
  and `video-player` and `<pdf-viewer>`.

Both build on the component system.

**Decided 2026-11-07:**
- Media is step 3b. It is built in the new look
  (`2026-11-07-vp-new-look-design.md`), following
  `docs/design/mockups/Media.dc.html`.
- There is no "Replace file".
- Add the mockup's **"Decorative (alt="")"** checkbox. An empty alt set on
  purpose is stored apart from alt text never written, and only the second
  counts as missing.
- Keep the **Missing file** filter alongside the mockup's All / Needs alt
  text / Unused.
- Fit the image editor and audio, video and PDF into the same detail
  panel.

Builds on step 1, `docs/superpowers/specs/2026-11-02-vp-app-core-design.md`.
The user asked to go straight to a design, so everything below the "Decided
by the user" line is my call. They can override any of it.

## Intent

Images should work the way they do in Ghost. You drop a picture into a post
or onto the Media screen, it shows up, you can find it again later, and it
appears on the live site when the post is published. Today VP only does the
minimum:

- It has an upload endpoint and a picker modal in the editor.
- Files get random names (`3f9a2c1b.jpg`), and the original name is lost.
- There is no size or type check, and no way to delete a file or edit its
  alt text.
- `content/media.json` is written but never read back. A fresh clone, or a
  second machine, starts with an empty library even though the files are
  in `src/media`.
- The site screen's Media section is a "coming soon" placeholder.

## What exists to build on

- **Store and API:**
  - The `media` table: id, filename, mime_type, size, alt, created.
  - `GET` and `POST /api/media`, served per site at
    `/api/sites/:siteId/media`.
- **Files:**
  - Uploads go to `<site>/src/media/`.
  - `writeMediaJson` writes the library to `content/media.json`.
- **Git and publish:**
  - Backups stage `content/`, `src/media` and `config/vp.json`
    (`BACKUP_PATHS`).
  - Publish stages the same paths plus the post's pages, so an image
    uploaded seconds before Publish still goes out with the post.
- **Display:**
  - The app serves `/sites/<id>/media/<file>`.
  - The editor maps stored `/media/<file>` URLs to it for display (Ruling H
    from step 1).
  - Stored and published URLs stay `/media/<file>`.
- **Responsive images:** Cook's build already makes AVIF and WebP versions
  at several widths and rewrites `<img>` into `<picture>` with
  width/height and lazy loading (`optimize-images`). VP does not need to
  resize anything.
- **Editor:** a `figure` block (src, alt, variant, figcaption), the
  `<media-picker>` modal, and the block palette's Image entry.
- **Known bugs in this area** (from the step 1 follow-ups), fixed here:
  - a figure with no caption can't be saved (400);
  - the media route serves SVG same-origin with no sandbox;
  - `POST /media` is not in the writes queue;
  - the picker uses `alert()`.

## Goals

1. **A Media screen** replaces the placeholder in the site sidebar.
   - It shows a grid of thumbnails, newest first. Each shows the filename
     and a mark when alt text is missing.
   - Search matches filename, original name and alt text.
   - Filters: All, Unused, Missing alt text, Missing file.
2. **Uploading works everywhere you'd expect:**
   - drop files onto the Media screen, or pick several at once;
   - drop or paste an image into the writing area of the editor, which
     uploads it and inserts a figure where you dropped it;
   - the picker in the editor (Image block, Browse) uploads and picks from
     the same library.

   Each file shows its own progress and its own error. One bad file never
   stops the others.
3. **Readable, stable file names:**
   - A new upload is named `<slug of original name>-<6-char id>.<ext>`, for
     example `garden-path-3f9a2c.jpg`.
   - The name never changes after upload, so URLs in posts never break.
   - Existing random-named files keep their names.
   - The original file name is kept as `original_name`.
4. **A detail panel for each item:**
   - a large preview, plus filename, original name, type, pixel
     dimensions, file size and upload date;
   - **alt text**, editable and saved as you go;
   - **Used in:** every post that uses the image, linked to its editor,
     with its status (draft or published);
   - **Copy URL** (`/media/<file>`);
   - **Delete** (see goal 8).
5. **Alt text gets attention without nagging:**
   - Uploading on the Media screen or in the picker offers an alt field.
   - Dropping into the editor takes the library's alt text if it has one.
     Otherwise the new figure opens its alt field.
   - The library's alt text is the default when an image is inserted.
     Editing a figure's alt changes only that post.
   - Editing the library's alt does not rewrite posts that already use the
     image.
   - **Publish warns, but does not block,** when the post has an image with
     empty alt text. The publish confirmation names the images.
6. **A featured image for each post:**
   - Post settings gains **Featured image**, chosen from the library or
     uploaded on the spot, and removable.
   - It is stored as `meta.image` (`/media/<file>`) and written as `image`
     in the page's front matter, and to the post JSON.
   - Whether the site's layout shows it is the site's business. I'll add it
     to the thomasapowell.com post layout and its `og:image` as part of
     this step.
7. **The library lives in git and follows the site:**
   - `content/media.json` plus the files in `src/media` are the source of
     truth, like posts.
   - **Opening a site** loads `media.json` into the store and checks it
     against `src/media`:
     - A file on disk with no entry is adopted: original name is the
       filename, alt is empty, and it counts as an upload.
     - An entry whose file is missing shows as **Missing file**. It is
       never deleted automatically.
   - Pull-on-open (step 1) brings in the other machine's uploads, and they
     appear in the library.
   - Upload, alt edit and delete go through the same writes queue as posts
     (step 1 Ruling O). They schedule the same draft backup (`[CI Skip]`),
     which never triggers a Cloudflare build.
8. **Deleting never breaks the live site:**
   - The confirmation is an in-page panel, never a browser dialog.
   - An image used by a **published** post can't be deleted. The panel
     lists those posts.
   - An image used only by drafts can be deleted after the panel names
     those drafts. Their figures are left as they are, and the editor shows
     them as missing.
   - Delete removes the file and the entry. Removing the file from git
     happens in the next backup.
9. **Upload limits:**
   - Accepted types: JPEG, PNG, WebP, AVIF, GIF, SVG. The type is checked
     from the file's contents, not only its extension.
   - Files over **20 MB** are refused, with the size in the message.
   - Files over **5 MB** upload but carry a "large file" note. Every image
     is committed to git, so the repo grows with it, and Cook makes the
     smaller web versions anyway.
10. **SVG is safe in the app.** The app serves media with
    `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`,
    so an SVG with a script can't act as the app (which can push to
    GitHub). The live site serves SVGs as Cook copies them. They are the
    user's own files.

## Non-goals

- Video, audio, PDF or other file types (later; the screen is named Media
  so they can join).
- Cropping, rotating, filters or any image editing.
- Folders, albums or tags for media.
- Replacing a file in place under the same URL.
- External storage (R2, a CDN). Images live in the repo, and Cloudflare
  Pages serves them.
- Resizing or format conversion in VP. Cook's build does it.
- Bulk actions beyond multi-file upload.
- Rewriting posts when an image's alt text changes.

## Anti-goals

- A published post showing a broken image on the live site, from a delete
  or from a file that never reached GitHub.
- A library that is empty on a fresh clone or a second machine while the
  files are sitting in `src/media`.
- Renaming files after upload, which breaks posts.
- Browser `alert()` or `confirm()` dialogs.
- A silent upload failure. Every file ends as uploaded, or with an error
  that says why.
- Cluttering the writing screen. Drag, paste and the existing Image block
  are the editor's whole media surface, plus Featured image in post
  settings.

## Constraints

- Everything from step 1 still holds:
  - Node with no front-end framework, VB for the UI;
  - localhost only, behind the Host/Origin guard;
  - VP stages only its own paths;
  - site files win.
- No new runtime dependencies.
  - Pixel dimensions are read from the file headers (PNG, JPEG, GIF, WebP,
    AVIF, and the SVG `width`/`height`/`viewBox`) with a small reader in
    VP.
  - If a format can't be read, the dimensions show as unknown. That's not
    an error.
- The `media.json` format grows new fields: `original_name`, `width`,
  `height`. Old files without them still load. The store gets a matching
  migration.
- Stored image URLs stay `/media/<file>`. They are correct on the live
  Cook site, and the editor maps them for display.
- `vp serve` (single-site, fixture mode) keeps working. Media there uses
  the repo's `media/` folder as today.

## Decided by the user

- Media management is roadmap step 2: a real Media section for uploading,
  browsing and reusing images.
- The user asked to skip the questions and go straight to this design.

## My calls (the user can override)

- **Originals:** VP keeps original files and relies on Cook for responsive
  versions.
- **File size:** the 20 MB hard limit and the 5 MB "large file" note.
- **File names:** slug-plus-id naming, never renamed.
- **Delete:** blocked while a published post uses the image, and allowed
  with a named warning for drafts.
- **Alt text:**
  - Publish warns on missing alt but doesn't block.
  - Library alt is only the default for new inserts.
- **Featured image:** included in this step, stored as `meta.image`, with
  the thomasapowell.com layout updated to show it.
- **Missing files:** files found on disk are adopted, and entries whose
  file is missing are flagged, never deleted.
- **Bug fixes:** the four known media bugs listed above are fixed here.

## Left to the builder

- Screen layout and visual design, within the step 1 look, using VB.
- How "Used in" is computed: a scan of post bodies and `meta.image` for
  `/media/<file>`, computed on request or cached. It must be right after
  any save.
- Progress display for uploads.
- The exact wording of messages, as long as each says what happened and
  what to do.
- Whether thumbnails are the original scaled by the browser or something
  lighter. Originals are fine at this scale.
