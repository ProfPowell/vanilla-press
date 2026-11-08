# Vanilla Press new look (step 3a): rulings and deferred follow-ups

Branch feat/new-look, plan docs/superpowers/plans/2026-11-07-vp-new-look.md. Copied from the execution ledger.

## Rulings

- Ruling PF1: Task 4 keeps creating new posts with title 'Untitled'; Task 6 switches every creation site (incl. site-page.js) to '' together with the validation change — validation rejects '' until T6 — cost if wrong: none (T6 already lists site-page.js:78).
- Ruling PF2: Task 5 removes the Tools button in site mode only and leaves the sidebar (doc browser, theme picker) as it is for vp serve; Task 9 moves them into the panel — vp serve must never lose them mid-branch — cost if wrong: a little extra code in T5 that T9 replaces.
- Task 2: Ruling PF3: keep the existing site.html?site=<id> query param (plan said ?id=); Task 3 sectionHref/sectionFromSearch use 'site' — changing it would break every existing link and the editor's back link — cost if wrong: none.
- Task 5: Ruling PF4: in vp serve, the header primary shows "Update" for a published post and just saves (the meta-panel publish toggle would unpublish under an "Update" label) — safer than the brief's wording — cost if wrong: fixture mode has no explicit republish; saving already writes it.
- Task 6: Ruling PF5: accept implementer deviations — placeholder via [data-placeholder] (PM keeps <br> so :empty never matches); round-trip test compares to the editor's normal form (6 fixtures didn't round-trip before this task, verified at da668e8); untitled-<stamp> slug follows the first typed title (isPlaceholderSlug); title keys wired in editor.js not keymap.js; title at --font-size-5xl (48px) vs mockup 42px — cost if wrong: cosmetic/location only.
- Task 8: Ruling PF6: accept blockHandlesPlugin({ addAt }) (palette opener injected; keeps DOM modules out of Node tests and avoids an import race) — cost if wrong: one extra option.
- Task 8: Ruling PF7: keep the implementer's extra drop refusal (a list item/tab/step dragged by the grip can't land outside its kind of parent or on the title; dragging a list item to the top level no longer wraps it in a new list) — matches spec "within its parent, never out" — cost if wrong: one less drag gesture (FLAG TO USER).
- Task 9: Ruling PF8: collectionOptions keeps the brief's rule (config names + current); with an empty collections config only the current collection is offered — VP doesn't know Cook's implicit collections and inventing 'pages' could write posts where the site has no layout — cost if wrong: changing collection needs a config entry.
- Task 9: Ruling PF9: accept metaEdited() in editor.js (outside the brief's file list) so panel edits save immediately — cost if wrong: none.
- Final review (opus): C1 steps-view freeze (pre-existing, blocks verification); I1 Task 10 browser checks open; M1–M7 minors. Rulings PF1–PF9 judged reasonable.
- Final: Ruling PF10: axe scrollable-region-focusable on a code-block <pre> inside the contenteditable at 390px left unfixed — the caret reaches and scrolls it; axe doesn't count contenteditable as focusable — cost if wrong: one keyboard-scroll gap on phones.

## Re-graded findings

- Task 5: re-graded menu-rebuild-while-open focus loss from Minor to Important (keyboard users lose the menu; spec anti-goal "can't be driven from the keyboard").
- Task 6: re-graded drop-into-title (Minor 4) to Important: a rich drop splits the title and moves its tail into the body — same protection as paste.
- Task 7: re-graded Minor 1 (aria-checked on role=menuitem; screen readers can't hear active marks in More) to Important — a11y anti-goal.
- Task 9: re-graded Minor 2 (date-only published shows the previous day west of UTC, in meta line + status box) to Important — wrong date shown to the user; fold Minor 1 (duplicate date formatter) into its fix.
- Task 9: re-graded Minor 3 ("Show block tree" does nothing visible after hiding the panel with the tree open) to Important — a menu action that silently does nothing.
- Final: re-graded M5 (Unpublish confirmation can say "The live page" instead of the URL) to Important — plan Review Focus 3 requires the URL.

## Deferred minors

- Task 1: minor (deferred): readSiteUrl cache-busting import runs every site's config/data.js per GET /api/sites and never evicts the module (pre-existing helper); cache by mtime if Sites polls.
- Task 1: minor (deferred): git.test.js stray blank line / repeated plain-repo setup.
- Task 1: minor (deferred): lastVpCommitAt test lacks a pushed non-VP commit newer than the Draft: commit.
- Task 2: minor (deferred): sites-view.test.js 'Backed up Nov 3' assertion depends on the machine locale (en-US); pin the locale or compute the expectation.
- Task 2: minor (deferred): syncText with connected repo and null branch renders "null".
- Task 2: minor (deferred): "View live ↗" (target=_blank) lacks "(opens in a new tab)" text for screen readers.
- Task 2: minor (deferred): app.css leftover one-off radii (.notice, .side-nav button, .try-stage) and a double blank line.
- Task 2: minor (deferred): flaky test 'startApp port > falls back to the next port' (server.test.js:222) failed once in a full run (port race), passes alone.
- Task 2: minor (deferred): Posts-list draft badge shows VB's default dashed outline (Task 4 restyles rows).
- Task 3: minor (deferred): rail sync text stays "Checking GitHub" and footer blank when loadSite fails.
- Task 3: minor (deferred): "Coming later" label is CSS ::before content, not real text.
- Task 3: minor (deferred): .site-main .lede negative margin hack against .section-head.
- Task 3: minor (deferred): Theme section picker loads theme CSS into the app page head with no on-page preview (preview is step 4).
- Task 4: minor (deferred): preview tab navigates to "undefined" if the server returns no url; guard it.
- Task 4: minor (deferred): .search focus ring offset escapes the bordered label; confirm visually.
- Task 4: minor (deferred): posts-view test 'rowModel: full post' has a no-op ternary.
- Task 5: minor (deferred): confirmText renders Delete "" for an untitled post (fall back to "Untitled").
- Task 5: minor (deferred): Delete on a never-saved post asks first, then says "not saved yet".
- Task 5: minor (deferred): fixture-mode header Preview silently no-ops when meta-panel preview is disabled.
- Task 5: minor (deferred): AST menu text never flips to Hide.
- Task 5: minor (deferred): README token table lacks --color-text-on-primary (spec gap).
- Task 5: minor (deferred): no automated DOM tests for more-menu / confirm-panel keyboard contract.
- Task 5: minor (deferred → Task 9): inspector/sidebar CSS still has #1e1e2e hex.
- Task 6: minor (deferred): P2 drift after reload when a draft title is cleared or slugifies to '' (slug then looks hand-edited).
- Task 6: minor (deferred): untitled archived post fails with the generic "missing required field title".
- Task 6: minor (deferred): Mod-a in body selects title too; typing then replaces the title and empties the body.
- Task 6: minor (deferred → Task 9): doc-browser shows blank rows for untitled drafts (needs "Untitled" fallback).
- Task 6: minor (deferred): MODULE_TYPELESS_PACKAGE_JSON warning in test output; flaky runBuild-timeout test under load.
- Task 6: minor (deferred → carry to Task 8 drag handles): dragging a non-text node (hr, image, embed) onto the title deletes it (moved drop inserts only leaf text); fix: no-op when plainText(slice).trim() is empty.
- Task 6: minor (DONE in step 3b: file drops handled): handleDrop returns true for empty slices (file drops) on the title, so a later image-drop plugin would never see them.
- Task 6: minor (deferred → carry to Task 8): dragging a selection that crosses the title edge to a body spot joins body text into the title (PM's moved-drop deleteSelection).
- Task 6: minor (deferred): IME/beforeinput deletes across the title edge not intercepted (unverified).
- Task 7: minor (deferred): pressed and hover share one background in _format-toolbar.css.
- Task 7: minor (deferred): raw px radii/font sizes/gaps in _format-toolbar.css instead of tokens.
- Task 7: minor (deferred): blur listener not removed in plugin destroy(); module-level refreshMenu nulled unconditionally.
- Task 7: minor (deferred): misleading comment at format-toolbar.js:356; synthetic wrap-entry item.command stub.
- Task 7: minor (deferred): toolbarPosition ignores viewport height (tall selections put it off-screen).
- Task 7: minor (deferred): toolbar buttons never in Tab order (Alt+F10 only).
- Task 7: minor (deferred): Mod+K with an empty selection now does nothing (used to set a stored link mark).
- Task 7: minor (deferred, pre-existing, global no-dialog constraint): alert() editor.js:379; prompt() blocks/tabs-view.js:70; alert() media-picker.js:76,102 (DONE in step 3b: picker uses inline messages); confirm() doc-browser.js:177 (Task 9 area) — final review to triage.
- Task 8: minor (deferred): NodeSelection on a top-level leaf (hr after title) lets Alt+Shift+arrow fall through to browser extend-selection (use blockOfSelection in fallback).
- Task 8: minor (deferred): handle update() forces layout on every transaction (batch with rAF).
- Task 8: minor (deferred): palette insertAfter only checked against doc size if the doc changes while open.
- Task 8: minor (deferred, FLAG TO USER): writing column shrinks below ~680px measure when pane < measure + ~188px gutter (e.g. laptop with Post settings open).
- Task 8: minor (deferred): no view.focus() after the cross-edge body drop.
- Task 8: minor (deferred): grip button has no keyboard action/hint (aria-keyshortcuts).
- Task 8: minor (deferred): test gaps — draggedNode.replace branch, palette insertAfter, keymap edge take.
- Task 8: minor (deferred): dragging a figure with a caption onto the title puts the caption in the title and removes the figure (undo recovers).
- Task 8: minor (deferred, pre-existing since initial commit): blocks/steps-view.js re-render loop (~1000 DOM mutations/s) whenever a steps block exists — final review to triage; file as follow-up.
- Task 8: minor (deferred): Node tests run prosemirror-view 1.42.9 (transitive) while the browser import map loads 1.38.1; behaviour differs (view.dragging cleared before handleDrop in 1.38) — pin prosemirror-view devDependency to 1.38.1.
- Task 8: minor (deferred): dropcursor still shows at refused drop positions.
- Task 9: minor (deferred): at ≤48rem forced opens (conflict, block tree) land below the fold; scrollIntoView.
- Task 9: minor (deferred): doc-browser delete copy mentions page file/git history in vp serve.
- Task 9: minor (deferred): --color-accent uses remain in untouched _doc-browser.css rules; .hint/.url-prefix use --color-text-muted vs table's --color-text-subtle (darker, fine).
- Task 9: minor (deferred): focused slug input can keep a stale pre-normalization value.
- Task 10: UNCHECKED → after final fix wave: keyboard-only pass with a doc loaded; Theme section → editor theme; Preview success on a Cook site copy; vp serve editor axe with a doc loaded.
- Task 10: minor (deferred): EDITOR.md Preview bullet says "published posts" though the button always shows (drafts get "publish first").
- Task 10: minor (deferred): EDITOR.md files table lists js files without their js/ root.
- Task 10: minor (deferred): EDITOR.md "(see Post settings)" for Unpublish, but Post settings doesn't mention vp serve's Publish/Unpublish button.
- Task 10: complete (commits 92aaee6..769d291, review clean; browser checks UNCHECKED as ledgered above)
- Final: minor (deferred): M1 tabs-view.js prompt() for tab rename (no keyboard path); M2 media-picker alerts (DONE in step 3b); M3 editor.js load-error alert (vp serve); M4 pin prosemirror-view 1.38.1 devDependency; M6 Mod-a in body includes title; M7 spec vs P2 on unpublished posts following the title (confirm with user).
- Final: minor (deferred): editor loads all of vanilla-breeze.js; consider disabling VB analytics in the editor (vbAnalyticsConfig transport 'disabled').
- Final: minor (deferred, pre-existing): collapsible summary holds an input → axe nested-interactive (serious) on doc_comp01/doc_ks_comp.
- Final: minor (deferred): code-block control overlay covers the first code line on hover.
- Final: minor (deferred): preview free-port search starts at 4100 (the user's own dev port).

## Final review

- Final review (opus): C1 steps-view freeze (pre-existing, blocks verification); I1 Task 10 browser checks open; M1–M7 minors. Rulings PF1–PF9 judged reasonable.
- Final: re-graded M5 (Unpublish confirmation can say "The live page" instead of the URL) to Important — plan Review Focus 3 requires the URL.
- Final: declined-to-judge → rulings for user: Enter in title lands before a heading's text; slug field editable on a published post (pre-existing); no pixel diff vs mockups.
- Final fix wave: first fixer hung in a browser tool call (stopped 17:23); retry with script-only browser checks finished: 8ec232d (three DOM-write loops: steps, VB theme-sync on code-block, VB analytics on links), c5505f8 (Unpublish URL), 21c9d69 (control labels). I1 checks all PASS; npm test 854/854.
- Final: Ruling PF10: axe scrollable-region-focusable on a code-block <pre> inside the contenteditable at 390px left unfixed — the caret reaches and scrolls it; axe doesn't count contenteditable as focusable — cost if wrong: one keyboard-scroll gap on phones.
