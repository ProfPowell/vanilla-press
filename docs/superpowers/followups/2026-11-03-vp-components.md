# Vanilla Press components: rulings and deferred follow-ups

Recorded during the subagent-driven build of feat/components (plan: docs/superpowers/plans/2026-11-03-vp-components.md; spec: docs/superpowers/specs/2026-11-03-vp-components-design.md).

## Rulings

- Pre-flight scan, T2→T4 (describeComponents/packageDir/vpVersion vs "npm install <pkg>@<vp's version range>"): vpVersion is installed version, not range → Ruling R1
- Pre-flight scan, T4→T6 (api.listComponents() vs T6 browser check in `vp serve` fixture mode): GET /components only mounted in app → Ruling R2
- Pre-flight scan, T5→T7 (T5 "Try it" needs T7 loader): Ruling R3
- Ruling R1: npm install uses the dependency range from VP's own package.json for that package (e.g. ^1.4.7), not vpVersion — matches "Cloudflare installs the same versions" and keeps one source of versions — cost if wrong: a site gets a different minor than VP tested.
- Ruling R2: GET /components is mounted by mountApi (src/server/api.js) whenever an options.componentsState() is passed; the app passes per-site state, `vp serve` passes describeComponents for its workspace (fixture mode → all enabled). PUT stays app-only — needed for T6/T7 checks in vp serve — cost if wrong: one extra read-only route in vp serve.
- Ruling R3: the Components section "Try it" preview moves to Task 7 (it needs the loader); Task 5 shows descriptions only — cost if wrong: none, ordering only.
- Ruling R4: Cook minifier reorders attrs to <script src type=module>; Task 8 e2e must match attribute-order-agnostically — cost if wrong: none
- Task 2: Ruling R5: NO_PUBLISHED_MANIFEST exemption (marquee-wc 1.7.0, border-wc 0.2.0 tarballs omit custom-elements.json) stands — spec-mandated packages, upstream packaging defect, test asserts manifest.size===0 so it fails once fixed; user asked to republish with custom-elements.json in `files` — cost if wrong: their hints go unchecked until republished.
- Env diagnosis: run.test.js hang root cause = freePort()/isFree (src/app/site-process.js ~103) only binds 127.0.0.1; user's cook dev on *:4100 (IPv6 wildcard) → VP picks 4100, readiness poll hits user's server, appWithPreview reads missing pid → throws before cleanup → child leaks → runner hangs. Real user bug (preview can show another server's site). Ruling R6: fix on feat/components as an extra task after Task 3 (isFree requires both 127.0.0.1 and wildcard binds; regression test holding a wildcard port; appWithPreview kills child on setup failure) — cost if wrong: small out-of-plan diff in the branch. Diagnosis: scratchpad/sighup-diagnosis.md
- Task 3: Ruling R7: renderer guards itself — unsafe block component renders as empty string, unsafe inline component renders its children only; unsafe attr names skipped; constants shared with validate.js — cost if wrong: invalid content silently disappears from output instead of erroring (validate still errors on write).
- Task 4: Ruling R8: dirty check ignores untracked/new package-lock.json (it is committed with the change, restored byte-for-byte on failure) — a site whose lock was never committed would otherwise be blocked forever — cost if wrong: an untracked lock the user didn't intend gets committed.
- Task 6: Ruling R9: initialAttrs omits value for none kind (brief said value '' for leaf) — validator (Task 3) rejects any value on none — cost if wrong: none
- Task 6: browser check finding (pre-existing, reproduced at 492582a): in a NEW post the / palette opens and filters but Enter inserts nothing and the palette stays open with stale filter; URL hash changes to #doc-… on first keystroke (create-on-first-save from step 1). Ruling R10: fold into Task 6 fix round (palette area, blocks the browser check) — cost if wrong: out-of-plan fix in this branch.
- Task 7: Ruling R11: settings panel opens when the cursor is anywhere inside a component (not only node selection) — needed to edit blocks-kind components while typing in them — cost if wrong: panel shows more often.
- Task 7: Ruling R12: document saves validate component tags against the full catalog (componentIndex enabledOnly:false); only Publish/Update require the tag to be enabled (Task 4 guard); the editor surfaces the server's error text — cost if wrong: a draft can hold a component the site doesn't load (by design, Publish blocks it).
- Task 7: Ruling R13: describe.js synthesizes AttrDefs for a package whose manifest is missing, from a catalog `attributes` hint on the element ([{name,type,enum?}] transcribed from the README attribute table); descriptors then carry real attributes, so server normalize/validate and the editor form agree; component-model settingsFields becomes unnecessary (remove or reduce to formFields). When the manifest exists, it wins and the hint is ignored. Catalog test: hint names cover defaults/advanced; for packages WITH a manifest, no hint needed — cost if wrong: hints drift from the package until it ships a manifest.

## Deferred minors

- Task 1: minor (deferred): malformed custom-elements.json / package.json logged as "no manifest"/"not installed" (package-components.js:323-329)
- Task 1: minor (deferred): entry at package root copies whole package incl. nested node_modules
- Task 1: minor (deferred): duplicate tag across packages — later silently wins
- Task 1: minor (deferred): tests lack scoped-name, already-present-script skip, fallback entry resolution (scoped path covered by Task 8 e2e)
- Task 1: minor (deferred): package-lock engines drift >=18 → >=20.9
- Cook fix: reviewed Approved (0 Critical/Important); trailer verified; npm test 455/455; merged ff to master 384254d and pushed. minor (deferred): hand-rolled regex escape in package-components test; no sourcemap/`/pages/` literal cases in fingerprint-site-root test; stray blank line between imports.
- Task 2: minor (deferred): describeComponents duplicates packageDir lookup; repeated package.json reads; readManifest customElements path no containment check; parseCemType splits quoted '|'; lockfile vanilla-breeze link 0.4.1→0.5.0
- Task 2: minor (deferred, flag for final review): foot-notes is kind 'blocks' but auto-collects preceding <foot-note> elements and wraps no authored content — 'none' fits (catalog.js:189-192)
- Task 2: minor (deferred): task-2-report.md top table stale (still lists chart-wc)
- Task 3: minor (deferred): children wins over value when both present; normalize doesn't guard array attrs; no </SCRIPT uppercase test; no content-scope component test
- Task 3: minor (deferred): no explicit uppercase SCRIPT/oNclick tests (regex rejects them)
- Fix R6: complete (commits 90413ca..2d224e7, review clean; trailer verified). minor (deferred): post-listen 'error' after once consumed unhandled; macOS-only regression signal; cleanup doesn't await child exit
- Task 4: minor (deferred, flag for final review): commitPaths failure after successful npm leaves package.json/lock edited (not restored) → later toggles hit dirty 409 (components.js:210-211)
- Task 4: minor (deferred): npm failure / timeout messages lack a next step ("Build timed out" text reused for npm); 409 text singular/plural
- Task 4: minor (deferred): push failure after commit returns 200; PUT response could carry backup state
- Task 4: minor (deferred): publish refusal only tested with stub Map, no app-level test with package removed by hand
- Task 4: minor (deferred): describeComponents uncached per save/publish
- Task 5: minor (deferred): empty error text when server omits `error` on 409/502; focus lost on toggle re-render; role=status span recreated each render (announcements); 409 in-use text singular/plural
- Task 6: minor (deferred): blocks component with children [] gains empty <p> on first save; marks on component_inline node itself not saved; parseComponentAttrs doesn't validate tag on paste; no committed PM round-trip regression test; _prosemirror.css outside file list
- Task 6: minor (deferred): no committed PM round-trip regression test (scratch harness only); non-link marks over whole inline component dropped on save
- Task 7: review 1 → Approved (0 Critical/Important). minor (deferred): `..` segments pass into script URLs (component-loader segments()/describe entryPath); listComponents failure leaves components "loading" with no message; foreign-node put-back appends after PM children (border-wc), fragile; theme-picker define order relies on script order — rename editor element (vp-theme-picker); synthesized advanced-only fields default to string; error guard can mislabel editor errors under a component stack, fromComponent untested; number field applies on every input; Try-it "couldn't load" lacks next step.
- Task 7: minor (deferred): vp serve now 400s uncatalogued component tags (behavior change, per R12); handleSaveError JSDoc wrap; border-wc `trigger` not in hint (not in README); marquee autofill can't be set false from the form
- Task 8: review 1 → Needs fixes: Important: follow-ups doc omits 2 ledger minors (Task 2 foot-notes kind; Task 4 commitPaths failure leaves package files dirty). minor (deferred): e2e accepts unescaped < and & in attrs (only " proven; renderer unit tests own < &); rulings table fragments render oddly; plan path line unnamed; gallery select.value undefined when no themes.

## Package follow-ups

- marquee-wc and border-wc: the published tarballs (marquee-wc 1.7.0, border-wc 0.2.0) lack `custom-elements.json`. Add it to `files` and republish. Until then Cook 2.5.0 skips them on live sites, so they do not load there.
- marquee-wc needs its CSS self-injected: it renders as stacked copies otherwise (a fix prompt was given to the package owner).
- border-wc draws nothing without `effect`, and injects light-DOM SVG children (the editor has to tolerate foreign nodes).
- bg-wc 0.5.0 is unpublished (npm has 0.4.0).
- Manifests without slots: the catalog cannot learn from a manifest where content goes, so content kinds are hand-set in `catalog.js`.

## Gallery check

Run with `editor/components-gallery.html` on `vp serve` (:4377). Result: all 21 elements are defined, 0 load failures, 45 themes listed. Of the 18 elements that can be measured, all change their computed styles under the dracula and 8bit themes.

Findings, each with its owner:

| Finding | Owner |
|---|---|
| border-wc draws no SVG despite `effect=squiggle` + `animate`; it renders plain | package repo (border-wc) |
| marquee-wc renders as stacked copies; it needs its CSS self-injected | package repo (marquee-wc) |
| code-playground's preview pane stays light in dark themes | package repo (code-playground) |
| pdf-viewer's page area stays light in dark themes | package repo (pdf-viewer) |
| audio-player, video-player, image-gallery are `blocks` in the catalog but show only sample text; they need media/`src`. Likely kind `none` + `src`; revisit with media in step 3 | VP catalog, step 3 (media) |
| youtube-player and social-embed warn about a missing required `video-id` / `url`: catalog defaults lack required attributes and the form does not mark required fields. Catalog should mark required attributes and the form should flag them | VP catalog / editor form |
| qr-code renders 0x0 and geo-map shows "location unavailable" with catalog defaults | VP catalog (needs a sample `value` / location) |
| carousel-wc icons 404 at `/cdn/icons/lucide/*.svg` under `vp serve` | VP server (serve VB icons, or fix the path) |
| blink-wc showed empty because the gallery gave inline elements no text | VP gallery (fixed) |

## Final review

Final whole-branch review of feat/components (fix base 6f86c55). Every finding is fixed:

| Finding | Fix | Tests |
|---|---|---|
| Code playground and Animated background could not be saved after insert: `inherit-theme: true` and `intensity: 0.65` defaults, both declared `string` | Defaults are `'true'` (the element reads anything but "false" as on) and `'0.65'`. `normalizeComponents` coerces numbers and `true` to strings for string attributes (`false` is left out, since it renders as no attribute) and "60"/"true"/"false" to number/boolean, reporting nothing | catalog.test.js "every element's defaults match its descriptor's attribute types and enums, and validate once inserted"; schema/component.test.js "coerces values to the declared type without reporting them" |
| Dropped-attribute notices never reached the user (spec §9) | POST/PUT documents also return `dropped: { tag, attr }[]`. The editor removes those attributes from its ProseMirror doc (no undo step, no extra save) and shows the notices after "Saved" in the save state | server.test.js "POST/PUT document drops undeclared component attrs and returns a notice" (now also `dropped`); component-model.test.js "withoutDropped …", "dropAttributes …"; site-context.test.js "saveStateText: notices from the save follow the state" |
| A failed commit after a successful npm run left package.json/lock edited; re-enabling then said "already on" | The commit is wrapped: the files are put back byte for byte, npm re-syncs node_modules (best effort), and a 502 says what happened and "Close other git tools and try again." "Already in the requested state" now needs the package files committed; otherwise the dirty guard answers | components.test.js "a failed commit after npm puts the package files back, says what to do, and a later toggle works", "a dependency in package.json but not committed is not \"already on\": the dirty guard answers" |
| npm failure did not say why (Review Focus 5) | The Components screen shows npm's output in a `<details>` (as text) and "Check your internet connection, then try again." `runNpm` takes a `timeoutNote`; npm's default says "npm took too long (over N min)", builds keep "Build timed out"; a component timeout says "npm install <pkg> took too long (over 5 min) and was stopped" | components-view.test.js "toggleOutcome npm: the error, a next step, and the log tail"; site-process.test.js "runNpm timeout says npm took too long, not that a build timed out", "durationText: …"; components.test.js "an npm timeout says npm took too long" |
| R14: marquee-wc and border-wc never load on the live site | PackageState and each descriptor carry `loadsOnLiveSite` and `liveSiteNote`; the Components screen shows the note; Publish/Update refuse a post using such a component, naming the element and the fix | describe.test.js "an installed package with no custom-elements.json does not load on the live site (R14)", "the real marquee-wc and border-wc are flagged …"; publish.test.js "publish and update refuse a post using a component that will not load on the live site (R14)"; components-view.test.js "packageRows: a package that won't load on the live site says so (R14)" |
| R15: docs/EDITOR.md described behavior that does not exist | Corrected: inline components come from the toolbar's "Wrap in component" select, not `/`; no unwrap (delete the wrapped text); text/code kinds are edited in the settings panel's box, blocks kinds in the page | docs only |
| R16: foot-notes kind | `none` | catalog.test.js "kinds are valid and code kinds have codeWrap" |

### Rulings

- Ruling R14: manifest-less non-bundled packages (no custom-elements.json in the installed copy) are marked on the Components screen "won't load on the live site until the package ships custom-elements.json", and Publish/Update refuse a post using them with a message naming the package and the fix. Cost if wrong: marquee/border unusable for publishing until republished (honest vs broken live page).
- Ruling R15: EDITOR.md is corrected to describe actual behavior; inline unwrap is not built in this branch (follow-up). Cost if wrong: users must delete wrapped text to unwrap.
- Ruling R16: foot-notes catalog kind changes to `none` now (no posts exist yet). Cost if wrong: none.

### Follow-ups

- Inline unwrap: the toolbar can wrap a selection in an inline component but not unwrap one; today the only way out is deleting the wrapped text.
- A failed component commit that got as far as staging leaves the package files staged (with the working tree put back); the next commit re-stages them, so it is harmless but shows in `git status`.

### Deferred minors (final review)

- Declined-to-judge items accepted as listed by the reviewer: javascript: URLs out of scope for a single-user localhost owner; package folders served whole; package.json deps as the record; spec code-kind examples vs catalog `none`; gallery visuals owned by packages; Cook internals; R6/R7/R8 as ruled; describe perf.
- The save error says "not on for this site" for uncatalogued tags under R12.
- `vp serve --site` serves VP's copy of a package while describing the site's copy.
- Strict type check on hand-edited JSON strings (now softened: numeric/boolean strings are coerced on save).
- `<!--<script` in wrap 'script' (no catalog element uses it).
- No old-Cook warning in the editor.
- Saves wait silently while npm runs.
