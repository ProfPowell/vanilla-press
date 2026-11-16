# Social feeds — design

Status: draft, awaiting approval (2026-11-16); builder check done
Project 2 of 3 in the Vanilla Press services work. Project 1 (accounts and
profile links, plus SocialSpec) is live. Project 3 (posting to Bluesky on
publish) comes later.

## Intent

A site owner wants their recent activity elsewhere — Bluesky posts, Mastodon
posts, GitHub releases — shown on their own site as one readable stream,
without hand-written fetch code per site. They drop a "Social feed" block on a
page in the Vanilla Press editor, it shows the latest items, and it stays fresh
without a rebuild.

thomasapowell.com is the first site. Its hand-written feed code
(`plugins/dataviz/fetched.js`, the `data/fetched/bluesky.json` snapshot, the
`<tap-notes>` block) is what this replaces.

Direction, not scope: the owner eventually wants to write everything on their
own site and send it out to the services (a microblog), originating nothing
elsewhere except reposts. The item shape and stream below must leave room for
site-originated posts to join the stream later.

## What the visitor sees

Mockup: `.superpowers/brainstorm/69331-1794841556/content/feed-mixed-scroll.html`
(the "mixed stream in a scrolling region" screen the owner accepted).

- **One stream**, newest first, merging the block's accounts.
- **Each entry is a post card** (the owner chose the social-style card over a
  compact list): avatar, display name, handle or short time, a small service
  label (Bluesky / Mastodon / GitHub), the text, a link-card image when the post
  has one, and counts in that service's own terms (Bluesky replies / reposts /
  likes; Mastodon replies / boosts / favourites; GitHub none, or stars on the
  repo card).
- **GitHub entries are releases only** — owner's words: "limited to releases
  obviously otherwise it will be overwhelming". A release card shows the release
  line ("Released cook 2.11.1") and a small repo card (name, description,
  language). No pushes, issues, stars or other events.
- **Replies are left out. Reposts stay in.** A repost shows the original
  author's card with a "reposted" mark (my call on the look).
- **Every entry links to the item on its service.** A line at the bottom links
  to each included account ("More on Bluesky · GitHub").
- **A scrolling region, not an iframe.** The block has a fixed height; the list
  scrolls inside it and the page does not move. It is keyboard-reachable
  (focusable, labelled region). The owner said "iframe or scrollable like"; I
  chose an in-page region so the items work without JavaScript, take the site's
  styles, and are readable by search engines and screen readers.
- **10–12 items to start** (default 12). Scrolling near the bottom loads the
  next batch in the browser.
- **With JavaScript off** the visitor sees the first batch as of the last
  publish, and the "More on …" links.
- **Empty filter result**: a short "Nothing yet" line linking to the services,
  never an empty box (my call).

## Where blocks go

