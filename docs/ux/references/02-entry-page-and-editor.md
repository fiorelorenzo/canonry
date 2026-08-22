# References: entry page and editor

This file covers the entry read view and its 256px right aside, the cover image, mention hover and focus previews, the markdown editor with its icon toolbar and write and preview control, margin relations, facts and history, and the GM and players view switch. It is gated by B1 to B4, Q2 to Q5, R9, S5, S7, T2, U5 to U7 and V6. None of this is greenfield: `EntrySections.svelte` already holds five collapsible sections, `FormattingToolbar.svelte` is a working icon toolbar, `MentionPreview.svelte` already resolves through the GM and public endpoints, and `entryMarking.ts` already marks pending-proposal sentences. What this round of decisions closes are named defects in a shipped surface: the aside stopping short of full height, a cover stranded in its own gutter, a preview missing from the sidebar and the aside's own links, two scrollbars fighting each other, a cover nobody can replace from where it sits, an unreadable history, and a mark pointed at the wrong text.

## Wikipedia (Vector 2022) — a measured column and a sticky structural rail, both tested separately

**Maps to** the entry read view's column and the aside that runs beside it (B1, Q2)

Vector 2022 replaced Wikipedia's decade-old desktop skin after research found, among other things, that "character count per line was more than three times the recommended value" and that readers "wanted to have an easy way to view the table of contents throughout the page." The team shipped a sticky header in January 2022, then a persistent, viewport-capped sidebar carrying the table of contents in May 2022, then constrained body text to a measured column, each change run through two-week 50/50 A/B splits before a wider rollout. The whole program was five years of interviews, prototype testing on volunteer pilot wikis, and quantitative testing, not one redesign pass.

**Evidence** https://www.mediawiki.org/wiki/Reading/Web/Desktop_Improvements (project page: the problem list, the five-phase process, the 2019 to 2025 deployment timeline) and https://en.wikipedia.org/wiki/Wikipedia:Vector_2022 (results: "these changes improve readability and usability, and save time spent in scrolling, searching, and navigating... no negative effects on pageviews, account creation, or edit rates")

**Take** shipping the structural rail as its own tested feature, separate from the width change, backs up B1 and Q2 as two decisions rather than one: the aside running the full page height earns its place independently of the 44rem column beside it.

**Leave** Vector 2022 still lets a reader escape the measured column (the RfC that approved the skin also forced a full and limited width toggle). Guardrail 7 and our own reading-room commitment mean Canonry doesn't offer that escape hatch, so we don't need Vector's width toggle.

## Fandom (Critical Role Wiki) — the infobox shape, and what happens once a rail exists

**Maps to** the cover image at the top of the aside (Q5, S5, U6)

Fandom's `portable-infobox` component is close to S5's target: a title heading, an image figure holding the cover art at its own natural ratio, then stacked key-value rows beneath it, the whole thing inside an aside that runs beside the article. On the Critical Role wiki's Vasselheim page, a Dungeons & Dragons actual-play setting, genre-adjacent to Canonry, that aside measures 360px against a 771px article column, and the infobox sits at its top exactly the way S5 wants Canonry's cover to. The same page load also carries a 1299 by 293px leaderboard ad 46px below the header, eight more in-content leaderboard ad slots spaced through the article body roughly every 1000 to 1300px of scroll, and a box ad wedged into the rail itself.

**Evidence** https://criticalrole.fandom.com/wiki/Vasselheim (measured directly from the live page: the `.portable-infobox` markup and thirteen distinct ad-slot elements)

**Take** the infobox shape itself, title then image then stacked facts in a fixed-width margin, is the right model for the aside's header and is worth taking outright.

**Leave** the ad density is the cautionary half of the same page. Canonry doesn't sell the rail, but the lesson generalizes: once a structured column exists, everything wants to live in it, and our own rule that eleven cards on a screen is a defect exists precisely so the aside stays a wiki infobox and never becomes a dashboard.

## Obsidian (Page Preview) — hover by default, gated only where hover would fight typing

