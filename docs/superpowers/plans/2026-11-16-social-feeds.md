# Social feeds: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `<social-feed>` block shows one newest-first stream of a site's Bluesky and Mastodon posts and GitHub releases. Cook fills it at build time with a committed last-good fallback, the visitor's browser refreshes it and loads more on scroll, Vanilla Press inserts it as a block, and thomasapowell.com's home page uses it instead of `<tap-notes>`.

**Architecture:**
- **Cook owns the feed core.** One pure, browser-safe module (`scripts/social/feeds/core.js`) holds the normalizers for the three services, filtering, merging and the entry renderer. Fetchers take an injected `fetch`.
- **Cook fills the block at build.** A build step fetches each account once per build, writes per-account snapshots to `data/social-feeds/`, and fills every empty `<social-feed>`.
- **Vanilla Breeze owns the element.** `<social-feed>` wraps the existing `<activity-feed>`. It carries a verbatim copy of Cook's core, pinned by shared fixtures, and does the browser refresh and load-more.
- **Vanilla Press adds the block.** It adds a "Social feed" block with an account picker and a snapshot-only preview through the site's Cook, and stages the snapshots in each publish commit.

**Tech Stack:** Node ESM, `node:test`, linkedom (Cook), Vanilla Breeze web components with Playwright component specs, the Vanilla Press app and editor (no framework).

**Spec:** `~/src/vanilla-press/docs/superpowers/specs/2026-11-16-social-feeds-design.md` (approved 2026-11-16, be8743c). Mockup: `~/src/vanilla-press/.superpowers/brainstorm/69331-1794841556/content/feed-mixed-scroll.html`.

## Repos and branches

| Repo | Branch to create | From | Do not touch |
|---|---|---|---|
| `~/src/cook` | `feat/social-feeds` | `master` (da50d6b) | untracked `SOCIALSPEC-PLAN.md` |
| `~/src/vanilla-breeze` | `feat/social-feed` | `work/next` | untracked `untitled.md` |
| `~/src/vanilla-press` | `feat/social-feeds` | `main` | uncommitted `CLAUDE.md` change |
| `~/src/thomasapowell.com` | `feat/social-feed`, in a new worktree `~/src/thomasapowell.com-feeds` | `main` | the main checkout and every uncommitted or untracked file in it (`data/fetched/*`, `src/layouts/essay.html`, `test.html`, `thomas.html`, `content/fetched/`, the handoff files) |

## Global Constraints

- **No pushing or publishing.** No `git push` and no `npm publish` in any repo. Commits stay local. This overrides Cook's `AGENTS.md` push rule.
- **No new dependencies** in any repo.
- **Commit trailer.** Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, and no other trailer.
- **Versions.**
  - Cook goes to `2.12.0` (in `package.json` and the lockfile).
  - Vanilla Breeze keeps its version, because the owner sets it when publishing.
  - In the site, `package.json` is not changed.
- **Accounts** come only from `config/social.json`, through Cook's existing `getSocial()` and `normalizeAccounts(raw) → {all, visible, warnings}`. Never invent a handle. An account key is `<service>:<handle>` as stored, for example `bluesky:tpowell.bsky.social`, `mastodon:@user@instance`, `github:ProfPowell`. Bluesky fetches use the stored `did` when there is one, else the handle.
- **Feed services:** `bluesky`, `mastodon`, `github`. Other services in the config are ignored by feeds without a warning.
- **`<social-feed>` attributes (exact):**

  | Attribute | Meaning | Default |
  |---|---|---|
  | `accounts` | comma list of account keys | empty, meaning every visible feed-service account |
  | `tags` | comma list of hashtags without `#`, matched case-insensitively | none |
  | `items` | first batch size, an integer from 1 to 50 | `12` |
  | `height` | a CSS length matching `^\d+(\.\d+)?(rem\|em\|px\|vh)$` | `32rem` |
  | `hide-counts` | boolean | absent, so counts show |

  Invalid values fall back to the default with one build warning. A hidden account named in `accounts` is included. A key not in the config is skipped with a warning.
