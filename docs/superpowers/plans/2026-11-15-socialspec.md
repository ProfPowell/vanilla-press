# SocialSpec profile: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Cook site publishes a SocialSpec profile, `/.well-known/{following.opml,about.md,contact.vcf}`, from `config/social.json`. Vanilla Press's Social screen gains About, Contact and Following panels that write that config. thomasapowell.com is the first site.

**Architecture:** This plan follows the design in `~/src/cook/SOCIALSPEC-PLAN.md` (sections "The spec", "Verified facts", "Design", "Rulings R1–R8", "Open items"). That file is the spec here. It was written before the accounts project shipped, so the amendments below override it wherever they differ.

**Tech Stack:** Node ESM, `node:test`, `marked` (already in Cook), Cloudflare Pages `_headers`, Vanilla Press app (no framework).

**Spec:** `/Users/tpowell/src/cook/SOCIALSPEC-PLAN.md`, with this plan's "Amendments" section.

## Amendments to the spec (the accounts project shipped first: Cook 2.10.0, Vanilla Press main 5d31b5b)

- **A1. Cook version.** This is Cook **2.11.0**, not 2.10.0.
- **A2. `getSocial()` and `socialData` already exist** (`scripts/utils/config/config.js`, `scripts/plugins/social-links.js`).
  - `socialData` already sets `data.social = { ...raw, accounts, allAccounts }`.
  - This plan extends it with `aboutHtml` (the about body through `marked`) and the file emitter.
  - It does not create a second reader.
- **A3. Vanilla Press already has a per-site Social screen** with an Accounts panel:
  - `app/assets/js/social-page.js`, `social-view.js`;
  - `src/app/social-routes.js`;
  - `src/social/config.js`, whose `writeSocial` writes `accounts` and preserves the other keys.

  This plan adds About, Contact and Following panels to that screen and routes beside the existing ones. They use the same commit-and-push path, commit message `Social: <panel>` (for example `Social: about`), and path `config/social.json` only.
- **A4. Version gates.**
  - Accounts keep needing 2.10.0.
  - The three new panels need **2.11.0**. Each disabled panel says "This site's Cook is too old for this; update cook-ssg to 2.11.0 or later".
- **A5. thomasapowell.com already has an About page** (`src/about/index.html`, the "about" section in `config/sections.json`). Do not create `src/about.html`. Where the about text, contact and follow list appear on the site's pages is settled in Task 9 from the user's answers. Until then, the site publishes only the `/.well-known/` files.
- **A6. Content.** Use only what the user supplies:
  - the about summary and body;
  - the email, if any;
  - the follow list.

  Never invent or pre-fill any of it (spec R7). The user's answers are recorded in the ledger before Task 9 starts.
- **A7. The worker.** The site deploys to Cloudflare Pages with no Worker. The Cook Worker change (spec Task 4) still ships for other Cook sites, but nothing on thomasapowell.com depends on it.

## Global Constraints

- No `git push` and no `npm publish` without the user's OK at that moment. Commits are local.
- No new dependencies in any repo.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, with no other trailer.
- The three files and their exact `Content-Type` headers come from the spec table.
  - `/.well-known/following.opml`: `text/x-opml; charset=utf-8`.
  - `/.well-known/about.md`: `text/markdown; charset=utf-8`.
  - `/.well-known/contact.vcf`: `text/vcard; charset=utf-8`.
  - Each also gets `Access-Control-Allow-Origin: *`.
- Each top-level key is optional and independent:
  - no `contact` means no `contact.vcf`;
  - no `about` means no `about.md`;
  - no public `following` means no `following.opml`.
- A site with no `about`, `contact` or `following` builds byte-identically. That includes no `_headers` change.
- Every URL in the output is absolute (R3).
- Use vCard 4.0 with CRLF line ends, folding at 75 octets (R1).
- OPML outlines carry `type="rss"`, `text`, `title`, `xmlUrl` and `htmlUrl` (R2).
- Warnings, not failures:
  - a missing `siteUrl`;
  - a non-https `feedUrl`;
  - a missing `formats.feed`;
  - `contact` with no name, which writes no file.
- Before coding Task 1, re-fetch socialspec.org, followspec.org, aboutspec.org and contactspec.org. If they changed from the spec's snapshot, rule on it in the ledger.
- Vanilla Press tests use the stand-in Cook module (`test/social/fixtures/cook-social.js`) by default. Any new Cook function Vanilla Press calls must be mirrored there. The opt-in run `COOK_SOCIAL_MODULE=/Users/tpowell/src/cook/scripts/social/index.js` must pass.
- Do not touch `~/src/vanilla-breeze`.
- Do not touch the user's uncommitted files:
  - `~/src/vanilla-press/CLAUDE.md`;
  - `~/src/thomasapowell.com`'s `src/layouts/essay.html` and the untracked files there.
- Leave the user's app on port 3017 and their preview on port 4180 alone.

## Review Focus