**Maps to** mention hover and focus previews (Q3, T2)

Page Preview is a core plugin, on by default, that previews a linked note without navigating away from the current one. Outside the editor (file explorer, search results, the backlinks pane) it fires on a plain hover. Inside Editing view specifically it requires holding Ctrl, or Cmd on macOS, while hovering, because a bare hover in that one surface would fight the act of placing a cursor to type; a setting can make that modifier mandatory everywhere.

**Evidence** https://obsidian.md/help/Plugins/Page+preview (Obsidian Help: "hovering over a link will preview that file in File explorer, Search, Backlinks, and more. To preview a page while in Editing view, press Ctrl... while hovering")

**Take** Obsidian's split, plain hover on a reading surface and gated hover on a surface where the reader is actively typing, is the right precedent if Canonry's own markdown editor ever previews a typed `[[mention]]` before it saves: it should not fire on the same bare hover the entry read view uses.

**Leave** Obsidian has no reader who can't see the target note, it's single-user and local-first, so it has nothing to teach about the permission filter Q3 already requires. That part comes from elsewhere.

## WCAG 1.4.13 — the three conditions any hover-or-focus popover has to satisfy

**Maps to** `MentionPreview.svelte` (Q3, T2)

Success Criterion 1.4.13 requires that custom content triggered by hover or focus, unlike a browser-native title tooltip, which is exempt, be dismissible without moving the pointer or focus (typically the Escape key), hoverable (the pointer can travel from the trigger onto the popover itself without it disappearing), and persistent (it stays visible until the trigger is actually released, dismissed, or its content goes stale). The rationale calls out screen magnification users specifically, who pan a reduced viewport by moving the mouse and lose the page underneath a popover they can neither dismiss nor reach.

**Evidence** https://www.w3.org/WAI/WCAG21/Understanding/content-on-hover-or-focus.html (W3C WAI: the three conditions in full, the magnification and large-pointer rationale, technique SCR39)

**Take** this is a checklist for `MentionPreview.svelte`, not a suggestion: Escape must dismiss it without requiring the pointer to move off the anchor, the pointer must be able to travel from the linking word into the card, and it must not vanish on a timer while the reader is still reading it.

**Leave** nothing to leave. This is the accessibility floor the feature has to clear no matter how the rest of the mechanic is built.

## HackMD — the width syntax our own decision already borrowed

**Maps to** inserted image width in the markdown body (R9)

HackMD's own image documentation specifies appending `=WIDTHx` or `=PERCENT%x` directly after the image URL inside standard markdown image syntax, with a mandatory space before the `=`. A percentage value is capped so "the maximum width will not exceed the display width of the note," the same responsive guarantee R9 wants instead of a pixel value the layout can't keep. This is the exact shape R9 cites when it says the width lives "as a percentage of the measure appended to the URL in the shape markdown-it's own size convention already uses."

**Evidence** https://hackmd.io/@docs/insert-image-in-team-note (HackMD's own docs team: `![](image link =30%x)` for proportional sizing, `![](image link =300x)` for pixel width, both capped to the note's own display width)

**Take** this confirms R9's approach isn't invented, it's a documented convention with a working precedent at the same one-file, one-source-of-truth stakes Canonry cares about, since a HackMD note is also a plain markdown file. Canonry's three-preset UI (a third, two thirds, full) over free-typed percentages is the one improvement worth keeping over HackMD's raw numeric entry.

**Leave** HackMD's own doc admits the syntax "won't work on other platforms," which is the same risk R9 accepts. That's fine, F4's export is ours to define, but it means the width is Canonry markdown, not portable GFM, and that has to be stated in the export documentation rather than assumed.

## Notion — a drag handle that writes the width somewhere else

**Maps to** inserted image width, as the anti-pattern R9 refused (R9)

Hovering a Notion image reveals two vertical drag handles at its left and right edges; dragging either resizes the image while Notion holds the aspect ratio, and dragging far enough turns the image into a full-bleed page header. The number this produces is stored as a property of the image block in Notion's own object graph, not inside any text a person could read, copy, or export as markdown, because a Notion page isn't a markdown document underneath, it's a tree of blocks.