- **Content rules:**
  - Replies are never included. Reposts and boosts are always included.
  - Tags filter Bluesky and Mastodon only. A block with `tags` shows no GitHub items.
  - GitHub contributes releases only: published, not draft, not prerelease. It checks at most 10 of the user's most recently pushed public repos that are not forks or archived, and up to 5 releases per repo.
- **Filters apply before counting.** `items` counts items that pass. A page of results that comes back short is followed for up to 3 pages per account per load (build or browser), then the account stops.
- **Item shape (exact keys).** This is the shared contract between Cook and Vanilla Breeze:

  ```
  { id, service, source, url, date, text, tags, reposted,
    author: { name, handle, avatar, url },
    image?: { url, alt },
    counts?: { replies, reposts, likes },
    release?: { repo, tag, repoUrl, description, language } }
  ```

  - `id`: `<service>:<native id>`.
  - `source`: the account key.
  - `date`: ISO 8601. It is the repost time for a repost and `published_at` for a release.
  - `text`: plain text. Mastodon HTML is converted to text, with `<br>` and `</p><p>` becoming newlines and entities decoded.
  - `tags`: lower-case, without `#`.
  - Every URL in an item is `https:`. A non-`https:` URL drops that field: an image or avatar is left out, and an item whose `url` is not `https:` is left out entirely.

  A future `service: 'site'` must fit this shape unchanged.
- **Written markup** (Cook writes it; Vanilla Breeze renders browser items identically):

  ```html
  <social-feed …attributes as authored… style="--social-feed-height: 32rem">
    <activity-feed aria-label="Recent posts" data-infinite>
      <article data-activity data-id="ID" data-service="SERVICE">
        <img class="social-feed-avatar" src="AVATAR" alt="" width="40" height="40" loading="lazy">
        <header class="social-feed-head"><b>NAME</b> <span class="social-feed-handle">HANDLE</span> <a class="social-feed-permalink" href="URL"><time datetime="DATE">MEDIUM DATE</time></a> <span class="social-feed-source">SERVICE NAME</span></header>
        <p class="social-feed-reposted">Reposted</p>
        <p class="social-feed-text">TEXT</p>
        <a class="social-feed-image" href="URL"><img src="IMG" alt="ALT" loading="lazy"></a>
        <div class="social-feed-release"><a href="REPOURL">REPO</a> <span>DESCRIPTION</span> <span>LANGUAGE</span></div>
        <ul class="social-feed-counts">…</ul>
      </article>
    </activity-feed>
    <p class="social-feed-empty">Nothing yet</p>
    <p class="social-feed-more">More on <a href="PROFILE">Bluesky</a> · <a href="PROFILE">GitHub</a></p>
    <script type="application/json" class="social-feed-state">…</script>
  </social-feed>
  ```

  Optional parts are written only when present:
  - `reposted` only for reposts;
  - `image` only when the item has one;
  - `release` only for releases;
  - `counts` only when the item has counts and `hide-counts` is absent;
  - `empty` only when there are no items, and in that case `data-infinite` is left off.

  The counts list is three items, each written as `<li><span aria-hidden="true">↩</span> 3<span class="visually-hidden"> replies</span></li>`, with glyphs `↩ ⟲ ♡`:
  - Bluesky labels: `replies`, `reposts`, `likes`;
  - Mastodon labels: `replies`, `boosts`, `favourites`.

  `MEDIUM DATE` is `Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' })`. `SERVICE NAME` and profile URLs come from Cook's `SERVICES` and `profileUrl`. All text and attribute values are HTML-escaped.
- **State JSON** (in `.social-feed-state`):

  ```
  { accounts: [{ key, service, handle, did?, cursor?, done }], tags, newest, buffer }
  ```

  - `newest`: the newest item date per account key.
  - `buffer`: up to 24 items Cook fetched that pass the block's filters but weren't shown, newest first.
  - It holds no secrets and no token.
