# Social accounts and profile links: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A site's accounts live in `config/social.json`, are managed and checked on a Social screen in Vanilla Press, and are shown by a `<social-links>` element that Cook fills with plain links at build time. thomasapowell.com's footer moves to it.

**Architecture:**
- **Cook owns the catalog.** Cook holds the service catalog, handle parsing, profile URLs and the links renderer, exported as `cook-ssg/social`.
- **Cook fills the element at build.** A build step fills every live `<social-links>` on every page.
- **Vanilla Breeze owns the element.** It ships the element: CSS icons and variants, plus a minimal definition so it appears in the component manifest.
- **Vanilla Press reuses Cook.** It loads `cook-ssg/social` from the site's own Cook, as it already does for `cook-ssg/layouts`. It checks accounts against the real services, writes and commits `config/social.json`, and previews the links in the editor.

**Tech Stack:** Node ESM, `node:test`, linkedom (Cook), Vanilla Breeze web components, Vanilla Press app and editor (no framework).

**Spec:** `~/src/vanilla-press/docs/superpowers/specs/2026-11-15-social-accounts-links-design.md` (approved, 9df8c5c)

## Repos and branches

| Repo | Branch to create | From | Do not touch |
|---|---|---|---|
| `~/src/cook` | `feat/social-accounts` | `feat/layout-invisible-chars` (c2d16af) | untracked `SOCIALSPEC-PLAN.md` |
| `~/src/vanilla-breeze` | `feat/social-links` | `work/next` | untracked `untitled.md` |
| `~/src/vanilla-press` | `feat/social-accounts` | `fix/layout-editor-polish` | uncommitted `CLAUDE.md` change |
| `~/src/thomasapowell.com` | `feat/social-links`, in a new worktree `~/src/thomasapowell.com-social` | `main` | the main checkout and all its uncommitted files |

## Global Constraints