**Evidence** https://classroom-physicists.physics.mcgill.ca/documentation/notes/quick-guide-to-using-notion/images (documented walkthrough of the hover-to-reveal-handles interaction, consistent with Notion's own current help material on image blocks)

**Take** the interaction itself, drag a handle instead of typing a number, is nicer than what R9 chose. If Canonry ever adds a drag handle, the value it produces still has to land back in the markdown URL, never in a separate field on the image row.

**Leave** the whole model behind it. An entry's body is markdown, read and written by both a person and the copilot; a width that lives outside that text is a second source of truth about a document a model also reads and writes, the exact failure R9 names.

## Obsidian (Backlinks) — two collapsible sections that only show what's actually there

**Maps to** the aside's relations section (B1, B3)

The Backlinks pane lists every note that links to the active one, split into two collapsible groups: Linked mentions (an actual `[[wikilink]]`) and Unlinked mentions (the note's title appearing as plain text elsewhere, an implicit relation nobody has confirmed). Each group has a "Collapse results" toggle that folds every note down to just its count, a "Show more context" toggle for the surrounding paragraph, and the whole pane re-targets automatically when the active note changes.

**Evidence** https://obsidian.md/help/Backlinks (Obsidian Help: the Linked and Unlinked split, the collapse and context toggles, the active-note retargeting)

**Take** the Linked versus Unlinked split maps closely onto what B3's one-click confirm and retype is already doing (a resolved relation versus a proposed one), and folding a group down to a bare count is exactly the collapsed-with-a-count state B1 wants for the aside's five sections.

**Leave** Obsidian never distinguishes who or what proposed an unlinked mention. There's no author at all in a single-user local vault, so it has nothing to say about B4's permanent human-versus-accepted-AI badge, which has to come entirely from Canonry's own history section.

## Notion — a backlink that names what it's hiding

**Maps to** relation and mention previews under guardrail 6 (Q3, T2)

Notion auto-creates a backlink every time a page is @-mentioned and shows the count as "{#} backlinks" above the title, appearing on hover. Backlinks respect the viewer's own permissions rather than the mentioning page's: "you will only be able to see backlinks for pages you have access to... Backlinks to pages that are only visible to you will be labeled as Private," so a teammate can see that a relation exists without seeing what it points to.

**Evidence** https://www.notion.com/help/create-links-and-backlinks (Notion Help: backlink creation on @-mention, the per-viewer permission filter, the Private label)

**Take** Private is a better model than a silently missing row for what happens when a relation or a mention points at something the current viewer can't see, a `gm_only` entry surfacing in a shared view, say: name that a relation exists and why it's withheld, rather than letting the row disappear and the reader wonder whether the data is missing or hidden.

**Leave** Notion's label sits on an already-rendered page; it doesn't have to survive an async permission check inside a hover popover the way Q3's "same filter that decides whether the link resolves at all" does, so the timing here is closer to V7's gap page than to `MentionPreview.svelte` itself.

## Google Docs (Suggesting mode) — the two things it gets wrong for us

**Maps to** what Canonry's change bar deliberately is not (V6, guardrail 1, guardrail 2)

Suggesting mode renders every insertion in a color keyed to the suggester's identity and every deletion as struck-through text in that same color, inline in the document, with a comment thread attached to each suggestion. The owner reviews suggestion by suggestion from the comment thread, or from Tools previews the whole document with every suggestion applied or reverted and clicks Accept all or Reject all in a single action.

**Evidence** https://support.google.com/docs/answer/6033474 (Google Docs Editors Help: color-coded insertions and strikethrough deletions, per-suggestion accept or reject, "Accept all" and "Reject all" as single actions under Tools > Review suggested edits)

**Take** the per-suggestion comment thread is a reasonable model for attaching a rejection reason to one proposed change, which guardrail 3's evidence requirement already wants living near the diff.

**Leave** two direct collisions. The suggester's identity is a color painted onto the prose itself, guardrail 2's forbidden move (the mark is shape, never hue, and never doubles as an author signature). And Accept all closes the whole document in one click, which is exactly what guardrail 1 refuses except for its one named exception.

## Google Docs (Version history) — names its authors, and stops there

**Maps to** revision history authorship (U7)

The "Last edit" control opens a right-hand panel listing every version with the editor's name, avatar, and timestamp; opening one shows that version's content with Restore, Compare, and Make a copy actions, and up to forty versions can be pinned with a name so routine autosaves don't crowd them out. On paid tiers, right-clicking any span of text offers "Show editors" to see who touched exactly that selection, scoped tighter than the whole-version view.

**Evidence** https://support.google.com/docs/answer/190843 (Google Docs Editors Help: the version panel with avatars and timestamps, named versions, restore-as-copy behavior, per-selection "Show editors")

**Take** "Show editors" scoped to a single text selection is sharper than anything Canonry's history currently promises. U7 links a revision to its proposal, but a reader looking at one sentence still has to open the right revision to learn who wrote it, where a per-span lookup would answer it in place.

**Leave** every author in this system is a person. Google Docs was never built to say "this paragraph was drafted by a model and accepted by a person," so its avatar list is a name, never the human-versus-accepted-AI distinction B4 and U7 both require. Copying the visual pattern without the author-kind badge would silently drop the fact that matters most here.

## Confluence (Page History) — its own admission that it can't say who wrote what

**Maps to** revision history authorship (U7)

Page History lists every version with a timestamp and a row of contributor avatars (a version can carry several contributors if more than one person edited before it published); hovering an avatar names that person. Comparing two versions highlights green for added content, red for deleted content, and blue for changed formatting, with long unchanged spans collapsed to an ellipsis, and adjacent-version links let a reader walk the diff one step at a time.

**Evidence** https://confluence.atlassian.com/doc/page-history-and-page-comparison-views-139379.html (Atlassian Documentation: contributor avatars, the green/red/blue comparison legend, the ellipsis for unchanged text, and the line "it is not possible to view the individual changes made by each person in a single page version")

**Take** the three-color comparison legend cleanly separates what changed from what kind of change it was, content versus formatting, which is a useful axis to keep distinct from V6's own change bar, whose single color only ever means "waiting on review," never a content type.

**Leave** Confluence's own documentation admits that a version with several contributors can't say which person wrote which sentence, only that they all touched that version. That is the exact gap U7 has to close: every revision links to the one proposal behind it, so "who, human or accepted-AI, wrote this sentence" always has a specific answer rather than a list of names to guess from.

## Confluence (Page Properties macro) — putting facts back in the prose

**Maps to** facts on demand, kept out of the article body (B4)

The content properties macro is a two-column key-value table a writer inserts directly into the page body from the toolbar or a `/` slash command; the left column supplies keys, the right supplies values, and a separate report macro elsewhere in the space can pull matching tables into a summary. Multiple property tables can live on one page, distinguished by an optional ID, and a table can be marked Hidden to feed the report without rendering inline, but by default it renders as a literal block inside the article's own reading flow.

**Evidence** https://support.atlassian.com/confluence-cloud/docs/insert-the-page-properties-macro/ (Atlassian Documentation: macro insertion via toolbar or slash command, the two-column key-value shape, the optional Hidden setting, multi-table pages via an ID)

**Take** the Hidden-but-still-feeds-a-report option is worth noting: structured data doesn't have to render at its authored location to be reusable elsewhere. Canonry doesn't need it, since the aside is already that elsewhere.

**Leave** the default is a structured table sitting inside the article's own reading measure, competing with the prose for the reader's eye on a page that's supposed to be a document first. B4 already settled this the other way: facts live in the aside, closed by default, reachable on demand, never inline in the body a GM is trying to read.

## GitHub — an icon toolbar that never says what an icon means, and a body that can't hold a width

**Maps to** the editor's icon toolbar and write and preview control (B2, Q4), and inserted image width (R9)

Two GitHub editors matter here. The plain file editor, behind a repository's pencil icon, is a bare CodeMirror text box with a Preview tab above it and nothing else. The comment editor used on issues, pull requests, and discussions carries "a text formatting toolbar, which allows you to format your text without learning Markdown syntax," covering bold, italic, headers, links, lists, `@`-mentions, task lists, and issue references as always-visible icon buttons. Neither editor can size an inserted image through markdown syntax, GFM has none, so resizing means writing a raw `<img src=... width=...>` HTML tag inline in the same file instead.

**Evidence** https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/about-writing-and-formatting-on-github (GitHub Docs: "every comment field on GitHub contains a text formatting toolbar... without learning Markdown syntax") and https://docs.github.com/en/repositories/working-with-files/managing-files/editing-files (GitHub Docs: the file editor's Preview tab and CodeMirror note)

**Take** pairing an always-visible icon toolbar with a Preview tab is close to Q4 and B2's shape already, and it confirms the two surfaces, a toolbar for anyone who doesn't want to type markdown and a segmented write and preview control for checking the result, are meant to coexist rather than replace each other.

**Leave** GitHub's own docs never mention a tooltip on any toolbar button, exactly the gap Q4 refuses to leave open on Canonry's toolbar. And forcing raw HTML into a markdown file to size an image is a second syntax living inside the same document, a smaller version of the second-source-of-truth problem R9 already ruled out, even without leaving the file.

## iA Writer — decoration that never touches what's actually there

**Maps to** live decoration in the markdown editor (B2), and the shape of a mark that carries no claim about the text (V6)

Syntax Highlight colors words by part of speech, adjectives brown, nouns red, verbs blue, and so on, directly in the editor, and iA Writer states plainly that it "does not modify your content in any way," staying invisible in Preview, exports, and print. It pairs with Focus Mode, which fades every sentence but the one being written, and it can be toggled from four different places, settings, a focus dropdown, the title bar, or a shortcut, leaving the document exactly as it was when off.

**Evidence** https://ia.net/writer/support/editor/syntax-highlight (iA: "Syntax Highlight does not modify your content in any way, and the highlighted parts of speech will not be visible in Preview, exported or printed documents. This feature is visible in the Editor only.")

**Take** this is the right model for a decoration layer that must never leak into the stored document: fully reversible, editor-only, gone from any exported or read-only view unless the underlying content actually changed. B2's icon-driven decorations and V6's change bar should both be able to make the same claim iA Writer makes about Syntax Highlight.

**Leave** iA Writer's decoration is purely typographic and carries no claim about review state, evidence, or authorship, so it's a precedent for the mechanism only, not for what Canonry's marks actually mean.

## Readwise Reader — a right panel that becomes marginalia when you close it

**Maps to** the aside's relationship to the reading column (B1, Q2)

Reader's document view runs a table of contents on the left and a "context panel" on the right, each toggled independently with `[` and `]`; the product says plainly that both are useful "at the beginning of the document, but interfere once you truly begin a focused reading session." Closing them does more than add width: annotations that render "compressed inline" while the panel is open reflow into "beautiful marginalia" once it's hidden, so the same data gets a denser and a looser layout depending on whether the structured column is present.

**Evidence** https://blog.readwise.io/p/bf87944f-b0fe-4f08-a461-f75ab8aded6a/ (Readwise Blog, "Getting Started with Reader": the `[` and `]` panel toggles, and "When the side panels are hidden, those annotations will appear as beautiful marginalia. When they're open, your annotations will be compressed inline.")

**Take** Reader's independent keyboard toggle for the right panel, on top of any responsive collapse, is worth having as a Canonry shortcut for the aside, since a GM at full desktop width might still want the reading column alone for a moment.

**Leave** Reader's marginalia-versus-inline reflow is a bigger engineering commitment than Q2's answer needs. Canonry's aside doesn't need two rendering modes for the same content, just the one full-height column B1 already chose.

## Typora — hiding the source Canonry has to keep visible

**Maps to** what B2's decision explicitly is not (B2)

Typora's Live Preview renders inline styles the moment typing stops and block styles on Enter, and its own documentation describes removing "the preview window, mode switcher, syntax symbols of markdown source code, and all other unnecessary distractions" in favor of one WYSIWYG surface. The literal `**`, `#`, or `[[` characters disappear from view once a block renders, though a raw-source mode exists if a writer goes looking for it.

**Evidence** https://support.typora.io/Quick-Start/ (Typora Support: "Markdown tags for inline styles, such as `**` will be hidden or displayed smartly. Markdown tags for block level styles... will be hidden once the block is rendered.")

**Take** nothing directly, but it sharpens why B2 chose differently: Typora is built for someone who never wants to see markdown at all, the opposite of B2's stated audience, someone who finds `[[` an awkward AltGr combination and still needs to see, and sometimes type, the literal syntax.

**Leave** hiding the raw characters by default is precisely what B2 refused when it kept markdown as the visible, always-typeable stored form with a toolbar beside it rather than replacing it. A Typora-style editor would fight the same Italian-keyboard rationale that motivated B2, and it would turn the `[[name]]` mention trigger into something a writer has to reveal rather than something already on the screen.

## What I would build from this

- Make `MentionPreview.svelte` demonstrably satisfy WCAG 1.4.13: Escape dismisses without moving the pointer, the popover is reachable by moving the cursor from the trigger into the card without it closing, and it never disappears on a timer while still hovered or focused. From the WCAG and Obsidian references.
- Wire the aside's cover to the Fandom infobox shape S5 already specifies: title, image at its natural ratio, stacked sections below, and keep the aside itself free of anything that isn't the entry's own structured data, no ads, but also no eleventh card. From the Fandom reference.
- Extend Notion's Private backlink label to the aside's relation rows and to `MentionPreview.svelte`: when a viewer can't see the target entry, say so and name why, instead of a silently missing row or a dead link. From the Notion backlinks reference.
- Hold R9's percentage-in-the-URL approach for image width exactly as decided, now with HackMD's own convention as direct precedent, and resist any future drag-handle request unless the value it produces still writes back into the markdown. From the HackMD and Notion image references.
- Add a tooltip to every icon in `FormattingToolbar.svelte` as Q4 already requires, treating GitHub's own toolbar as the negative example: GitHub ships the same always-visible icon shape without a documented tooltip on any button. From the GitHub reference.
- Build revision history so every row carries the human-versus-accepted-AI badge B4 wants and links to its proposal per U7, closing the exact gap Confluence's own docs admit they can't close and the gap Google Docs never tries to close. From the Confluence and Google Docs history references.
- Keep V6's change bar reversible and content-blind the way iA Writer's Syntax Highlight is: a decoration that disappears cleanly, never rewrites the paragraph through an escaping filter, and makes no claim beyond "something is waiting here." From the iA Writer reference.
- Never let facts leak into the article body the way Confluence's page properties macro does by default. B4's facts stay in the aside, closed, on demand. From the Confluence page properties reference.

## Anti-references

- Fandom's Critical Role wiki buries a correct infobox pattern under a 293px top banner ad and eight in-content leaderboard ads through the article body. The infobox is worth taking, the page around it is a warning about what happens once a structured column exists and something else wants to sell against it.
- Google Docs' Suggesting mode colors every edit by the suggester's identity and offers Accept all as a single click. Both collide directly: guardrail 2 says the mark is shape, never hue, and never doubles as an author signature; guardrail 1 refuses any accept-all except its one named exception.
- Notion stores an image's width, and nearly everything else about a page's layout, as a property on a block object, not inside any text a person and a model read together. That is the second source of truth R9 was written to refuse.
- Typora deletes the raw markdown characters from view the instant a block renders, the opposite of B2's decision to keep markdown visible and typeable with a toolbar beside it, specifically because the person building this product finds `[[` awkward on an Italian keyboard and still needs to see the literal syntax.