- **Snapshots:**
  - one file per account, `data/social-feeds/<service>-<slug>.json`, where `slug` is the handle lower-cased with every run of characters outside `[a-z0-9.]` turned into `-`;
  - content `{ "fetchedAt": ISO, "items": [...] }`, at most 100 items, replies already removed, unfiltered by tags;
  - written only after a fetch that succeeded and returned at least one item.
- **Network rules:**
  - Cook's build requests time out after 5 s, send a generic `User-Agent: cook-ssg`, and fetch each account at most once per build process.
  - `cook dev` reuses results for 10 minutes.
  - `COOK_OFFLINE=1` skips the network and uses snapshots.
  - Cook uses `GITHUB_TOKEN` from the environment for GitHub when it is set.
  - The browser uses no token, ever.
- **Failure behavior:**
  - A failed account at build time uses its snapshot. With no snapshot it contributes nothing, and one warning prefixed `[social-feed] ` is logged. The build never fails because of feeds.
  - In the browser, failures are silent: no error is shown and items already shown stay.
- **Vanilla Press commit paths:**
  - Publish and Update also stage `data/social-feeds`, exported as `FEED_SNAPSHOT_PATHS` from `src/app/site-git.js`.
  - A missing folder must not break a commit.
- **Tests:**
  - Tests use fixtures, never real posts or the live network.
  - Network calls go through an injected `fetch` in Node, or through `page.route` in Playwright.
  - Fixture handles are made-up (`alice.example.com`, `@bob@social.example`, `carol-dev`).

## Review Focus

1. **A `<social-feed>` saved by Vanilla Press must stay empty.** Cook fills only an empty one, so a filled save would freeze the feed. Pinned in Task 5.
2. **Hostile or odd post content must come out inert.** This covers `<script>`, `&`, quotes, Mastodon HTML with links and entities, and `javascript:` or `http:` URLs in avatar, image, link or permalink fields, in both the built and the browser markup. Pinned in Task 1, with the fixture copied into Task 4.
3. **A service that is down, slow or returns bad JSON at build** must still give an exit-0 build. The block then shows the snapshot, the other accounts, or "Nothing yet". Pinned in Task 3.
4. **Refresh and load-more must never duplicate an item already shown,** and the list must stay newest first. This includes a repost of a post already in the list. Pinned in Task 4.
5. **An `accounts` attribute naming a removed, hidden or unknown account, and an empty or missing `config/social.json`,** must not crash anything. A removed or unknown account is skipped with a warning, and a hidden one is included. With no config, the block shows "Nothing yet". Pinned in Task 3.

---

### Task 1: Cook: feed core (normalize, filter, merge, render)

**Files:**
- Create: `scripts/social/feeds/core.js`. It's pure and dependency-free, uses no Node built-ins, and is browser-safe.
- Create: the fixtures in `test/fixtures/social-feeds/`:
  - `bluesky-page.json`, a `getAuthorFeed` body with a post, a reply, a repost, a post with an external link card, a post with tag facets `#Reading`, and a post with `<script>` and `&` in its text;
  - `mastodon-statuses.json`, statuses with HTML content and entities, a reblog, an `http:` avatar, a media attachment and tags;
  - `github-releases.json`, with a release, a draft and a prerelease;
  - `expected-items.json`, the normalized items;
  - `expected-entry.html`, the rendered entries.
- Test: `test/social-feeds-core.test.js`

