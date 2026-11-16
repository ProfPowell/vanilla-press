# Social accounts and profile links

Date: 2026-11-15 · Status: approved 2026-11-15
Repos: `~/src/cook`, `~/src/vanilla-breeze`, `~/src/vanilla-press`, `~/src/thomasapowell.com`

## Where this sits

Vanilla Press is getting services and social integration in three projects, done in
this order (agreed with the user):

1. **Accounts and links** (this document): the site's list of accounts, a screen in
   Vanilla Press to manage it, and a `<social-links>` component that shows them.
2. **Feeds**: Bluesky, Mastodon and GitHub feed blocks, fetched by Cook at build time
   and refreshed in the visitor's browser by a Vanilla Breeze component.
3. **Posting**: post a link card to Bluesky when a post is first published.

Projects 2 and 3 read the account list this project creates, so its shape has to
serve them too. They get their own designs later.

## Intent

thomasapowell.com hard-codes its Bluesky and GitHub links in the footer of
`src/layouts/base.html` (`https://bsky.app/profile/${social.bluesky}`), with the handles in
`config/site.json`. Adding Mastodon means editing a layout and some data code. The
user wants accounts to be something a site *has*, managed in Vanilla Press, and
shown by one specialized component that can go anywhere, though it mostly lives
in the footer.

The user's main concern across the whole effort is **data correctness**. A profile
link to the wrong account, or to one that doesn't exist, is the worst outcome here.
A missing link is a much smaller problem.

## Goals

- A site keeps its accounts in one committed file that Vanilla Press edits and
  Cook reads.
- In Vanilla Press, the user adds, reorders, hides and removes accounts. Each
  account is checked against the real service before it is saved.
- `<social-links>`, placed once in a layout's footer, lists the site's accounts on
  every page. Adding an account in Vanilla Press shows it on the next publish with
  no layout edit.
- The same component works in a post, a page or a layout, with settings to pick
  which accounts it shows and how.
- Links are plain HTML written at build time. They need no JavaScript.
- Mastodon links carry `rel="me"`, so the Mastodon profile can show the site as
  verified.
- thomasapowell.com moves to it. The footer's Bluesky and GitHub links come from
  the account list, and `config/site.json` stops holding handles.

## Non-goals

- Feeds, posting, and any credential or API key. Those are projects 2 and 3.
- Share buttons for visitors. Vanilla Breeze's `share-wc` already does that.
- The SocialSpec `/.well-known/` files (see "Relationship to the SocialSpec plan").
- Follower counts, avatars or any live data in the links.

## Anti-goals: failures even if it technically works

- A link that points to the wrong account or to an account that doesn't exist.
- A footer that breaks, or a build that fails, because the list is empty, a
  service is unknown or the file is missing.
- Links that only appear once JavaScript runs.
- A row of bright brand logos that ignores the site's theme. In Dataviz D the
  links should still read like the current "Feed · Bluesky · GitHub" footer line.

## Relationship to the SocialSpec plan

`~/src/cook/SOCIALSPEC-PLAN.md` (untracked, not approved) plans:
- a `config/social.json` holding `about`, `contact` and `following`;
- Cook output of SocialSpec files;
- a Vanilla Press **Social** screen, already listed in `site-nav.js` as `LATER = ['Analytics', 'Social']`.

This design uses the same file and the same screen, so the two fit together
whichever lands first:

- The account list is a new top-level key, `accounts`, in `config/social.json`.
  Each tool ignores keys it doesn't own, as `theme.json` already does.
- Cook gets one `getSocial()` reader that both features use. Whichever project lands
  second extends it rather than adding a second reader.
- The Vanilla Press Social screen starts with one panel, **Accounts**. SocialSpec's
  About, Contact and Following panels join it later.

Order, decided by the user: **this project first, SocialSpec right after.** This
project takes Cook **2.10.0** and writes `getSocial()`. The SocialSpec plan then
extends `getSocial()` instead of creating it, and takes the next minor version. Cook's `feat/layout-invisible-chars` (2.9.1) isn't
published yet, so this work branches from it, or from master once it merges.

## The account list

`config/social.json`:

