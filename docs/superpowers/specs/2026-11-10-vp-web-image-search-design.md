# Web image search — design

Date: 2026-11-10. Status: draft for approval.

This is the first of four passes on media and presentation, in the order the
user set:

1. Web image search (this document).
2. Easier picking for presentation components (bg-wc, border-wc) and a page
   background.
3. Sound and video lookups.
4. AI image generation.

## Intent

The user was writing a post, needed a picture they didn't have yet, and had
to leave Vanilla Press to find one, download it, and upload it. They want to
search openly licensed image sources from inside Vanilla Press. They pick a
result and either insert it straight away or edit it first in their image
editor. Either way a copy goes into the media library, and its credit comes
along.

## Goals

- **Search from the picker and the Media screen.**
  - The editor's media picker gets a way to search the web next to "your
    library".
  - The Media screen gets "Add from web", which uses the same search.
- **Several sources at once.** One search box queries every service that is
  ready, and the results come back in one grid. Each result shows a
  thumbnail, the source and the creator.
- **Keep a copy.** Choosing a result saves a copy into the site's media
  library: `src/media` plus a database row, like an upload. Published pages
  use that copy, never the remote file.
- **Edit first.**
  - Every result offers "Edit first". It opens the user's `<image-editor>`
    (`@profpowell/image-editor`) on the image. Save stores only the edited
    image in the library, with the credit carried over, then inserts or
    selects it.
  - "Insert" (in the picker) or "Add" (on the Media screen) skips the
    editor.
- **Credit in the caption.**
  - A web image inserted in a post gets a credit in its caption, for example
    "Photo by Jane Doe on Pexels". The creator's name links to their page,
    and the source name links to the photo's page.
  - The writer's own caption text comes first, and the credit follows it.
  - The credit is not part of the editable caption text, so it can't be
    deleted by accident.
  - Reusing the same library image in another post brings the same credit.
- **Credit in the library.** Each media row records where it came from:
  - source;
  - source page URL;
  - creator name and URL;
  - license name and URL.

  The Media screen's detail panel shows these.
- **A Services settings screen, grouped.**
  - One app-level screen lists the outside services Vanilla Press can use,
    under group headings.
  - This pass fills only **Image search**. **Sound and video** and **AI
    generation** are headings later passes will fill.
  - Each service shows its status: "Ready", "Needs a key" with a sign-up
    link and a key field, or "Turned off". The user can turn any service off.

## Non-goals

- Sound, video and AI generation services. Later passes add these to the
  same Services screen.
- bg-wc and border-wc picking, and page backgrounds (pass 2).
- Text or drawing tools in the image editor.
- Bulk import, collections or favorites from a source.
- Hotlinked (remote) images in published pages.

## Anti-goals

These would make it a failure even if it worked:

- An API key ends up in a site's git repo, a published page, or the browser.
- A missing key or a failing service breaks searching or writing. A source
  that isn't ready is simply left out, and one that errors shows a short
  note in the results.
- A published image lacks the credit its license requires.
- Search results include images whose license forbids changing them, when
  editing is offered.

## Constraints

- **Plain stack.** Vanilla JS, Vanilla Breeze, the existing Node server and
  SQLite. No new runtime framework.
- **The server calls the services.**
  - The browser asks Vanilla Press's own server (`/api/...`), and the server
    calls the outside services with the keys.
  - Keys never reach the browser. The Services screen shows only whether a
    key is set, never the key itself.
  - The image editor's canvas also needs the image to come from the same
    origin, or it can't export.
- **Where keys live.**
  - Keys are machine-wide and shared by every site.
  - They go in the machine config directory, next to `sites.json`:
    `~/.config/vanilla-press/services.json`, or under `VP_CONFIG_DIR`.
  - The file is written with mode 0600.
  - Nothing about services is written into a site.
- **Respect each service's terms.** Use each service's documented API, send
  the attribution it requires, and keep within its rate limits.
- **Limits.**
  - A saved copy obeys the same size and type limits as an upload.
  - Requests to outside services time out, and a timeout is reported per
    source.
- **Current editor.** Update `@profpowell/image-editor` from ^0.1.0 to
  ^0.2.0. Vanilla Press already embeds it on the Media screen
  (`app/assets/js/media-detail.js`).

## Decided with the user

- **Order of the four passes:** images first, then presentation components,
  then sound and video, then AI generation.