**Interfaces:**
- Produces, all exported from `core.js`:
  - `normalizeBluesky(body, account) → { items: Item[], cursor: string|null }`
  - `normalizeMastodon(statuses, account) → { items, cursor }`, where `cursor` is the last status id;
  - `normalizeGithubReleases(releases, repo, account) → Item[]`, where `repo` is `{ name, html_url, description, language }`;
  - `normalizeGithubEvents(events, account) → Item[]`. Only `ReleaseEvent` with `payload.action === 'published'` and no draft or prerelease counts. It produces the same `id` as `normalizeGithubReleases` for the same release: `github:<release id>`;
  - `matchesTags(item, tags) → boolean`;
  - `mergeItems(lists: Item[][], { tags, limit }) → Item[]`. It filters, dedupes by `id`, sorts by `date` descending with ties broken by `id`, and takes `limit`;
  - `renderEntry(item, { hideCounts, serviceName }) → string`;
  - `renderFeedParts({ items, accounts, hideCounts, services }) → { entries, empty, more }`, the three HTML fragments in the Global Constraints markup;
  - `escapeHtml(s)` and `safeHttps(url) → string|null`.
- `account` is `{ key, service, handle, did? }`.

- [ ] **Step 1:** Write failing tests in `test/social-feeds-core.test.js`:
  - `bluesky: drops replies, keeps a repost as the original author with reposted:true and the repost time as date`
  - `bluesky: tags from facets and record.tags, lower-cased`
  - `bluesky: link card thumb becomes image; post url is https://bsky.app/profile/<author handle>/post/<rkey>`
  - `mastodon: HTML content to plain text with newlines and decoded entities; reblog becomes reposted; http avatar dropped`
  - `github: releases skip draft and prerelease; text is "Released <repo> <tag>"`
  - `github: an event and a release for the same release share one id`
  - `mergeItems: dedupes by id, newest first, tags drop GitHub items, limit applies after filters`
  - `renderEntry: escapes <script> and & and quotes; never writes a javascript: or http: URL` (Review Focus 2)
  - `renderEntry: counts use service labels; hide-counts removes the list`
  - `normalized fixtures equal expected-items.json; rendered fixtures equal expected-entry.html`
- [ ] **Step 2:** Run `node --test test/social-feeds-core.test.js`. Expected: FAIL, because `core.js` is missing.
- [ ] **Step 3:** Implement `core.js` to the Global Constraints item shape and markup. Mastodon text conversion is a small linear tag-stripper, with no DOM. Generate `expected-*.json/html` once from the implementation and check them by hand against the constraints before committing.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Commit `feat(social-feeds): feed core`.

### Task 2: Cook: fetchers, paging and snapshots

**Files:**
- Create: `scripts/social/feeds/fetch.js`. It's browser-safe, and Task 4 copies it.
- Create: `scripts/social/feeds/snapshots.js`, Node only.
- Test: `test/social-feeds-fetch.test.js`

**Interfaces:**
- Consumes: Task 1's normalizers.
- Produces:
  - `fetchAccountPage(account, { fetch, cursor, timeoutMs = 5000, token, mode }) → { items, cursor, done }`:
    - `mode` is `'build'` or `'browser'`;
    - GitHub in `'build'` lists repos and then releases;
    - GitHub in `'browser'` uses `/users/<u>/events/public?per_page=30`, returns `done: true` and never pages older.
  - Endpoints:
    - Bluesky: `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=<did|handle>&filter=posts_no_replies&limit=30[&cursor=]`.
    - Mastodon: `https://<instance>/api/v1/accounts/lookup?acct=<user>`, then `/api/v1/accounts/<id>/statuses?exclude_replies=true&limit=40[&max_id=]`. Remember the looked-up id in `account.mastodonId` for later pages.
    - GitHub: `https://api.github.com/users/<u>/repos?sort=pushed&per_page=10`, then `/repos/<u>/<repo>/releases?per_page=5`. Send `Authorization: Bearer <token>` only when `token` is given.
  - `collectItems(account, { fetch, tags, want, token, mode, cursor }) → { items, cursor, done }`. It pages until `want` items pass `matchesTags`, at most 3 pages.
  - `snapshotPath(rootDir, account) → string`.
  - `readSnapshot(rootDir, account) → Item[] | null`.
  - `writeSnapshot(rootDir, account, items) → void`. It writes at most 100 items and never throws; it warns instead.