```json
{
  "accounts": [
    { "service": "bluesky", "handle": "tpowell.bsky.social", "did": "did:plc:…" },
    { "service": "github", "handle": "ProfPowell" },
    { "service": "mastodon", "handle": "@tpowell@mastodon.social", "hidden": true },
    { "service": "link", "label": "Résumé", "url": "https://…" }
  ]
}
```

- **Order is display order.** The array order is the order the component shows.
- **`hidden: true`** keeps an account in the list but out of every `<social-links>`.
  Later projects can still use it, for example to read a feed from it.
- **The service catalog is fixed in code**, and shared by Cook and Vanilla Press.
  First set:
  - Bluesky, Mastodon, GitHub, LinkedIn and YouTube. Each has a handle format, a
    profile URL built from the handle, a display name and an icon name.
  - `link`, which carries its own `label` and `url` for anything else.
  - An entry whose service Cook doesn't know is skipped with a build warning.
- **Stored facts are checked facts.** Vanilla Press writes only what it has
  checked (see "Checking an account"). A hand-edited file is trusted, but Cook
  still validates handle syntax and URL scheme (`https:` only). Bad entries are
  skipped with a warning. They never break the build.
- **Profile URLs are built from handles, not stored.** The catalog turns a handle
  into a URL, so one handle can't be paired with the wrong URL. Only `link` stores
  a URL.
  - Bluesky: `https://bsky.app/profile/<handle>`
  - Mastodon: `@user@instance` → `https://<instance>/@<user>`
  - GitHub: `https://github.com/<handle>`
- **Bluesky also stores the account's DID**, found when the account is checked.
  The handle is what people see. The DID is the permanent id that projects 2 and 3
  will use, and it doesn't change if the handle does.

## `<social-links>` (Vanilla Breeze)

A new Vanilla Breeze component in `src/web-components/social-links/`, following the
house layout: `api.json`, `styles.css`, `static.html` and, if needed, `logic.js`.

- **It works as plain HTML.** Its content is an ordinary `<ul>` of
  `<li><a href>` links. Cook writes that list at build time, and a person can
  write it by hand on a site Cook doesn't build. Styling and icons come from the
  component's CSS and Vanilla Breeze's existing icons (`icon-wc` already has
  `bluesky`, `mastodon` and others, used by `share-wc`). No JavaScript is
  required to show links.
- **Attributes**, read by Cook at build time and by the CSS:
  - `services`: a comma list of service ids to include, defaulting to all
    visible accounts.
  - `variant`: `icon`, `label` or `icon-label` (default), matching `share-wc`.
    With `icon`, the label stays in the accessible name.
- **Styling** uses theme tokens only. It's quiet by default and fits a footer line.
  There are no brand colors unless a `color` attribute asks for them, again
  matching `share-wc`.
- **Each link** is a real `<a>` with the service's display name as its accessible
  name (for example "Bluesky"). Mastodon links get `rel="me"`. Every link opens in
  the same tab, like the current footer.

## Cook

- **`getSocial()`** in `scripts/utils/config/config.js` reads `social` from
  `config/main.js`, else `config/social.json`. It re-reads on every call, like
  `getTheme()` and `getPrograms()`, so `cook dev` picks up Vanilla Press's
  rewrites. Bad JSON gives a warning and is treated as no file.
- **Template data:** `social.accounts` on the build data, holding the visible,
  valid accounts, each with `service`, `handle`, `url`, `label` and `icon`. A
  layout can then `data-repeat` over the accounts if it wants something
  `<social-links>` doesn't do.
- **The fill step:** every `<social-links>` element in the output gets its `<ul>`
  written from the account list and its attributes. Placement can be anywhere:
  - a layout;
  - an include;
  - a post body (Vanilla Press posts are HTML documents);
  - a Markdown page.

  An element that already has content is left alone, so hand-written links win.
  With no matching accounts, the element is left empty, which renders nothing,
  and the build continues.
- **The pure render function and the service catalog** are exported (for example
  from `cook-ssg/social`), so Vanilla Press shows exactly what Cook will build.
- **Byte-identical rule:** a site with no `social` setting and no `<social-links>`
  builds byte-identically, the same rule `test/regression-byte-identical.test.js`
  enforces today.

## Vanilla Press: the Social screen