- No `git push` and no `npm publish` in any repo. Commits are local. The user publishes and approves pushes. This overrides cook's `AGENTS.md` push rule.
- No new dependencies in any repo.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No other trailer.
- Cook version: `2.10.0` (package.json, ROADMAP note).
- Config file: `config/social.json`, top-level key `accounts`. Every other top-level key (SocialSpec's `about`, `contact`, `following`) is preserved untouched by every writer.
- Accounts are an ordered array. Array order is display order.
- Fields per account: `service`, `handle`, `did` (Bluesky only), `hidden`, `label` and `url` (`link` only). Vanilla Press may also write `checked`: `"yes"`, `"no"` or `"never"`.
- Services and rules (spec table, verbatim):

  | Service | Accepted input | Stored as | Profile URL |
  |---|---|---|---|
  | `bluesky` | `name.bsky.social`, any domain handle, optional leading `@` | handle without `@`, lower-case | `https://bsky.app/profile/<handle>` |
  | `mastodon` | `@user@instance` or `user@instance` | `@user@instance`, lower-case instance | `https://<instance>/@<user>` |
  | `github` | 1–39 of letters, digits, single hyphens, not leading or trailing; optional `@` | as typed minus `@` | `https://github.com/<handle>` |
  | `linkedin` | the `in/` slug or a pasted `linkedin.com/in/<slug>` URL | slug | `https://www.linkedin.com/in/<slug>` |
  | `youtube` | `@handle` or a pasted `youtube.com/@handle` URL | `@handle` | `https://www.youtube.com/@handle` |
  | `link` | `label` plus an `https:` URL | both | the URL |

  Pasting a full profile URL is accepted for every service and turned into the handle.
- Display names: `Bluesky`, `Mastodon`, `GitHub`, `LinkedIn`, `YouTube`. For `link`, its `label`.
- Written markup for one item (exact):

  ```html
  <li><a href="URL"><span class="social-icon" data-service="SERVICE" aria-hidden="true"></span><span>NAME</span></a></li>
  ```

  Mastodon's `<a>` also carries `rel="me"`. The items are wrapped in one `<ul>` inside `<social-links>`.
- `<social-links>` attributes:
  - `services`: comma list of service ids, default all visible;
  - `variant`: `icon`, `label` or `icon-label`, default `icon-label`;
  - `color`: boolean.
- Account-check messages (exact copy):
  - unchecked services: "Not checked: open the link to make sure it's you";
  - unreachable: "Not checked yet";
  - DID mismatch: "This handle now points to a different account";
  - empty editor block: "No accounts yet: add them in Social".
- Vanilla Press commits:
  - message `Social: accounts`;
  - path `config/social.json` only;
  - not in `BACKUP_PATHS`;
  - pushed like Programs.

  Under this plan's no-push rule, tests use the stand-in git deps. Nothing is pushed for real.
- Tests never use the real accounts or the live site's posts. Network calls go through an injected `fetch`.
- Never invent a handle. The site gets only `tpowell.bsky.social` (Bluesky) and `ProfPowell` (GitHub), from `config/site.json`.

## Review Focus

1. **A `<social-links>` written by Vanilla Press must stay empty in the saved HTML.** Otherwise Cook's "has content, leave alone" rule freezes old links forever. Pinned in Task 8.
2. **A hand-edited `config/social.json` with a bad entry** (unknown service, `http:` URL, malformed handle, non-array `accounts`, bad JSON) must build with warnings and skip only that entry. Pinned in Tasks 1 and 3.
3. **Saving accounts must not drop SocialSpec keys** (`about`, `contact`, `following`) or unknown keys a person added by hand. Pinned in Task 6.
4. **Text that needs escaping in a `link` label or URL** (`<`, `&`, `"`) must come out escaped in the built HTML and in the editor preview. Pinned in Task 2.
5. **A service that answers slowly or not at all** must not hang the Social screen. Checks time out at 8 seconds, become "Not checked yet", and the save still works with `saveUnchecked`. Pinned in Task 6.

---

### Task 1: Cook: service catalog and account parsing

**Files:**
- Create: `scripts/social/catalog.js`, `scripts/social/accounts.js`, `scripts/social/index.js`
- Modify: `package.json` (`exports["./social"] = "./scripts/social/index.js"`)
- Test: `test/social-accounts.test.js`

**Interfaces:**
- Produces, from `cook-ssg/social`:
  - `SERVICES: Array<{ id, name, checkable: boolean }>`, ids in the table's order;
  - `parseHandle(service: string, input: string) → { handle: string } | { error: string }`;
  - `profileUrl(account) → string|null`;
  - `normalizeAccounts(raw: unknown) → { all: Account[], visible: Account[], warnings: string[] }`.

  `Account` is `{ service, handle, url, name, icon, hidden, did? }`, where `icon` equals `service`. For `link`, `handle` is `''` and `name` is the label.

- [ ] **Step 1:** Write failing tests:
  - every row of the Global Constraints table, accepted input → stored handle → URL. That includes `@ProfPowell` → `ProfPowell`, `https://mastodon.social/@tpowell` → `@tpowell@mastodon.social`, and `linkedin.com/in/jane-doe/` → `jane-doe`;
  - rejects: GitHub `-bad`, `a--b`, 40 characters; Mastodon `tpowell`; `link` with an `http:` URL; a `javascript:` URL;
  - `normalizeAccounts`:
    - keeps order;
    - puts `hidden: true` in `all` but not `visible`;
    - skips an unknown service, an invalid handle and a non-object entry, each with one warning naming the index;
    - returns empty lists for a non-array or missing `accounts`.
- [ ] **Step 2:** Run `node --test test/social-accounts.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement the three modules. `index.js` re-exports the public names. The renderer is added in Task 2.
- [ ] **Step 4:** Run `node --test test/social-accounts.test.js`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(social): service catalog and account parsing`.

### Task 2: Cook: links renderer

**Files:**
- Create: `scripts/social/render.js` (re-exported from `index.js`)
- Test: `test/social-render.test.js`

**Interfaces:**
- Consumes: `Account` from Task 1.
- Produces: `renderSocialLinks(accounts: Account[], { services?: string, variant?: string }) → string`, the `<ul>…</ul>` only, or `''` when nothing matches.

- [ ] **Step 1:** Write failing tests:
  - the exact item markup from Global Constraints;
  - `rel="me"` only on Mastodon;
  - order follows the input;
  - `services="github, bluesky"` filters but keeps account order, trimming spaces and ignoring unknown ids;
  - an empty result gives `''`;
  - a `link` label `A & <B>` and a URL with `"` come out escaped;
  - `variant` doesn't change the markup. It's for CSS and is copied onto the element by the fill step, not the list.
- [ ] **Step 2:** Run `node --test test/social-render.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test again. Expected: PASS.
- [ ] **Step 5:** Commit `feat(social): render profile links`.

### Task 3: Cook: config, data and the fill step

**Files:**
- Modify: `scripts/utils/config/config.js` (add and export `getSocial()`, beside `getPrograms`)
- Create: `scripts/plugins/social-links.js` (`socialData({data})` and `fillSocialLinks({file, data, allowType})`)
- Modify: `scripts/build.js`:
  - call `socialData({data})` right after `programsData`;
  - call `fillSocialLinks` right after `replaceTemplateStrings` in the file loop.
- Docs: `docs-site/src/docs/social-links.md` (new), the README build-step list, a ROADMAP 2.10.0 note.
- Version: `package.json` → `2.10.0`
- Test: `test/social-links-build.test.js`, modeled on `test/programs-build.test.js`, which spawns `bin/cook.js build` in a temp site.

**Interfaces:**
- Consumes: `normalizeAccounts` and `renderSocialLinks`.
- Produces:
  - `getSocial() → object|undefined`: `main.js` `social` wins, else `config/social.json`, re-read on every call. Bad JSON prints a `[social]` warning and gives `undefined`.
  - Template data `social.accounts` (visible) and `social.allAccounts`, set only when the config exists. The SocialSpec plan extends this later.
  - The fill step:
    - uses `Util.fileDom(file)`;
    - fills each `<social-links>` that has no element child, skipping any inside `pre`, `code`, `template` or `textarea`;
    - leaves the element empty when nothing matches;
    - does not touch the file when the page has no live `<social-links>`.

- [ ] **Step 1:** Write failing build tests, each its own temp site:
  - (a) A layout footer and a post both get the list, in config order.
  - (b) A hidden account is absent from the list but present in `${social.allAccounts.length}`.
  - (c) A hand-filled `<social-links><ul><li>x</li></ul></social-links>` is unchanged.
  - (d) `<pre><social-links></social-links></pre>` is unchanged.
  - (e) No `config/social.json`: `<social-links>` builds as an empty element, exit status 0.
  - (f) Bad JSON and an unknown service each give a `[social]` warning on stdout, exit 0, and the valid entries are still rendered.
  - (g) The byte-identical rule for sites with neither config nor element is checked by the existing `COOK_REGRESSION` gate in Step 4, not by a new test.
- [ ] **Step 2:** Run `node --test test/social-links-build.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement `getSocial`, `socialData` and `fillSocialLinks`, wire them into `build.js`, write the docs and bump the version.
- [ ] **Step 4:** Run the full suite with `npm test`, plus `COOK_REGRESSION=1 node --test test/regression-byte-identical.test.js`. Expected: all pass. Report the `ℹ pass`, `ℹ fail` and `ℹ cancelled` lines.
- [ ] **Step 5:** Commit `feat(social): <social-links> filled at build; 2.10.0`.

### Task 4: Vanilla Breeze: `<social-links>`

**Files:**
- Create in `src/web-components/social-links/`:
  - `api.json`: the three attributes, with `kind` and `purpose` like `share-wc`;
  - `styles.css`;
  - `logic.js`: a `SocialLinks extends HTMLElement` with `static observedAttributes = ['services','variant','color']`, defined once. It doesn't render or fetch;
  - `static.html`.
- Create: `docs` spec from `_component-spec-template.md`, if the repo keeps one per component. Follow `share-wc`.
- Modify: `src/web-components/index.css`, `core.css`, `index.js` and `extras.js`. Register it at the same points as `share-wc`.
- Test: `tests/unit/social-links.test.js`

**Interfaces:**
- Produces: a CSS contract that sites may override:
  - `social-links .social-icon[data-service="<id>"]` paints with `mask` and `background: currentColor`;
  - `[variant="icon"]` hides the label text visually but keeps it in the accessible name;
  - `[variant="label"]` hides icons;
  - `[color]` sets brand colors on icons only.

- [ ] **Step 1:** Write a failing unit test:
  - `api.json` lists `services`, `variant` (values `icon`, `label`, `icon-label`) and `color`;
  - `styles.css` has a mask rule for each of `bluesky`, `mastodon`, `github`, `linkedin`, `youtube`, `link`;
  - CSS uses only `var(--…)` tokens for color and space.
- [ ] **Step 2:** Run `npm test`. Expected: the new test fails.
- [ ] **Step 3:** Implement. Masks are inline `data:` SVG URIs made from:
  - `src/icons/custom/bluesky.svg`, `src/icons/custom/mastodon.svg`;
  - `src/icons/lucide/github.svg`, `src/icons/lucide/linkedin.svg`, `src/icons/lucide/youtube.svg`;
  - `src/icons/lucide/link.svg`.

  Inline URIs avoid URL resolution in dist builds. The styling is quiet, with an inline row and gap from tokens.
- [ ] **Step 4:** Run `npm test` and `npm run build:cem`, then confirm `custom-elements.json` contains `social-links` with the three attributes. Expected: pass, entry present.
- [ ] **Step 5:** Commit `feat(social-links): profile links element`.

### Task 5: Vanilla Press: social config file and Cook loader

**Files:**
- Create: `src/social/config.js`
- Create: `src/social/cook.js`: `importCookSocial(siteDir) → module|null`, the same pattern as `importCook` in `src/app/site-layouts.js`, resolving `cook-ssg/social`.
- Test: `test/social/config.test.js`, plus a stand-in module `test/social/fixtures/cook-social.js` with Task 1–2's interface. Tests never import the real Cook.

**Interfaces:**
- Produces:
  - `SOCIAL_FILE = 'config/social.json'`;
  - `SocialError(status, message, body)`;
  - `readSocial(siteDir) → { raw: object, accounts: object[] }`. A missing file gives empty. Bad JSON throws 422;
  - `writeSocial(siteDir, accounts)`: atomic (`src/sync/atomic-write.js`). Keeps every other top-level key and its order, with `accounts` first when new. In each account it writes known keys first, then preserves unknown ones;
  - `NEEDS_COOK = '2.10.0'`.

- [ ] **Step 1:** Write failing tests:
  - a round trip;
  - `about`, `contact`, `following` and a made-up `x` key survive a write byte-for-byte in value;
  - an account's unknown key survives;
  - a missing file reads as empty;
  - bad JSON gives a 422 `SocialError`;
  - `importCookSocial` on a dir without `cook-ssg` gives `null`.
- [ ] **Step 2:** Run `node --test test/social/config.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test again. Expected: PASS.
- [ ] **Step 5:** Commit `feat(social): read and write config/social.json`.

### Task 6: Vanilla Press: account checks and routes

**Files:**
- Create: `src/social/check.js`
- Create: `src/app/social-routes.js`
- Modify: `src/app/site-git.js` (`SOCIAL_PATHS = ['config/social.json']`, `socialMessage() → 'Social: accounts'`)
- Modify: `src/app/server.js` (mount beside `mountProgramRoutes`, same deps)
- Test: `test/social/check.test.js`, `test/social/routes.test.js`. Use the existing site fixtures and stand-in git deps that the program-route tests use.

**Interfaces:**
- Consumes: Task 5's functions. `parseHandle`, `normalizeAccounts` and `renderSocialLinks` come through `importCookSocial`, which is injectable as `cookSocial` in the route context for tests.
- Produces, from `checkAccount({ service, handle }, { fetch, timeoutMs = 8000 })`:

  ```
  → { status: 'ok'|'not-found'|'unreachable'|'unchecked', handle, did?, displayName?, avatar?, message? }
  ```

  The endpoints:
  - Bluesky: `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=<h>`, then `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=<did>`.
  - Mastodon: `https://<instance>/api/v1/accounts/lookup?acct=<user>`.
  - GitHub: `https://api.github.com/users/<h>`.
  - LinkedIn, YouTube and `link` give `unchecked`, with the exact message for unchecked services.
  - A 404 or 400 "not found" answer gives `not-found`, with the service's words.
  - A timeout, network error or 5xx gives `unreachable`.
- Routes under `/api/sites/<id>`:
  - `GET /social`:
    - returns `{ accounts, cookReady, needsCook }`;
    - if the site's Cook has no `cook-ssg/social`, returns `cookReady: false` and `needsCook: '2.10.0'`, and every write route answers 409 with the same.
  - `POST /social/check {service, input}`: runs `parseHandle`, then `checkAccount`. A parse error is 400 with its message.
  - `GET /social/recheck`: checks every account in parallel. For Bluesky it adds `mismatch: true` and `currentHandle` when the resolved DID differs from the stored `did`.
  - `PUT /social/accounts {accounts, saveUnchecked?}`:
    - re-parses every entry;
    - re-checks entries whose `service+handle` isn't already in the file;
    - refuses `not-found` with 422;
    - refuses `unreachable` with 409 unless `saveUnchecked`, in which case it stores `checked: "no"`;
    - stores `did` from the check;
    - writes, commits (`SOCIAL_PATHS`, `Social: accounts`) and pushes through the backup queue and write lock like `program-routes.js`.

    The response matches the Programs routes: `{ accounts, committed, note? }`.
  - `GET /social/links?services=&variant=`: returns `{ html }` from `renderSocialLinks(normalizeAccounts(file).visible, …)`.

- [ ] **Step 1:** Write failing tests with a stub `fetch`:
  - each service's ok, not-found and unreachable cases. A never-resolving fetch with `timeoutMs: 50` gives `unreachable`;
  - the routes:
    - 409 when the Cook is missing;
    - PUT refuses not-found;
    - PUT with `saveUnchecked` stores `checked: "no"`;
    - PUT keeps the `about` key;
    - the commit is called with exactly `['config/social.json']` and `Social: accounts`;
    - recheck flags a DID mismatch;
    - `/social/links` escapes a hostile label.
- [ ] **Step 2:** Run `node --test test/social/`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: all pass. Report the pass, fail and cancelled counts.
- [ ] **Step 5:** Commit `feat(social): account checks and Social routes`.

### Task 7: Vanilla Press: the Social screen

**Files:**
- Modify: `app/assets/js/site-nav.js`: `SECTIONS = ['posts','media','programs','components','theme','layouts','social']`, `LATER = ['Analytics']`.
- Modify: `app/site.html` (rail item and `#social-section`), `app/assets/js/site-page.js` (lazy import like `programsPage`), `app/assets/js/app-api.js` (the five calls).
- Create: `app/assets/js/social-view.js` (pure), `app/assets/js/social-page.js` (DOM wiring).
- Test: `test/app/social-view.test.js` (or the folder where `services-view` tests live), and update the existing site-nav test.

**Interfaces:**
- Consumes: Task 6 routes.
- Produces, from `social-view.js`:
  - `accountRow(account, check) → { id, icon, name, handle, url, displayName, status, tone, hidden, canMoveUp, canMoveDown }`. The status words come from Global Constraints; the tone is `ok`, `warn` or `off`, as in `services-view.js`;
  - `moveAccount(list, index, delta) → list`;
  - `addFormFor(serviceId) → { fields: [...] }`. It returns `label` and `url` for `link`, else `handle` with a per-service placeholder: `name.bsky.social`, `@user@instance`, `ProfPowell`, `in/your-name`, `@channel`.

- [ ] **Step 1:** Write failing tests for the three view functions and for `site-nav` (`social` in `SECTIONS`, absent from `LATER`).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the view and the page:
  - on open, the page loads `GET /social` then `GET /social/recheck`;
  - "Add account" makes a check call and shows the display name and avatar to confirm;
  - an `unreachable` result offers "Save without checking";
  - reorder, hide and remove each make one PUT;
  - the commit note shows as on Programs;
  - when `cookReady` is false, a notice reads "This site's Cook is too old for Social; update cook-ssg to 2.10.0 or later" and the controls are disabled.

  Use Vanilla Breeze custom properties, with no `alert`, `confirm` or `prompt`.
- [ ] **Step 4:** Run `npm test`, then launch the app on a scratch port with `node bin/vp.js app --port 3027`. Port 3017 is the user's running app; don't stop it. Use Playwright on a fixture site copy (never thomasapowell.com) with a stubbed services env, or check with `fetch` against the real public APIs read-only. Screenshot the screen with two accounts and with the Cook too old. Expected: matches the description.
- [ ] **Step 5:** Commit `feat(social): Social screen`.

### Task 8: Vanilla Press editor: the `<social-links>` block

**Files:**
- Modify: `src/components/catalog.js`, in the `vanilla-breeze` entry:

  ```
  { tag: 'social-links', label: 'Profile links', icon: 'share', group: 'Embeds',
    description: "Links to this site's accounts, from Social.",
    kind: 'none', defaults: { variant: 'icon-label' }, advanced: ['color'] }
  ```

  Also include `attributes` for `services`, `variant` (enum) and `color`, in case the installed Vanilla Breeze manifest lacks the tag.
- Modify: `editor/assets/js/blocks/component-view.js`. For `social-links` only, after the element is created and on every attribute change, fetch `/api/sites/<id>/social/links` and put the `html` inside the element, display-only. With empty `html`, show the exact empty copy as a link to `site.html?site=<id>&section=social`.
- Test: `test/renderers/social-links.test.js` and a component-view test where that suite has DOM tests.

**Interfaces:**
- Consumes: `GET /social/links` from Task 6.

- [ ] **Step 1:** Write failing tests:
  - rendering a doc with a `social-links` component through `src/renderers/html.js` gives `<social-links variant="icon-label"></social-links>`, empty, even after the editor view filled it. This is the first Review Focus item;
  - the catalog has the entry.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, then check in the scratch app: insert the block on a fixture site, see the links, change `variant`, save, and confirm the saved HTML has an empty element. Expected: as stated.
- [ ] **Step 5:** Commit `feat(editor): Profile links block`.

### Task 9: thomasapowell.com moves to `<social-links>`

**Files** (in worktree `~/src/thomasapowell.com-social`, branch `feat/social-links` from `main`):
- Create: `config/social.json`:
  - `[{ "service": "bluesky", "handle": "tpowell.bsky.social", "did": "<resolved>" }, { "service": "github", "handle": "ProfPowell" }]`;
  - resolve the DID once, read-only, with the Bluesky `resolveHandle` endpoint from Task 6, and record the command and answer in the report.
- Modify: `config/site.json` (remove `bluesky` and `github`).
- Modify: `config/data.js`:
  - read `config/social.json` and call `normalizeAccounts` from `cook-ssg/social`;
  - the fetchers take the Bluesky and GitHub handles from `.all`;
  - remove the `social: {…}` value, which is now Cook's;
  - with no account for a service, its fetch is skipped and the snapshot used.
- Modify: `src/layouts/base.html`. Replace the two hard-coded `<li>`s (lines 54–55) so that Feed, Bluesky, GitHub, Programs, Colophon and Hot take keep their order and look. The structure is the builder's call, for example splitting the list around `<social-links variant="icon-label">` with `display: contents`.
- Modify: `src/assets/css/site.css`. Map `social-links .social-icon[data-service="bluesky"|"github"]` to the existing `tap-icon` glyph artwork. The site vendors Vanilla Breeze 0.6.x, which has no `<social-links>` CSS, so the site's CSS carries everything the footer needs.
- Modify: `test/chrome.test.js:111-117`. Same assertions, with the account values read from `config/social.json`.
- `package.json` is not changed. For the build, run `npm install --no-save ~/src/cook` in the worktree. Don't commit `package.json` or the lockfile, and confirm `git status` shows neither.

- [ ] **Step 1:** Take a "before" screenshot of the footer at 1280px and 390px from a build of `main`.
- [ ] **Step 2:** Update `test/chrome.test.js`, then run `npm test`. Expected: the footer test fails, because the file and links aren't there yet.
- [ ] **Step 3:** Make the changes and run `TAP_OFFLINE=1 npm run build`. Expected: exit 0, no `[social]` warnings.
- [ ] **Step 4:** Run `npm test`. Expected: all pass, 118 or more. Take "after" screenshots at the same sizes. The footer must match "before" visually. Put both pairs in the report.
- [ ] **Step 5:** Commit `feat: footer profile links from config/social.json`. Leave the worktree in place for the user.

---

## After the plan

- Hand the user a publish order:
  1. Cook 2.10.0 (it includes 2.9.1);
  2. Vanilla Breeze, with `<social-links>`;
  3. the site's `cook-ssg` bump to `^2.10.0`, then push.

  None of these is done by the executor.
- The SocialSpec plan (`~/src/cook/SOCIALSPEC-PLAN.md`) comes next. Its Task 2 becomes "extend `getSocial()` and `socialData`", and it takes Cook 2.11.0.