- [ ] **Step 1:** Write failing tests with an injected `fetch` that serves the Task 1 fixtures by URL:
  - `bluesky page uses did when present, else handle; passes cursor`
  - `mastodon looks up the account id once, then pages with max_id`
  - `github build mode skips forks and archived repos, caps 10 repos, sends the token only when given`
  - `github browser mode reads public events and reports done`
  - `collectItems stops after 3 pages for a rare tag`
  - `timeout after 5000 ms rejects (fake timers or a never-resolving fetch with timeoutMs: 20)`
  - `snapshot round trip; slug for "@Bob@Social.Example" is "bob-social.example"`. Pin the exact slug rule from Global Constraints.
  - `writeSnapshot never throws on an unwritable dir`
- [ ] **Step 2:** Run `node --test test/social-feeds-fetch.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement. Each request has one `AbortController` budget that covers headers and body. A non-OK status or a JSON shape it doesn't expect throws an `Error` naming the URL.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Commit `feat(social-feeds): fetchers and snapshots`.

### Task 3: Cook: fill `<social-feed>` at build, export, docs, 2.12.0

**Files:**
- Create: `scripts/social/feeds/block.js`, which holds `renderSocialFeed`. It's pure, Node and browser alike, and imports `SERVICES`/`profileUrl` from `../catalog.js`/`../accounts.js`.
- Create: `scripts/plugins/social-feed.js`, the build plugin: fetch cache, snapshots, DOM fill.
- Modify: `scripts/build.js`. Add the call right after `fillSocialLinks`: `await fillSocialFeeds({ file, allowType: ['.html'] })`. Reset the per-build cache where `socialData` runs.
- Modify: `scripts/dev.js`. Reuse results for 10 minutes, and rebuild on `config/social.json` change, as it already does.
- Modify: `scripts/social/index.js`. Also export `renderEntry`, `renderFeedParts`, `mergeItems`, `matchesTags`, `readSnapshot`, `snapshotPath` and `renderSocialFeed`.
- Create: `docs/social-feed.md`, modeled on `social-links.md`. It covers the attributes, the snapshot folder and the need to commit it, `COOK_OFFLINE`, `GITHUB_TOKEN`, and that browser refresh needs Vanilla Breeze's `<social-feed>`.
- Modify: `package.json` and the lockfile to `2.12.0`, and the ROADMAP or CHANGELOG note where Cook keeps one.
- Test: `test/social-feed-build.test.js`, using a fixture site in `test/fixtures/social-feed-site/`.

**Interfaces:**
- Consumes: Tasks 1 and 2, plus `getSocial`, `normalizeAccounts`, `SERVICES` and `profileUrl`.
- Produces:
  - `renderSocialFeed(attrs, { accounts, itemsByKey, cursorsByKey }) → string`, the inner HTML of one block. It's pure and is reused by Vanilla Press's preview with snapshot items;
  - the build fill, which applies only to `<social-feed>` with no element children and not inside `pre, code, template, textarea`, the same rule as `fillSocialLinks`;
  - the `style="--social-feed-height: …"` set on the element.

- [ ] **Step 1:** Write failing build tests. Run them with `COOK_OFFLINE` unset and a stubbed global `fetch`, or with an injection hook the plugin exports for tests, such as `setFeedFetch(fn)`:
  - `fills an empty <social-feed> with entries, more line and state JSON`
  - `leaves a <social-feed> that has children alone`
  - `accounts attribute: hidden account included; unknown key skipped with one [social-feed] warning` (Review Focus 5)
  - `no config/social.json: "Nothing yet", no data-infinite, build exit 0` (Review Focus 5)
  - `service throws or returns bad JSON: snapshot used; with no snapshot the other accounts still show; build exit 0` (Review Focus 3)
  - `each account fetched once although three blocks use it`
  - `successful fetch writes data/social-feeds/<service>-<slug>.json`
  - `COOK_OFFLINE=1: no fetch calls; snapshot used`
  - `invalid items/height fall back to 12 / 32rem with a warning`
  - `tags block: only matching posts, no GitHub`
  - `buffer holds up to 24 unshown matching items; state JSON has no token`
- [ ] **Step 2:** Run `node --test test/social-feed-build.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement. Accounts load lazily on the first page that has a live `<social-feed>`, and the cache is keyed by account key. A page with no `<social-feed` string keeps its bytes untouched.
- [ ] **Step 4:** Run `npm test`. Expected: all pass, with the existing count plus the new tests.
- [ ] **Step 5:** Commit `feat(social-feeds): <social-feed> build fill; 2.12.0`.