- **Navigation:** `social` moves from `LATER` to `SECTIONS` in
  `app/assets/js/site-nav.js`. The screen is per site, because accounts belong to
  a site. The app-wide Services screen (`app/services.html`) is unchanged. It holds
  this computer's keys, and project 3's Bluesky app password will go there.
- **The Accounts panel** shows a list:
  - each row shows the service icon and name, the handle, the checked display
    name and the profile URL as a link;
  - each row has reorder, hide/show and remove controls;
  - "Add account" picks a service, then asks for a handle, or for a label and URL
    for `link`.
- **Checking an account.** Before an account is saved, Vanilla Press's server
  looks it up on the real service using public, keyless endpoints, and shows the
  result so the user can confirm it's them. Display name, avatar if offered,
  handle:
  - Bluesky: resolve the handle to a DID, then read the public profile.
  - Mastodon: WebFinger on the instance, then the public account.
  - GitHub: the public users endpoint.
  - LinkedIn and YouTube have no keyless lookup. They get syntax checks only, and
    the row says "Not checked: open the link to make sure it's you".
  - `link`: the URL must be `https:`. Whether it loads is not checked.

  An account that doesn't exist is refused with the service's answer in plain
  words. If the service can't be reached, the user can save anyway, and the row
  is marked "Not checked yet". It can be re-checked later.
- **Saving** works like Programs. Each change writes `config/social.json` with
  known keys first, so hand-added keys survive, then makes one commit,
  `Social: accounts`, and pushes it. Only that path is committed. It isn't added to
  `BACKUP_PATHS`.
- **Version gate:** the screen is enabled only when the site's `cook-ssg` has the
  fill step. Otherwise it says which version is needed. This matches the
  SocialSpec plan's gate.
- **In the editor**, `<social-links>` is available as a block through the
  existing component catalog, from its `api.json`. The block's preview renders
  the real links with Cook's exported render function and the site's current
  account list. Its settings are the two attributes. If the list is empty, the
  block shows "No accounts yet: add them in Social" with a link to the screen.

## thomasapowell.com

- `config/social.json` gets the Bluesky and GitHub accounts now in
  `config/site.json`. Both are checked through Vanilla Press, or by the builder
  with the same lookups.
- In `base.html`'s footer, the hard-coded Bluesky and GitHub `<li>`s are replaced by
  `<social-links variant="icon-label">`. The other footer items stay as they are:
  - Feed;
  - Programs;
  - Colophon;
  - Hot take.

  The footer must look as it does today. Matching `.tap-footer-links` takes either
  site CSS for the component inside it, or putting `<social-links>`' own items into
  the existing row. That's the builder's call, as long as it looks the same.
- `config/data.js` stops reading `site.bluesky` and `site.github`.
  - The `social` data value is now Cook's.
  - The feed fetchers read the handles from `social.accounts` until project 2
    replaces them.
  - `bluesky` and `github` leave `site.json`.
- The site's `cook-ssg` dependency moves to the release with the fill step. The
  site is built locally to check the footer before anything is pushed.

## Constraints

- No pushes and no `npm publish` without the user's OK in that moment. Cook is
  published by the user.
- No new dependencies in any repo.
- Vanilla Breeze conventions:
  - the component spec template (`_component-spec-template.md`);
  - `api.json` schema;
  - tokens only in CSS;
  - static fallback page.
- Vanilla Press conventions:
  - ES modules, named exports, JSDoc;
  - no `alert/confirm/prompt`;
  - Vanilla Breeze custom properties in UI CSS;
  - pure view modules split from page wiring (as in `services-view.js` / `services-page.js`).
- Tests use fixtures and stand-in services, never the real accounts or the live
  site's content. Network lookups are injected (`fetch`), as in
  `service-routes.js`.
- Never invent an account or handle. Only the user's existing Bluesky and GitHub
  handles go in the site's file.

## Settled details (from the builder check)

- **Icons are CSS, not `icon-wc`.** `icon-wc` needs JavaScript, and links must show
  without it. Each item in the written list is:

  ```html
  <a href="…"><span class="social-icon" data-service="bluesky" aria-hidden="true"></span><span>Bluesky</span></a>
  ```

  Mastodon links also carry `rel="me"`. The component's CSS paints each icon as a
  `mask` filled with `currentColor`, so icons follow the text color. The masks
  come from Vanilla Breeze's existing SVGs:
  - `custom/bluesky.svg`, `custom/mastodon.svg`
  - `lucide/github.svg`, `lucide/linkedin.svg`, `lucide/youtube.svg`
  - a generic link icon for `link`

  A site overrides a service's mask with one CSS rule. thomasapowell.com maps its
  existing `data-glyph` artwork that way, so the footer looks as it does now. No
  new Vanilla Breeze icons are needed.