- **Home page**: the full stream (all the block's accounts, no tag filter).
  On thomasapowell.com this replaces `<tap-notes>` in `src/layouts/home.html`.
  `<tap-repos>` (pinned repos) stays beside it, unchanged — owner: "the pinned
  repos is different its like a list of links".
- **Section / topic pages**: a block filtered to fit the section.
  - By account: the Code section is a block with only GitHub ticked.
  - By hashtag: the Reading section is a block with tag `reading`, showing only
    posts carrying `#reading`. Tags filter Bluesky and Mastodon posts (their own
    tag data: Bluesky facet tags, Mastodon status tags). A tag-filtered block
    shows no GitHub releases.
- The owner mentioned a later alternative to hashtags — marking on the site
  which category an external post belongs to. Not in this project.

## Block options (set per block in the editor)

| Option | Default | Notes |
|---|---|---|
| Accounts | all | Picked from the Social screen's accounts. "All" means every **visible** account; hidden accounts stay out of "all" but can be ticked by hand. An account added later joins blocks still on "all", not hand-picked ones. |
| Tags | none | One or more hashtags; a post matches if it carries any of them. |
| Items | 12 | First batch size, built into the page. |
| Height | builder's call (around 32rem) | Height of the scrolling region. |
| Counts | on | Show reply / repost / like counts. |

Replies are always excluded and reposts always included; these are not options
(owner's choice, stated once for all blocks).

## How it works

Settled in the earlier brainstorm and kept:

1. **Cook fills the block at build time.** For each `<social-feed>` element
   with no element children, Cook fetches the block's accounts, filters
   (no replies; tags if set), merges newest first, takes the first N, and
   writes the entry markup into the element. Same pattern as `<social-links>`
   (`scripts/plugins/social-links.js`): accounts come from `config/social.json`
   via `getSocial()`/`normalizeAccounts`.
2. **Last-good fallback.** A failed or empty fetch for an account never fails
   the build and never empties the block: Cook uses that account's last good
   result. Hosting builds from the pushed repo on a fresh clone
   (`src/app/publish.js`: "hosting deploys from the pushed repo"), so the
   snapshots must be committed. My call: every Cook build writes the snapshot
   files (one per account) into the site repo, and Vanilla Press stages those
   snapshot files in each publish commit alongside the post, so the pushed repo
   always carries the snapshot from the last publish. A hosting build that
   can't reach a service falls back to that. Exact path and format are the
   builder's; they must not collide with the site's existing `data/fetched/`
   (which the owner manages by hand until it retires).
3. **The visitor's browser refreshes** after the page loads: it asks each
   account's service for items newer than the newest built-in item and adds
   them at the top, and updates counts on the shown items. Only public sources
   are fetched from the browser (Bluesky public API, Mastodon public API, GitHub
   public REST). No tokens in the browser, ever.
4. **Loading more on scroll** fetches the next older batch per account in the
   browser and merges it in order. Uses Vanilla Breeze's existing
   `<activity-feed>` (WAI-ARIA feed, `data-infinite` sentinel, relative times,
   `activity-feed:load-more`) rather than a new scroll mechanism.
5. **Service failures in the browser are silent.** If one service refuses
   (GitHub's unauthenticated rate limit is the likely one), the stream keeps
   going with the others and shows no error. Built-in items stay.

### Fetch and filter rules (my calls, from the builder check)

- Filters apply **before** counting: N means N items that pass (no replies,
  matching tags), so fetches over-ask. When a tag is rare, Cook and the browser
  page back through an account's posts up to a fixed cap (builder picks, a few
  pages), then stop; a short result is fine. Load-more stops (removes
  `data-infinite`) when every account has run out or hit the cap.
- GitHub releases: published, non-draft, non-prerelease releases, sorted by
  their publish time against posts. Cook may use a `GITHUB_TOKEN` from the build
  environment (the site already does for pinned repos); without one it uses the
  public API. To bound cost, it scans a capped number of the user's most
  recently pushed public, non-fork, non-archived repos (builder picks the cap).
- Mastodon instances that refuse public reads or lack CORS in the browser fall
  back silently to the built items. No allowlist.
- Ship order: Cook, then Vanilla Breeze, then Vanilla Press, then the site
  (whose `<tap-notes>` retirement lands last). The owner publishes Cook and
  Vanilla Breeze to npm between steps.

## Where the code lives

- **Cook**: fetchers and normalizer per service, the merge/filter, last-good
  handling, and the build plugin that fills `<social-feed>`. Exported for reuse
  the way `cook-ssg/social` is. Documented in Cook's docs like `social-links.md`.
- **Vanilla Breeze**: a `<social-feed>` web component built on
  `<activity-feed>` — the post-card styling, browser refresh, load-more.
  Without JavaScript it is just the built markup.
- **Vanilla Press**: a "Social feed" block in the editor's Embeds group next to
  "Profile links", with the options above. Saved empty (like `social-links`,
  `ALWAYS_EMPTY` in `src/renderers/html.js`) so Cook always fills it fresh.
  The account picker lists the Social screen's accounts.
- **thomasapowell.com**: home page uses the new block in place of `<tap-notes>`;
  `<tap-notes>`, `fetchBluesky` and the Bluesky snapshot retire. Bump
  `cook-ssg` and `vanilla-breeze`.

One normalizer shape should be shared by Cook (build) and the component
(browser) so a built entry and a browser-fetched entry render identically —
how to share it is the builder's call. The item shape must carry enough to
add a future "site" source (site-originated posts) without reshaping.

## Goals

- One block, any page, any mix of the site's accounts, filtered by account or
  hashtag.
- Fresh for visitors without a rebuild; never broken by a service outage at
  build or view time.
- Works and reads properly without JavaScript.
- Retires the site's hand-written Bluesky fetch code.

## Non-goals

- Posting to services (project 3) and site-originated microblog posts.
- Categorising external posts from the site (the hashtag alternative).
- Replies, threads, or any interaction (liking, replying) from the site.
- GitHub activity other than releases; pinned repos.
- Weather (stays in the browser, unchanged).
- Bluesky domain handles (`/.well-known/atproto-did`) — later.

## Anti-goals

- A feed that can fail a build or publish.
- An empty or broken-looking box when a service is down or a filter matches
  nothing.
- Tokens or secrets reaching the browser.
- An iframe embed that hides content from search, screen readers and no-JS
  visitors.
- A wall of GitHub noise.

## Constraints

- Accounts come only from `config/social.json` (Cook ≥ 2.10 social config).
  Never invent handles or content.
- Tests use fixtures, not real posts or live network.
- Vanilla Breeze components, no framework; progressive enhancement.
- Browser fetches go straight to the services' public APIs (all three send
  CORS headers for public reads). Visitors' browsers therefore contact those
  services — accepted by the owner when choosing browser refresh.
- Cook and Vanilla Breeze are published to npm by the owner; nothing is pushed
  or published without the owner's OK at that moment.

## Left to the builder

- How GitHub releases are found for a user (e.g. per-repo releases at build
  time, public events filtered to releases in the browser), within the
  releases-only rule and the unauthenticated browser limit. Forks and archived
  repos stay out.
- Snapshot location and format (subject to surviving a fresh clone).
- Exact card markup, styles, avatar source, link-card image handling, relative
  time formatting (reuse `<activity-feed>`'s).
- Height default; how the block passes its options to the browser component.
- Cook's handling of a page with several feed blocks for the same account
  (fetch once per build).

## Calls I made (for the owner to check)

- In-page scrolling region instead of an iframe.
- Hidden accounts excluded from "all" but selectable.
- Accounts added later join "all" blocks only.
- Tag-filtered blocks show no GitHub.
- Silent per-service failure in the browser.
- "Nothing yet" line for an empty result.
- Reposts shown as the original author's card with a "reposted" mark.
- Snapshots written by every build and committed by Vanilla Press publishes.
- Filters before counting, with a paging cap for rare tags.
- GitHub: stable releases only; build may use `GITHUB_TOKEN`; capped repo scan.
- Silent fallback for Mastodon instances that refuse browser reads.