### Task 4: Vanilla Breeze: `<social-feed>`

**Files:**
- Create in `src/web-components/social-feed/`:
  - `core.js` and `fetch.js`: verbatim copies of Cook's `scripts/social/feeds/core.js` and `fetch.js`, each with a first-line comment `// Copied from cook-ssg 2.12.0 scripts/social/feeds/<file>. Do not edit here; parity-tested.`;
  - `logic.js`;
  - `styles.css`;
  - `api.json`, with the five attributes;
  - `static.html`, a built example made from the fixtures.
- Create: `tests/unit/fixtures/social-feed/`, verbatim copies of Cook's `test/fixtures/social-feeds/*`.
- Modify: register at the same points as `social-links`: `index.js`, `extras.js`, `index.css` and `core.css`.
- Test:
  - `tests/unit/social-feed.test.js`, for parity and files;
  - `tests/components/social-feed.spec.js`, for behavior, following `activity-feed.spec.js` and its `page.route` serving.

**Interfaces:**
- Consumes: the Cook markup and state JSON from Global Constraints, and `<activity-feed>`'s `activity-feed:load-more` event with `detail.done()` and `data-infinite`.
- Produces:
  - **On connect,** it reads the state. Then, once per page view, it fetches each account's first page in `'browser'` mode and prepends items newer than the newest shown. It also updates `counts` on items already shown, matched by `data-id`.
  - **On `load-more`,** it takes items from `buffer` first, then pages each account that isn't `done` from its cursor, with the same 3-page cap and tag filter. It appends in date order.
  - **When every account is done and the buffer is empty,** it removes `data-infinite`.
  - **Dedupe** is by `id` across everything shown.
  - **Failures are silent:** it catches each service's errors and marks that account `done`.
- CSS:
  - `social-feed activity-feed { max-height: var(--social-feed-height, 32rem); overflow-y: auto; overscroll-behavior: contain }`;
  - the card layout per the mockup, using tokens only;
  - `.social-feed-text { white-space: pre-line }`;
  - `.visually-hidden` from VB.

- [ ] **Step 1:** Write failing tests:
  - unit `core.js and fetch.js match the fixtures: normalized == expected-items.json, rendered == expected-entry.html` (parity, Review Focus 2);
  - unit `api.json lists accounts, tags, items, height, hide-counts`;
  - spec `refresh prepends a newer post and updates counts; nothing duplicated` (Review Focus 4);
  - spec `refresh with a repost of a shown post adds no duplicate` (Review Focus 4);
  - spec `load-more drains buffer before the network, then pages with cursor; removes data-infinite when done`;
  - spec `a service returning 403/500 shows no error and the shown items stay`;
  - spec `the list scrolls inside the block at the set height; the region is focusable and labelled "Recent posts"`;
  - spec `no JavaScript (javaScriptEnabled: false): built entries and more line visible`.