- **Handle rules and URLs, pinned.** Input is trimmed, and checks and stored
  values are lower-case where the service is case-insensitive.

  | Service | Accepted input | Stored as | Profile URL |
  |---|---|---|---|
  | Bluesky | `name.bsky.social`, any domain handle such as `thomasapowell.com`, an optional leading `@` | handle without `@` | `https://bsky.app/profile/<handle>` |
  | Mastodon | `@user@instance` or `user@instance` | `@user@instance` | `https://<instance>/@<user>` |
  | GitHub | 1–39 characters, letters, digits and single hyphens, not leading or trailing; an optional `@` | as typed, minus `@` | `https://github.com/<handle>` |
  | LinkedIn | the `in/` slug, or a pasted `linkedin.com/in/<slug>` URL | slug | `https://www.linkedin.com/in/<slug>` |
  | YouTube | `@handle`, or a pasted `youtube.com/@handle` URL | `@handle` | `https://www.youtube.com/@handle` |
  | `link` | a label and an `https:` URL | both | the URL |

  Pasting a full profile URL for any service is accepted and turned into the
  handle.
- **Cook's fill step runs on the final HTML of each page**, after layouts and
  Markdown and before minifying. It uses a real HTML parse, not a regex.
  - It skips `<social-links>` inside `<pre>`, `<code>`, `<template>` and
    `<textarea>`, so documentation examples are left alone.
  - "Already has content" means it has a child element. Whitespace and comments
    don't count.
  - The byte-identical rule covers any page with no live `<social-links>`.
- **Hidden accounts and the DID.**
  - `social.accounts` in the template data holds visible accounts only.
    `social.allAccounts` holds every valid account, hidden ones included, for
    projects 2 and 3.
  - Until project 2 replaces them, thomasapowell.com's feed fetchers take their
    handles from `social.allAccounts`. Hiding Bluesky in the footer then keeps the
    Bluesky feed block working.
  - The DID is stored and not used in this project.
  - There is no build-time re-check, so builds never depend on the network for links.
  - Vanilla Press re-checks every account each time the Social screen opens. If a
    Bluesky handle no longer resolves to the stored DID, it flags the row with
    "This handle now points to a different account" and offers the account's
    current handle.
- **Unpublished Cook.**
  - During development, Vanilla Press and thomasapowell.com use the local Cook
    checkout through a `file:` link that is never committed.
  - Vanilla Press tests use a stand-in for the catalog and render function, as the
    SocialSpec plan already requires.
  - The `cook-ssg` version bumps in both repos are committed only after the user
    publishes Cook.

## Left to the builder

- Exact module names and where the shared catalog lives, as long as Cook and
  Vanilla Press use the same one.
- Whether `<social-links>` needs any `logic.js` at all.
- How the Accounts panel looks, within the Programs and Services screens' style.
- Footer CSS for thomasapowell.com, as long as it looks unchanged.

## My calls (made for the user, to check)

- **One file and one screen with SocialSpec.** Accounts live in
  `config/social.json` under the per-site **Social** screen, not in the app-wide
  Services screen. Keys and passwords stay in Services.
- **Profile URLs are always built from handles**, never typed. Typed URLs are
  only for `link`.
- **Bluesky's DID is stored** alongside the handle, for projects 2 and 3.
- **LinkedIn and YouTube are in the first set, unchecked.** Weather is not an
  account. It stays a site setting until project 2.
- **Icons are CSS masks** from Vanilla Breeze's existing SVGs, not `icon-wc`, so
  they show with no JavaScript.
- **Hidden accounts stay available** to feeds as `social.allAccounts`.
- **No build-time re-check.** Vanilla Press re-checks accounts when the Social
  screen opens.
- **Bluesky domain handle** (`thomasapowell.com` as your handle): wanted by the user, but
  only once the site itself is done. It's out of this project. Later, Cook writes
  `/.well-known/atproto-did` from the stored DID.
