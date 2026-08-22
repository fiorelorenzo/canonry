# References: Shell, Navigation and Search

This file covers the app shell (fixed sidebar, universe switcher, capped nav, footer), the command palette, the entry browser's table and search, the world home masthead, the two-pane settings shell, the shared empty-state component, the error page, the route progress bar and per-form pending states, and the page header band, gated by A2, A3, G3, I3, I6, I8, I10, O1, R12, U12, V1 and V11. The honest state today: the sidebar, switcher, palette, empty-state component and error page are already built, and the palette already classifies a typed sentence as a question without a manual mode switch, ahead of every reference below it. What is still open is real pagination on the entries table, the universe's own two-pane settings shell, and the progress bar and per-form pending states V11 decided but has not yet built.

## Linear — the capped sidebar and the command menu as overflow

**Maps to** the app shell's sidebar, universe switcher and command palette (A2, A3, G3, V1)

Linear's left sidebar carries a workspace switcher at the very top, a dropdown that changes which company's issues you are looking at, then a short fixed list (Inbox, My Issues, Favorites, Your Teams), then whatever teams and favorites the account actually has. Everything past that list, including dozens of possible actions on an issue, moves to `Cmd/Ctrl K`. On an issue list, `j`/`k` move a highlight with no modifier, `x` selects the highlighted row, and only after something is selected does `Cmd/Ctrl K` open a command bar scoped to that selection. Linear actually ships two boxes rather than one: `/` opens full workspace search and `Cmd/Ctrl K` opens the command menu, and its own docs are explicit that these are different keys for different jobs.

**Evidence** https://linear.app/docs/select-issues (describes highlighting an issue with `j`/`k`, selecting with `x`, then opening the command bar with `Cmd/Ctrl K` to act on the selection) and https://linear.app/docs/search (describes `/` for full workspace search versus `Cmd/Ctrl K` for the command menu, as two separate shortcuts)

**Take** The sidebar-stays-short-and-the-palette-is-overflow shape is A2. The `j`/`k` bare-key, modifier-to-act pattern is G3's own model: the focused list is a review surface where bare keys are fine, and acting on a selection reaches for a modifier. Keep the universe switcher pinned at the very top of the rail, above the nav list, the way Linear does, since that is what makes I3 legible: the switcher is the thing that changes scope, the list below it never does.

**Leave** Linear's two boxes are the one thing not to copy. A3 decided one box on purpose, and Canonry's palette already resolves this better than Linear does: it classifies a typed sentence as a question (a question mark, five-plus words, or a leading what/why/how/who) and shows an Ask row next to the entry hits in the same list, rather than making the reader remember which of two shortcuts to reach for.

## GitHub — bare keys inside a focused list, sigils inside a global palette

**Maps to** the command palette and G3's keyboard layering (A3, G3)

GitHub runs two keyboard systems that never overlap. Inside a repository's code view, single letters do the work: `t` opens the file finder, `l` jumps to a line, `w` switches branch, `s` or `/` focuses the page's own search bar. None of those keys do anything outside that focused browsing surface, and GitHub's accessibility settings let a user turn off character-key shortcuts entirely while keeping modifier-based ones, precisely because bare keys only make sense once a surface is that focused. Separately, `Ctrl/Cmd K` opens the global command palette, and a typed sentence with no leading sigil is treated as a fuzzy match against nearby pages, not as a search or a command: to search you type `#`, `@`, `/` or `!` first, and to run a command you press `>` or reopen the palette with `Ctrl/Cmd Shift K`.

**Evidence** https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts (lists `t`, `l`, `w`, `y`, `i`, `a`, `b` as bare source-code-browsing shortcuts, and separately `S` or `/` to focus the site search) and https://docs.github.com/en/get-started/accessibility/github-command-palette (documents the `>`, `#`, `@`, `/`, `!` sigils and the separate `Ctrl/Cmd Shift K` command mode)