- [ ] **Step 2:** Run `npm test` and `npx playwright test tests/components/social-feed.spec.js`. Expected: FAIL.
- [ ] **Step 3:** Implement `logic.js` (`SocialFeed extends VBElement` or `HTMLElement` following `social-links`) and `styles.css`.
- [ ] **Step 4:** Run `npm test`, then the spec, then `npm run build:cem`. Confirm `custom-elements.json` has `social-feed`. Take a screenshot of `static.html` at 1280px and 390px for the report. Expected: pass, entry present.
- [ ] **Step 5:** Commit `feat(social-feed): mixed social stream element`.

### Task 5: Vanilla Press: the Social feed block

**Files:**
- Modify: `src/components/catalog.js`. Add an entry next to `social-links`:

  ```
  { tag: 'social-feed', label: 'Social feed', icon: <an icon the editor already has, e.g. the one Embeds uses>, group: 'Embeds',
    description: 'Recent posts and releases from your accounts, from Social.',
    kind: 'none', defaults: { items: '12' }, advanced: ['height', 'hide-counts'],
    attributes: accounts (type 'accounts'), tags (string), items (number), height (string), hide-counts (boolean) }
  ```
- Modify: `src/renderers/html.js`. Add `'social-feed'` to `ALWAYS_EMPTY`.
- Modify: `editor/assets/js/component-model.js`. `type: 'accounts'` becomes `control: 'accounts'`.
- Modify: the settings-form renderer that consumes `settingsFields`. The `accounts` control is a fieldset:
  - an "All accounts" checkbox, checked when the value is empty;
  - one checkbox per account from `GET /social`, labelled with the service name and handle, with hidden accounts marked "(hidden)";
  - Bluesky, Mastodon and GitHub only.

  Unticking "All" ticks every visible account. The value is the comma list of keys, or empty for "All".
- Create: `editor/assets/js/social-feed-preview.js`, modeled on `social-links-preview.js`. It's display-only and fills the live element's light DOM from `GET /social/feed`. Exact copy:
  - with no feed accounts: "No accounts yet: add them in Social", linking to `site.html?site=<id>&section=social`;
  - with Cook too old: "This site's Cook is too old to preview the social feed: update Cook".
- Modify: `editor/assets/js/blocks/component-view.js`. Call the preview for `social-feed` the way it does for `social-links`.
- Modify: `editor/assets/js/api-client.js`. Add `socialFeed(query)`.
- Modify: `src/app/social-routes.js`. Add `GET ${prefix}/social/feed?accounts&tags&items&hide-counts`, which returns `{ html }` from `cook.renderSocialFeed` with `cook.readSnapshot` items. It's snapshot only and never touches the network. It returns 409 `NEEDS_COOK` when the site's Cook lacks `renderSocialFeed`.
- Modify: `test/social/fixtures/cook-social.js`. Copy the new Cook exports verbatim, as the existing stand-in does.
- Test: `test/renderers/social-feed.test.js`, `test/components/catalog.test.js`, `test/editor/` (component-model), and a route test beside the existing social route tests.

**Interfaces:**
- Consumes: Cook 2.12.0's `renderSocialFeed`, `readSnapshot` and `normalizeAccounts`, loaded through `importCookSocial`.

- [ ] **Step 1:** Write failing tests:
  - `rendered <social-feed> is empty even after the editor preview filled it` (Review Focus 1);
  - `catalog has social-feed with the five attributes`;
  - `formFields maps type accounts to control accounts`;
  - `GET /social/feed returns snapshot html; 409 on old Cook; never calls fetch`;
  - `accounts control: empty value = All; unticking All writes the visible keys`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Also run the opt-in real-Cook run, `COOK_SOCIAL_MODULE=/Users/tpowell/src/cook/scripts/social/index.js node --test 'test/social/**/*.test.js'`. Then check in a scratch app on a fixture site (port 3027, not 3017):
  - insert the block and pick accounts;
  - save, and confirm the saved HTML has an empty `<social-feed accounts="…">`.

  Take screenshots for the report. Stop the scratch server afterwards. Expected: as stated.