- **Sources:** support several. Keeping a copy matters more than having
  Unsplash.
- **Credit:** goes under the image, in the caption.
- **Keys:** go in one settings area for every service Vanilla Press uses,
  grouped by purpose.
- **Where search appears:** on both the Media screen and the picker.

## My calls (the user can override)

- **Sources in this pass:**
  - **Openverse** works with no key, so search works on first run.
  - **Pexels** and **Pixabay** each need a free key. Both allow keeping a
    copy. Pixabay requires one.
  - **Unsplash is left out of this pass.** Its API guidelines ask apps to
    hotlink its image URLs rather than serve their own copies, which
    conflicts with keeping a copy. It can be added later if its terms allow
    it. The Services screen doesn't list it yet.
- **License filter (Openverse):**
  - Exclude No-Derivatives licenses, because editing is offered.
  - Also exclude Non-Commercial licenses, so a copy is safe on any site.
  - Pexels and Pixabay content is under their own licenses, which allow
    both.
- **Copy size:** ask each source for its large web size (about 1,920–2,400px
  on the long edge), not the full original.
- **Alt text:**
  - Use the source's description or title as a starting suggestion.
  - The alt-text flow that follows an upload still runs, so the writer
    confirms or rewrites it.
- **Edit first** loads the image through a same-origin proxy route on the
  server. Only the saved, edited image enters the library. The unedited
  original is not stored.
- **Services screen placement:** an app-level screen, not per site, reached
  from the app's rail.

## Settled after the builder check (my calls)

- **Credit wording follows the license.**
  - **Pexels and Pixabay:** "Photo by {creator} on {source}". The creator and
    source names are links.
  - **Openverse, Creative Commons BY:** "Photo by {creator} on {original
    host}, {license name}". Every part is a link: the creator, the work's
    page on its original host (Flickr, Wikimedia and so on, not Openverse)
    and the license deed.
  - **CC0 and Public Domain Mark:** credit the creator and host when known,
    without a license link.
  - **Edited copies:** when the copy was edited ("Edit first"), the credit
    ends with ", adapted". The media row records that it was adapted.
  - **Share-Alike licenses (BY-SA)** are filtered out as well as ND and NC,
    so an edited copy never carries a license obligation to its page.
- **Copy size.**
  - Vanilla Press stores the source's largest size up to 2,400px on the long
    edge.
  - If the source offers nothing that size, which happens with Openverse
    originals, the browser downsizes the image on a canvas before saving.
    It loads the image through the same-origin proxy.
  - Pixabay's 1,280px `largeImageURL` is accepted as is.
  - No server-side image library is added.
- **The credit is copied onto the figure when it is inserted.**
  - The renderers stay pure: they read credit attributes stored on the
    figure, not the media library.
  - The Media detail panel shows the credit fields and lets the user correct
    them. A correction applies to later inserts, not to posts that already
    use the image; the panel says so.
  - A normal upload can be given a credit by hand in the same panel, for
    example a photo a friend took.
- **Pixabay caching.** Pixabay's terms require caching search responses for
  24 hours, so the server caches them for that long. Other sources are
  cached briefly.
- **`edited_from`** stays empty for an edited web copy, because there is no
  library original. The source fields record its origin instead.

- **Pickers with no caption (decided with the user: "There needs to be
  some trust").**
  - Web search is offered wherever the media picker opens: figure insert,
    the featured image, component "Choose…" buttons, and the Media screen.
  - There are no separate interfaces, restrictions or warnings for places
    that show no caption.
  - The credit is still saved with the image in the library. Where it's
    shown on the page is the writer's call.

## Left to the builder

- Route names and payloads. For example, a search route that takes a query
  and returns normalized results, and an import route that takes a source
  and an item ID.
- How the picker shows "your library" and "from the web": tabs, a toggle,
  or a section.
- Paging or "load more" for results.
- The schema change for the credit:
  - It needs new media columns, mirrored to `content/media.json`.
  - It needs a figure attribute, or a non-editable part of the figure
    caption, that round-trips through the block AST and the published
    Markdown/HTML.
- Per-source adapters that turn each API's response into one result shape:
  - thumbnail;
  - large URL;
  - width and height;
  - description;
  - creator name and URL;
  - source page URL;
  - license name and URL.
- Debouncing search, caching results briefly, and the error copy for each
  source.