**Take** The G3 split, bare keys inside a focused surface and modifiers everywhere else, is real and GitHub proves it at huge scale: nobody expects `t` to do anything on the homepage, because the homepage was never the surface `t` was written for. Keep that discipline in Canonry's own review surfaces (C6's `j k a r u`, the entries table's row navigation), and never let a bare key leak onto a page that is not a focused list.

**Leave** The sigil system is the opposite of A3. Making a reader type `#` before a search or `>` before a command is a mode switch dressed up as syntax, exactly what a typed sentence that is not a command should never require. Canonry's classifier already avoids this: it reads the sentence, not a leading character.

## GitHub's repository homepage says what the file tree can't

**Maps to** the world home versus the entries browser (O1)

A GitHub repository's homepage renders whichever README it finds, checked in order from `.github`, the repo root, then `docs`, above the file listing. GitHub's own docs are blunt about what that file is for: what the project does, why it is useful, how to get started, where to get help, who maintains it. The file tree underneath is the complete, alphabetical, exhaustive list; the README above it is curated and short, and GitHub tells authors directly that anything longer belongs in a wiki. The two surfaces sit on the same route but do structurally different jobs: one orients, the other enumerates.

**Evidence** https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes (states the README's purpose list directly, the file lookup order, and "longer documentation is best suited for wikis")

**Take** This is the argument for O1's split. The world home at `/w/<slug>` is Canonry's README: a handful of things worth surfacing, not a list. The entries browser at `/w/<slug>/entries` is the file tree: dense, sortable, complete. If the world home ever grows a recent-activity strip, cap it hard the way a README caps itself, since a README that also tries to be the file tree stops being read.

**Leave** GitHub's README is static per branch with no live data. Canonry's world home should stay closer to a real dashboard (recent proposals, an unset-setup nudge) than to a hand-edited document, so the analogy is about the split between the two surfaces, not about turning the world home into prose someone has to maintain.

## Raycast — one box, many types, and Quick AI is a Tab press away

**Maps to** the command palette's routing of a typed sentence (A3)

Raycast's single Root Search box resolves apps, files, calculator expressions, unit and color conversions, calendar events, snippets, quicklinks and installed extension commands all from the same field, ranked by a frecency score that learns per query which of several plausible matches a person actually picks. Full natural-language question-answering is not automatic, though: Raycast's own quickstart says to press `Tab` from Root Search to drop into Quick AI, a distinct mode with its own input. Root Search detects a URL or a math expression inline, but a plain English question does not get an inline AI answer without that keypress.

**Evidence** https://manual.raycast.com/quickstart (states "Press Tab from Root Search for Quick AI, ideal for fast one-off questions") and https://manual.raycast.com/search-bar (documents the heterogeneous result types Root Search resolves and its frecency-based ranking)

**Take** The heterogeneous-types-one-box model is worth taking directly for how Canonry's palette should keep growing: entries, actions and Ask results can all coexist as differently headed groups in the same list, the way Root Search groups apps, files and commands. Frecency, weighting a result by how recently and how often it was chosen, is a cheap upgrade over pure fuzzy-match ranking once the palette has enough usage history.

**Leave** Even Raycast, the industry's best-regarded one-box tool, does not auto-route a full sentence to its AI. That is evidence the automatic classification A3 asked for, and Canonry already built, is the harder and better choice, not a reason to soften it. Do not add a Tab-to-switch-mode affordance; it would be a regression from what is already shipped.

## macOS Spotlight — the ancestor, and what "natural language" means in one box

**Maps to** the command palette (A3)

Spotlight has taken plain-English input since long before "AI" was the framing: type a math expression and it computes, type "300 krone in euros" or "32 ft to meters" and it converts, type "time in Paris" and it resolves a world clock, type "files I worked on in January" and it runs a natural-language file search. None of these need a prefix or a mode switch; Apple's own documentation describes all of them as things you simply type into the same field Spotlight always shows.

**Evidence** https://support.apple.com/guide/mac-help/get-calculations-and-conversions-in-spotlight-mchldd6ba066/mac (lists calculation, currency, temperature, measurement and world-clock queries, all typed directly into the Spotlight field with no prefix)

**Take** Spotlight is the proof this pattern is decades old and works: a single field that infers intent from the shape of the text, a number and a unit means convert, a question means answer, a name means navigate, rather than asking the user to declare intent first. This is the model Canonry's own classifier is already closest to.

**Leave** Spotlight's fallback for anything it cannot resolve locally is a web search, pulled from Siri Suggestions. Canonry has no equivalent to build: a question the entries cannot answer should surface as an Ask conversation, not a web search, and a name that matches nothing should read as an honest empty result, not a redirect dressed up as a fallback.

## Notion — sidebar hierarchy at scale, and a manual escape hatch to AI

**Maps to** the app shell's sidebar and the command palette (A2, A3)

Notion's sidebar groups items into Favorites, Private, Shared and per-workspace Teamspaces, and stays legible at scale mostly because most of what a heavy user touches is reachable through Quick Find (`Cmd/Ctrl P`, or `Cmd/Ctrl K` when nothing is focused) rather than through ever-deeper sidebar nesting. Quick Find's own results are ranked and filterable by title, author, teamspace and date, but the AI layer is not folded into that ranking automatically. It is a separate link, "Search all sources with AI," rendered below the regular results, that the user clicks to leave keyword search and start a generated answer.

**Evidence** https://www.notion.com/help/search (describes Quick Find's shortcut, its sort and filter options, and the "Search all sources with AI" link as a distinct action below the search results rather than an automatic classification of the query)

**Take** Keep leaning on the sidebar's own structure, favorites and recents above a flat list, as the pressure valve for a capped nav, the way Notion does, rather than growing nesting to compensate. Teamspace-style grouping is worth remembering if Canonry ever needs to group universes for an account that owns many.

**Leave** Clicking a separate link for the AI version of a search is a manual mode switch wearing a friendly link instead of a keyboard shortcut, but it is a mode switch all the same, the same shape A3 rejected. Canonry's palette should keep answering both at once, entry hits and an Ask row together, rather than making a question a second click away from a name search.

## VS Code — a modifier table per platform, shortcuts scoped by focus, not by page

**Maps to** cross-platform shortcuts and the bare-keys-versus-modifiers split (G3)

VS Code documents an explicit modifier table (macOS: Ctrl, Shift, Alt, Cmd; Windows: Ctrl, Shift, Alt, Win; Linux: Ctrl, Shift, Alt, Meta), and every keybinding rule can carry a `when` clause, a boolean expression evaluated against the current UI context such as `editorTextFocus` or `inDebugMode`, so the same key can mean two different things depending on what has focus, with no conflict. The docs walk through a worked example: a keydown is logged, matched against the rules whose `when` clause is currently true, and only the winning rule's command runs.

**Evidence** https://code.visualstudio.com/docs/configure/keybindings (states the per-platform modifier list under "Accepted keys" and documents the `when` clause with a worked evaluation trace)

**Take** The `when`-clause idea, a shortcut defined once but only live while a particular surface has focus, is the mechanism behind G3's "bare keys inside a focused review surface" rule. It is worth stating that way in whatever shortcut-handling code Canonry writes: a keydown handler should check that the entries table, or the proposal queue, is focused before treating `j`/`k`/`a`/`r`/`u` as anything but ordinary typing, the same way VS Code's dispatcher checks its `when` clause before a rule can fire.

**Leave** VS Code's remapping system, a whole JSON file editable per user, is far more machinery than a wiki with roughly a dozen shortcuts needs. Canonry does not need user-remappable shortcuts, only a correct default map and correct scoping.

## Figma — the shortcut sheet remaps itself per keyboard layout

**Maps to** cross-platform shortcuts on a non-US keyboard (G3)

Figma's default shortcuts assume a US QWERTY layout, and several punctuation-based ones, `[` and `]` for layer order among them, sit on different physical keys, or need a different modifier entirely, on other layouts. Figma's answer is a "Select keyboard layout" preference covering fifteen layouts including Italian, French AZERTY and German QWERTZ, and the shortcuts panel has a tab per layout showing the actual remapped keys for whichever one is active, rather than expecting the user to translate a US-centric cheat sheet in their head.

**Evidence** https://help.figma.com/hc/en-us/articles/5665442977431-Select-keyboard-layout (lists the fifteen supported layouts including Italian, and shows the remapped shortcut table per layout, with `[`/`]`-based shortcuts changing key entirely on non-US layouts)

**Take** This is the concrete answer to the worry the A3 amendment names directly: an Italian keyboard needs AltGr for `[`, which is why B2/G4 moved mention-triggering off `[[` and onto an always-visible toolbar. Any bare-key shortcut Canonry ships should be checked against at least one non-US, non-UK layout before it ships, the way Figma's own layout tab visibly does that check for every shortcut at once.

**Leave** Figma's fifteen-layout remap table is more than a small app needs to build up front. The right-sized version for Canonry is smaller: pick shortcuts that already sit on the same physical key across the layouts the team actually uses, `j`, `k`, `a`, `r`, `u` all do, and avoid ever repeating the `[[`-on-Italian mistake rather than building a general remapping system.

## Airtable — a filter's operator list is chosen by the field's type

**Maps to** the entries table's type filter (O1, R12, U12)

Airtable's filter builder never shows the same set of operators twice: a text field offers "contains," "does not contain," "is empty"; a number field offers "greater than," "less than"; a linked-record field offers "has any of," "has all of," "is exactly," so the field's own type decides which comparisons are possible to ask for. Conditions read as a sentence, "show me records where the DRI is Jordan Peretz," conjunctions combine several, and the whole configuration lives in the view rather than deleting any data, so a filtered-out record is still there, just hidden from that view.

**Evidence** https://support.airtable.com/articles/9290731839-filtering-records-using-conditions (states "which filter operators are available is determined by the field type" and gives the text and number examples directly, plus the hidden-not-deleted behavior of a view filter)

**Take** Canonry's entries table only needs one filter dimension, entity type, so the type-aware-operator idea scales down cleanly: the type filter is a Select drawn from the universe's actual relation-type vocabulary (O4's shipped-vocabulary rule), not free text, and it filters the table's contents without ever touching the underlying data.

**Leave** Airtable's nested condition groups, three levels deep, up to forty-nine conditions, mixed AND/OR per group, are a spreadsheet power-user feature Canonry's one-dimension type filter does not need and should not grow toward. A GM who wants "chairs in stock or wood over $1,000" is not the reader this table serves.

## GitHub's issue list — a filter is a URL, and the URL is the receipt

**Maps to** search and pagination on the entries table (O1, R12, U12)

Every filter or sort applied to a GitHub issues list rewrites the browser's URL to a `?q=` query string built from typed qualifiers such as `is:open`, `label:"bug"`, `assignee:octocat`, so the exact view is bookmarkable, shareable by pasting the URL, and restorable by the back button with no extra state anywhere else. GitHub's docs say this outright, that the browser's URL is automatically updated to match the new view, and the qualifiers themselves are the whole filtering vocabulary, no separate panel required to reconstruct what the URL already encodes.

**Evidence** https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests (states the URL updates to match the filtered view, gives the `/issues?q=state:open+is:issue+assignee:hubot+sort:created-asc` example, and documents the qualifier syntax)

**Take** This is the mechanic behind U12's "filters as you type, with one clear" and R12's "reads bodies too, and says what it did": the entries table's search and type filter should both live in the URL's search params, already how the form-based search works, so a GM can bookmark "every place, sorted by name" or hand that link to another player at the table. Pagination should extend the same pattern: a page number or cursor in the URL, not client-only state a refresh throws away.

**Leave** GitHub's qualifier syntax, `is:`, `label:`, boolean `AND`/`OR`, parenthesised nesting, is a query language built for people filing hundreds of issues a week. Canonry's search is a single plain-text field that also reads bodies, not a syntax to learn, and R12 was explicit that ranked "who is this" search is the palette's job, not the table's.

## Stripe Dashboard — show the first results immediately, let "view all" do the rest

**Maps to** the entries table's search result count and pagination (O1, R12)

Typing into Stripe's Dashboard search shows the top few matches per object type immediately, and building out the complete, sortable result set only happens after clicking "View all results" or pressing Enter, a deliberate two-speed design: fast partial answer first, complete answer on demand. Search terms are also bookmarkable, since Stripe's docs note the query lives in the URL, and their user guidance mirrors R12's own finding almost exactly: add more terms to narrow a result set that is too broad, remove terms to widen one that is too narrow.

**Evidence** https://docs.stripe.com/dashboard/search (describes the immediate top results, the "View all results" expansion into a full sortable list, and states "as search terms are included in the URL, you can bookmark the search")

**Take** The two-speed idea does not obviously fit Canonry's table, since there is no separate quick-peek step planned, but the URL-as-bookmark discipline reinforces the previous reference from a second, independent product, and the explicit user guidance, too few results means fewer terms, too many means more, is worth putting directly into the search's empty-result copy, since it tells the reader what to do next instead of just reporting a count.

**Leave** Stripe's field-prefixed operators, `amount:`, `status:`, `type:`, are again a query language for a dense financial dataset, not a model for a wiki's plain-text search, which R12 deliberately kept as a filter over names, aliases and bodies rather than a syntax.

## Vercel — the same page exists at the account level and the project level

**Maps to** the shell reaching outside a universe, and the responsive shell (I3, I10)

Vercel's 2026 dashboard redesign treats team and project as two scopes for the same navigation shape rather than two different apps: the changelog describes "projects as filters, so you can switch between team and project versions of the same page in one click," and changing which project is selected keeps the reader on the same view, Web Analytics stays Web Analytics, instead of bouncing them back to a project's own home. The team switcher sits above that shared navigation, separate from it, and the same redesign shipped a floating bottom bar specifically for one-handed mobile use.

**Evidence** https://vercel.com/changelog/dashboard-navigation-redesign-rollout (states "Projects as filters so you can switch between team and project versions of the same page in one click," and describes the resizable sidebar, consistent tabs across team and project levels, and the mobile floating bottom bar)

**Take** This is a clean model for I3: Canonry's account-mode pages (settings, docs, the universe list) and universe-mode pages are not two different shells wearing the same sidebar, they are one shell whose scope changes at the switcher and nowhere else, exactly like Vercel's team-and-project split. For I10, the floating bottom bar for mobile is worth a direct look alongside E4's own bottom-tabs decision, since it is the same shape shipped by a much larger product for the same one-handed reason.

**Leave** Vercel's redesign added a resizable, collapsible sidebar, a heavier control than A2's fixed, capped rail needs. Canonry's sidebar is deliberately not user-configurable, the cap is the point, so resizing and hiding are not features to chase here.

## Sanity Studio — one structure, two panes, one URL

**Maps to** the two-pane settings shell (I6)

Sanity Studio's Structure tool is a chain of collapsible panes: a list pane, document types or hand-grouped items, on the left, opening a document-list or document-editor pane to its right when something is selected, with every pane's identity encoded in the URL as a semicolon-separated path, `book;game-of-thrones` means the `book` type, then that document. Sanity's docs call this out as the point: most states within the structure are represented in the URL bar, which is what lets an editor share the exact configuration state as a link and use the browser's own back button between panes.

**Evidence** https://www.sanity.io/docs/studio/structure-builder-introduction (describes the pane types, the parent-child pane relationship opening to the right, and states "most states within the structure are represented in the URL bar")

**Take** The core shape, a left list of named groups, a right pane showing one group's content, the active group encoded in the route, is exactly I6 and S1's "left rail of named groups, one group open at a time, reused for both account settings and universe settings." Put the open group in the URL path the way Sanity does, so a link to "the Loremaster settings" is a real, shareable link rather than client-only state that resets on reload.

**Leave** Sanity's panes cascade indefinitely, a list can open another list, which opens a document, which opens a view, more depth than a settings page needs. I6's shell is two levels exactly, the rail and the one pane it opens, never a third pane stacking beside it.

## Turbo Drive — a CSS progress bar that needs no page-specific code

**Maps to** the route progress bar (V11)

Turbo, the Hotwire library Rails ships with, built for exactly the server-rendered, full-page-navigation model SvelteKit shares, installs one CSS-based progress bar for the entire application, and shows it automatically only when a navigation takes longer than 500ms, a threshold the docs say exists specifically so fast navigations never flash a bar for no reason. The bar is a plain `<div class="turbo-progress-bar">` restyled with ordinary CSS, and Turbo also toggles `aria-busy="true"` on `<html>` for the duration of the navigation, so the same signal reaches assistive technology, not only sighted users watching a bar move.

**Evidence** https://turbo.hotwired.dev/handbook/drive (states the progress bar "appears automatically for any page that takes longer than 500ms to load," documents the `.turbo-progress-bar` class and its CSS-only styling, and the `[aria-busy]` toggle during navigation)

**Take** This is the exact shape V11 asked for: one implementation, at the layout level, covering every route rather than something each page has to remember to add. The 500ms delay before showing is worth copying outright, since a bar that flashes on every sub-200ms navigation trains the eye to ignore it. The `aria-busy` toggle is the accessible half of a progress bar a purely visual one would miss.

**Leave** Turbo's bar is tied to its own visit lifecycle, Hotwire-specific plumbing. SvelteKit's own `navigating` store, already unread anywhere in the app per the finding that opened V11, is the direct equivalent to wire the bar to; nothing here needs Turbo itself, only the pattern.

## Nielsen Norman Group — the click has to look pressed before the server answers

**Maps to** per-form pending states (V11)

NN/g's guidance on progress feedback opens with the moment before any spinner: a user's wait time begins the instant she initiates an action, and the system should immediately give some visual feedback, because without any visual change most users will assume the action was not registered and will try again. The article's two indicator types map to two durations, a looped spinner for two to ten seconds, a percent-done bar for ten seconds or longer, never a static "Loading…" with no motion at all, and it names the worst pattern outright: a warning telling the user not to click twice, which treats a design failure, no feedback that the first click landed, as the user's problem to manage.

**Evidence** https://www.nngroup.com/articles/progress-indicators/ (states the immediate-feedback requirement, the looped-versus-percent-done duration guidance, and recommends against "don't click again" warnings, saying instead to "show the user that the first click has been accepted and is being worked on")

**Take** This is the argument for why V11 pairs the route progress bar with a pending state on every form: a button has to visibly register the click, disabled, a label change, a spinner inside the button itself, before the network round trip even starts, cheaper to build than a percent-done bar and covering the more common case, since most of Canonry's writes are well under ten seconds but currently give no feedback at all. Never add a please-don't-click-twice caption; disable the control instead.

**Leave** The percent-done, multi-second guidance, exact progress, a step count, is built for uploads and long batch jobs. Most of Canonry's writes, accepting a proposal, saving a field, are the fast case; they need the looped-and-disabled treatment, not a percentage.

## shadcn-svelte's Empty component — one part reused for "nothing here" and for 404

**Maps to** the empty-state component's three variants and the error page (I8)

shadcn-svelte ships a single `Empty` component family, `Empty.Root`, `Header`, `Media`, `Title`, `Description`, `Content`, with no built-in variant prop; every different empty state, no projects yet, no notifications, a user offline, a 404 page, is the same four-part composition with different content slotted in, including the library's own documented example of using it to build a 404 page with a search field and a contact-support line. Canonry's own `EmptyState` component already does the same trick in the other direction: one component, a `kind` prop of `cold`, `settled` or `derived`, and `settled` structurally cannot render an action slot at all, a stronger guarantee than shadcn's version, where nothing stops a caller from passing a button into every variant.

**Evidence** https://www.shadcn-svelte.com/docs/components/empty (shows the composable `Empty.Root`/`Header`/`Media`/`Title`/`Description`/`Content` parts, and a worked "404 - Not Found" example built from the same parts with an `InputGroup` search field inside `Empty.Content`)

**Take** The one-family, several-fillings shape is exactly I8's "one component, three variants," and Canonry's own version is already built and already stricter than shadcn's reference example, since the `settled` branch does not read the `action` prop at all, so guardrail 1's no-bulk-accept reasoning cannot be undermined by a caller forgetting to omit a button. The one real gap: today's `cold` and `derived` variants render as a bordered, padded box, which is a card by the visual language's own definition; restyle them to the hairline-rule-and-space language the rest of the app moved to, without touching the branching logic that already works.

**Leave** shadcn's 404 example puts a second search input directly on the error page. Canonry's own `+error.svelte` already made the better call: its recovery action opens the command palette rather than drawing a duplicate search box, one fewer control for the reader to learn, and it keeps "search" meaning one thing in the app, not two.

## What I would build from this

- Wire the entries table's search, type filter and pagination into the URL's query string (GitHub's issue list, Stripe Dashboard), so a filtered, paginated view is a link a GM can bookmark or hand to a co-GM, closing the real-pagination gap O1 already named.
- Build the universe settings page as the same two-pane rail-plus-pane shell the account settings already use, with the open group encoded in the route (Sanity Studio), finishing S1 instead of leaving it as stacked cards.
- Wire the route progress bar to SvelteKit's own `navigating` store with a delay before it shows, Turbo Drive's 500ms threshold, so it never flashes on a sub-200ms navigation, and give every form's submit button an immediate disabled or pressed state before the request starts (Nielsen Norman Group), closing V11.
- Restyle the existing `EmptyState` component's `cold` and `derived` variants off their bordered boxes and onto hairline rules; shadcn-svelte's Empty shows the composition itself is already right, only the surface needs to catch up to the visual language.
- Keep the palette's automatic question classification and its dual-group results, entry hits and an Ask row together, rather than ever adding a manual "search with AI" link (Notion) or a Tab-to-switch mode (Raycast); Canonry is already ahead of both references and should not regress toward either.
- Pin the universe switcher at the very top of the sidebar, above the nav list and visually separate from it, the way Linear does, so I3's shell-reaches-outside-a-universe reads as a switcher scope change rather than a second sidebar mode.
- Treat the world home strictly as a masthead, a handful of curated things, capped hard, and resist growing it into a second entries list (GitHub's README-versus-file-tree split), now that O1 has already separated the two routes.
- Audit every bare-key shortcut Canonry ships against at least one non-US keyboard layout (Figma), specifically ones that might collide with punctuation needing AltGr, before adding anything beyond C6's `j k a r u`.

## Anti-references

- Notion's "Search all sources with AI" link and Raycast's Tab-to-Quick-AI both turn answering a question into a manual mode switch parked behind an extra click or keypress; copying either would be a regression from what Canonry's palette classifier already does automatically.
- GitHub's Command Palette sigils (`>`, `#`, `@`, `/`, `!`) make the user declare intent before the palette will even look at the query; a typed sentence with no sigil becomes a weak fuzzy-navigation guess, the opposite of A3's one-box promise.
- Airtable's three-level nested filter groups and forty-nine-condition ceiling are a spreadsheet power-user feature; the entries table has one filter dimension, entity type, and should never grow a query builder to match it.
- Sanity Studio's indefinitely cascading panes, a list opening a list opening a document, are more depth than a settings page needs; I6's shell is a rail and one pane, never a third stacking beside it.