- [ ] **Step 5:** Commit `feat(editor): Social feed block`.

### Task 6: Vanilla Press: publish carries feed snapshots

**Files:**
- Modify: `src/app/site-git.js`. Add `export const FEED_SNAPSHOT_PATHS = Object.freeze(['data/social-feeds']);`.
- Modify: `src/app/publish.js:279`. Publish and Update stage `...FEED_SNAPSHOT_PATHS`. Unpublish does too, because the build ran.
- Modify: `commitPaths`, only if it fails on a path that doesn't exist. Skip missing paths there.
- Test: `test/app/publish.test.js`

- [ ] **Step 1:** Write failing tests:
  - `publish commit includes data/social-feeds when the build wrote snapshots`;
  - `publish on a site with no data/social-feeds still commits and pushes`.
- [ ] **Step 2:** Run `node --test test/app/publish.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Commit `feat(publish): commit social feed snapshots`.

### Task 7: thomasapowell.com: home page uses `<social-feed>`

**Files** (in the worktree `~/src/thomasapowell.com-feeds`, branch `feat/social-feed` from `main`):
- Modify: `src/layouts/home.html:15`. Replace `<tap-notes n="2"></tap-notes>` with `<social-feed items="12"></social-feed>`. `<tap-repos n="3">` stays beside it, unchanged.
- Modify: `plugins/dataviz/blocks.js`. Remove the `tap-notes` case and `notesHtml`, wherever it's defined.
- Modify: `plugins/dataviz/fetched.js` and `config/data.js`. Remove `fetchBluesky`, the `bluesky` `withSnapshot` call and its `TEST_ROWS.bluesky`. GitHub (pinned repos) stays.
- Delete: `data/fetched/bluesky.json` in the worktree, with `git rm`.
- Create: `data/social-feeds/`, committed from one real build: `npm run build` with the network, which writes the two snapshots.
- Modify: `src/assets/css/site.css`. Make the feed match the plate look: Plex fonts, rules, mute colors, the `--social-feed-height` set so it sits beside Table 3.
- Modify: tests `test/pages.test.js:80-91`, `test/blocks.test.js` and `test/fetched.test.js`. The home page has `.tap-cols social-feed` beside `.tap-repos`, and the notes tests go.
- For the build, run `npm install --no-save ~/src/cook ~/src/vanilla-breeze` in the worktree. Do not commit `package.json` or the lockfile, and confirm `git status` shows neither.

- [ ] **Step 1:** Take a "before" screenshot of the home page at 1280px and 390px from a build of `main`.
- [ ] **Step 2:** Update the tests, then run `npm test`. Expected: the home test fails.
- [ ] **Step 3:** Make the changes, then run `npm run build` once with the network to create the snapshots. Then run `COOK_OFFLINE=1 TAP_OFFLINE=1 npm run build`. Expected: exit 0, no `[social-feed]` warnings in either run.
- [ ] **Step 4:** Run `npm test`. Expected: all pass. Take "after" screenshots at the same sizes, scroll the feed, and screenshot again. Put all of them in the report.
- [ ] **Step 5:** Commit `feat: home page social feed replaces notes`. Leave the worktree in place for the user.

---

## After the plan

- **Hand the owner a publish order:**
  1. Cook 2.12.0;
  2. Vanilla Breeze, with `<social-feed>` and a version of the owner's choice;
  3. merge and push Vanilla Press;
  4. the site's `cook-ssg ^2.12.0` and `vanilla-breeze` bump, then merge the feeds worktree and push.

  None of these is done by the executor.
- **Merge note for the site:** the main checkout has an uncommitted change to `data/fetched/bluesky.json`, which this branch deletes. The owner discards or commits that change before merging.
- **Section pages:** to give the Code or Reading section its own feed, add a Social feed block to that section's page in Vanilla Press (GitHub only for Code, tag `reading` for Reading). That is content work, not part of this plan.