1. **Text that needs escaping in every format:**
   - `&`, `<` and `"` in OPML titles;
   - `,`, `;`, `\` and newlines in vCard values;
   - `:` and quotes in the YAML `summary`;
   - multi-byte text folded inside a character.

   Pinned in Task 1.
2. **A SocialSpec setting together with sandboxed programs.** The site's `_headers` must keep both blocks and the user's own lines. Pinned in Task 3.
3. **Saving an About, Contact or Following panel** must not drop `accounts` or each other's keys, nor hand-added keys. Pinned in Task 6.
4. **OPML import** of a file with duplicate `xmlUrl`s, nested outline folders, or missing `text`. It merges by `feedUrl`, skips entries without `xmlUrl`, and doesn't crash. Pinned in Task 6.
5. **A public email warning:** the helper text "This address is public. Use one you are happy to see scraped." is shown under the email field. Pinned in Task 7.

---

### Task 1: Cook: SocialSpec render functions

**Files:** create `scripts/social/socialspec.js`, re-exported from `scripts/social/index.js`. Test: `test/socialspec.test.js`.

**Interfaces (Produces):**
- `renderOpml(following, { title }) → string|null`, with `null` when no public entries;
- `renderAbout(about, { siteUrl, readFile? }) → string|null`. `body` wins over `file`; `readFile` is injected for tests;
- `renderVcard(contact, { siteUrl }) → { text: string|null, warning?: string }`.

- [ ] Write failing tests for every Review Focus 1 case, plus:
  - private entries dropped;
  - stable order;
  - `](/x)` and `](/img.png)` rewritten to `siteUrl + path`;
  - `URL` defaults to `siteUrl`;
  - empty fields omitted;
  - no name → `text: null` with a warning;
  - CRLF line ends;
  - each folded line ≤ 75 octets.
- [ ] Run `node --test test/socialspec.test.js`. Expected: FAIL.
- [ ] Implement.
- [ ] Run the test again. Expected: PASS.
- [ ] Commit `feat(socialspec): OPML, about.md and vCard renderers`.

### Task 2: Cook: the writer, `_headers` and `aboutHtml`

**Files:**
- modify `scripts/plugins/social-links.js` (`socialData` adds `aboutHtml`);
- new `scripts/plugins/socialspec-files.js` (writer);
- a shared `_headers` append helper used by both programs and SocialSpec, so `_headers` gets a single read-modify-write;
- `scripts/build.js` (call the writer after `generateFormats`, before the `_headers` step).

Test: `test/socialspec-build.test.js`, modeled on `test/social-links-build.test.js`.

- [ ] Write failing build tests:
  - the three files are written under `siteRootDir`, with `siteRoot` set and unset;
  - `_headers` blocks are added for exactly the files written;
  - an existing `_headers` is preserved;
  - programs and SocialSpec blocks are both present (Review Focus 2);
  - `${social.aboutHtml}` renders on a page;
  - each spec warning case warns and exits 0;
  - with no SocialSpec keys, there are no files and no `_headers` change.
- [ ] Run the tests. Expected: FAIL.
- [ ] Implement.
- [ ] Run `npm test`, plus `COOK_REGRESSION=1 node --test test/regression-byte-identical.test.js`. Expected: all pass.
  - The known thomasapowell.com clock noise is accepted only if the masked comparison shows no other difference. Report it either way.
- [ ] Commit `feat(socialspec): write /.well-known files and _headers`.

### Task 3: Cook: Worker pass-through, docs and 2.11.0

**Files:**
- `worker/index.js`: `/.well-known/*` is returned untouched; `Access-Control-Allow-Origin: *` is added for the three paths;
- `test/worker-negotiation.test.js`;
- `docs-site/src/docs/socialspec.md`, with examples escaped like `social-links.md`;
- a line in `multi-format.md` and in `deployment.md`;
- the README;
- a ROADMAP 2.11.0 note;
- `package.json` → `2.11.0`.

- [ ] Write failing worker tests. A request with `Accept: text/markdown` for `/.well-known/about.md` must not be rewritten to `/md/…`. The CORS header is present on the three paths and absent elsewhere.
- [ ] Run the tests. Expected: FAIL.
- [ ] Implement, write the docs, bump the version, and build docs-site to check that the page renders its examples as text.
- [ ] Run `npm test`. Expected: all pass.
- [ ] Commit `feat(socialspec): worker pass-through; docs; 2.11.0`.

### Task 4: Vanilla Press: SocialSpec config and validation

**Files:** `src/social/config.js`, which gets a writer per section. `writeSocialSection(siteDir, key, value)` handles `about`, `contact` and `following`, preserving every other key, with known keys first. Add validation in `src/social/socialspec.js`:
- `validateAbout`;
- `validateContact`, where the email must look like an email when present and URLs must be https;
- `validateFollowing`, where `feedUrl` and `siteUrl` must be https and `public` must be a boolean.

Test: `test/social/socialspec-config.test.js`.

- [ ] Write failing tests. They cover Review Focus 3 at the file level (accounts plus the other sections plus a hand key survive each section write) and each validation error message.
- [ ] Run the tests. Expected: FAIL.
- [ ] Implement.
- [ ] Run the tests again. Expected: PASS.
- [ ] Commit `feat(social): SocialSpec sections in config/social.json`.

### Task 5: Vanilla Press: routes and OPML import and export

**Files:**
- `src/app/social-routes.js`: add `PUT /social/about`, `PUT /social/contact`, `PUT /social/following`, `POST /social/following/import` (OPML text body; merges by `feedUrl`) and `GET /social/following.opml`;
- `src/social/opml.js`: a small, tolerant parser using linkedom, which is already a dev dependency, or a hand parser. Export uses Cook's `renderOpml` through the site's Cook, mirrored in the stand-in;
- `GET /social` adds `about`, `contact`, `following` and `socialSpecReady` (whether the site's Cook has `renderOpml`).

Tests: `test/social/socialspec-routes.test.js`, `test/social/opml.test.js`.

- [ ] Write failing tests:
  - each PUT commits exactly `['config/social.json']` with `Social: about`, `Social: contact` or `Social: following`;
  - a 409 when the Cook is too old (A4);
  - a 400 on validation errors;
  - import covers each Review Focus 4 case;
  - the export round-trips;
  - accounts survive every write.
- [ ] Run the tests. Expected: FAIL.
- [ ] Implement.
- [ ] Run `npm test` and the opt-in `COOK_SOCIAL_MODULE` run. Expected: all pass.
- [ ] Commit `feat(social): SocialSpec routes and OPML import/export`.

### Task 6: Vanilla Press: About, Contact and Following panels

**Files:** `app/site.html` (three panels under Accounts in `#social-section`), `app/assets/js/social-page.js` (wiring), and `app/assets/js/socialspec-view.js` (new, pure view: form models, the following row model, the reorder and merge helpers). Test: `test/app/socialspec-view.test.js`.

**The panels:**
- **About:** a Summary field, a Markdown textarea, and a Preview toggle. The preview is rendered on the server through Cook's `marked` path, so it matches the build.
- **Contact:** fields for name, email, URL, organization and title. The email field carries the exact helper text "This address is public. Use one you are happy to see scraped."
- **Following:** a list showing title, feed URL, site URL and a Public checkbox. You can add, edit, remove and reorder entries. "Import OPML…" uses a file input. "Export OPML" downloads the file.

**Other rules:**
- Each panel has its own Save, with one PUT and the commit note shown as Accounts does.
- Panels are disabled with the A4 notice when `socialSpecReady` is false.
- Use Vanilla Breeze custom properties, and no `alert`, `confirm` or `prompt`.

- [ ] Write failing view tests: the form models from config, the following row model, reorder, and the exact helper and notice copy.
- [ ] Run the tests. Expected: FAIL.
- [ ] Implement.
- [ ] Run `npm test`.
- [ ] Check by hand in a scratch app on port 3027, with an isolated `VP_CONFIG_DIR` and a fixture site copy (as in the accounts project). Fill each panel, save, import a sample OPML and export it. Screenshot each panel and the too-old state.
- [ ] Commit `feat(social): About, Contact and Following panels`.

### Task 7: Vanilla Press: docs

**Files:** a README section "Social" covering the Accounts and SocialSpec panels and what each writes, and a `CLAUDE.md` note about `config/social.json` ownership. Do not overwrite the user's uncommitted `CLAUDE.md`. If it has local changes, put the note in the README only and say so.

- [ ] Write the docs.
- [ ] Run `npm test` to confirm the docs-linked tests still pass, if any exist.
- [ ] Commit `docs(social): SocialSpec panels`.

### Task 8: Cook publish gate (controller, no subagent)

- [ ] Stop and ask the user to publish Cook 2.11.0, following the accounts project's flow:
  - verify the npm tarball's `scripts/` matches the branch;
  - fast-forward master and push.

### Task 9: thomasapowell.com: profile content, files and links

**Files** (in a new worktree `~/src/thomasapowell.com-socialspec`, branch `feat/socialspec`):
- `config/social.json` gets the user's supplied `about`, `contact` and `following` (A6);
- `cook-ssg` → `^2.11.0`, installed `--prefer-online`;
- `src/layouts/base.html` head gets `<link rel="alternate" type="application/atom+xml" title="${siteTitle}" href="/feed.xml">`;
- where the content shows on site pages, per the user's answer recorded in the ledger (A5).

- [ ] Write failing site tests: the three files are in `dist/.well-known/`, `_headers` has the three blocks, and the feed `<link>` is present.
- [ ] Run the tests. Expected: FAIL.
- [ ] Implement.
- [ ] Run `npm test` and `TAP_OFFLINE=1 npm run build`. Expected: pass, with no `[social]` warnings.
- [ ] Commit `feat: SocialSpec profile`.

### Task 10: Deployed check (after the user OKs the push)

- [ ] For each of the three URLs, run `curl -sI -H 'Origin: https://example.org'`. Expected:
  - 200;
  - the spec's `Content-Type`;
  - `Access-Control-Allow-Origin: *`;
  - an `ETag`.

  A second request with `If-None-Match` returns 304.
- [ ] Record any open item from the spec (1–4) that the live check settles or contradicts.
