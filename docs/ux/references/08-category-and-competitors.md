# References: category and competitors

This file covers the surfaces a GM already has an opinion about because they have paid for something that does part of the job: the entry page and its relations (B1 to B5), the copilot loop end to end (C1 to C10), import and onboarding (D1, D7), secrets and the players' wiki (E6, E7), and export (F4). It is honest about where we stand: nobody in this category ships propagation, and that is our whole claim, but three of them ship pieces of the review discipline we depend on, and one of them is the reason F4 exists at all.

## World Anvil — secrets and subscriber groups

**Maps to** secrets authoring and the players' wiki (E6, E7)

A secret in World Anvil is an object, not a text style: you write it once in the Secrets panel, then either embed it inline in an article body (to a reader without permission the paragraph simply does not exist, no placeholder, no "hidden" label) or attach it as a tab in the metadata section for GM-only reference. The same secret can be embedded in several articles at once, so revealing a faction's true allegiance means changing one secret's subscriber group rather than editing every article that mentions it. Readers are sorted into subscriber groups (a party group, per-character groups for split knowledge, a former-party group that freezes at the point a player leaves), and a secret can belong to several groups at once. A separate "visibility toggle" flips a whole section visible to everyone at once for a live table reveal, but it needs Grandmaster tier and above.

**Evidence** https://loreteller.com/learn/world-anvil-secrets-guide/ (independent step-by-step guide to the embed/attach split, subscriber groups, and the tier-gated visibility toggle; World Anvil's own `worldanvil.com/learn/secrets/secrets` page returned HTTP 403 to a direct fetch, so this line is [INFERENCE] against a third-party source rather than the primary docs) and https://blog.worldanvil.com/worldanvil/dev-news/interactive-maps-upgrades/ (World Anvil's own Feb 2024 dev blog, confirming drag-and-drop pins, live edit mode with no page refresh, and polygons and lines for routes and boundaries, opened directly)

**Take** embedding as disappearance rather than redaction is exactly what our players' wiki gap page should feel like: an undiscovered entry is not a locked page with a padlock icon, it does not exist for that reader yet, which is E7's own "gap page" instinct already. The same secret informing several articles at once is the shape our propagation plan should aim for on the writing side too.

**Leave** subscriber caps are priced by membership tier (Journeyman 5, Master 10, Grandmaster 100, Sage 1,000 per the same guide), which means how many players can see a reveal is gated by what the GM pays, and an "Open Secrets" setting quietly bypasses subscriber groups for co-authors, a bulk exception guardrail 1 does not allow us. Nothing propagates a fact change into the secrets built from it; the GM hunts every embed by hand.

## World Anvil — templates, maps, and the density the company itself keeps apologizing for

**Maps to** entry anatomy and the editor (B1, B2)

World Anvil ships 28 fixed article templates (Character, Settlement, Organization, Species, Myth, Military Formation, and so on), each a free-form intro plus tab-organized fields; a Character template alone splits across Generic, Personal, Social, Naming and Divine tabs holding 50-plus optional sub-fields, from eye colour to speech patterns to a full family tree. Fields that are left blank simply do not render on the published page, which is the density's only relief valve. The company's own blog has walked this back twice: a Dec 2024 post says an event-editing panel was "reorganized... to make it easier to use and less overwhelming," with options moved to an "Advanced" tier, and a Feb 2024 post frames the whole maps rework around "mobile friendliness... taking up less screen real-estate with fewer buttons."

**Evidence** https://blog.worldanvil.com/newsletter/world-anvil-news-december-2024/ (World Anvil's own December 2024 newsletter naming the event panel as "overwhelming" and describing the fix, opened directly)

**Take** the tab-per-facet template is a reasonable answer to "what fields does a Character need" and our own B1 right column (relations, facts, images, history) is the same idea kept to four tabs instead of five-plus-fifty-fields; the discipline worth copying is theirs after the walk-back, not before it.

**Leave** 28 templates times tabs times fields is the opposite of A1's twelve-token type system and G2's "no boundary rule to argue about." A GM choosing a template before writing a word is choosing a form to fill in, which is what B1's "document plus a switching column" was built to avoid.

## Kanka — @mentions that survive a rename, and what stays manual

**Maps to** the editor and mentions, relations and inference (B2, B3)

Kanka's mention syntax has two forms: `@` plus three letters searches by name and inserts a simple mention, `[` plus a few letters opens advanced search and inserts `[entity:123]`, which can carry a custom display name, a link to a specific subpage, or an inline field like `{attribute:123}`. The load-bearing detail is in the docs' own words: "@mentions automatically use the entry's current name, so updating the entry name will update every mention," except where a custom display name overrides it. A mention to an entry the current reader cannot see renders as the plain word "unknown" rather than a broken link or a name leak. Relations and permissions are separate systems: connections (mentor, enemy, employer) are typed and reciprocal but entered by hand per pair, and visibility is role-based per entity (Admin, Players, Public) with no per-field granularity, so a GM cannot show a character's appearance while hiding their allegiance the way World Anvil's secrets can.

**Evidence** https://docs.kanka.io/en/latest/features/mentions.html (Kanka's own documentation, opened directly, containing the exact quoted sentence on rename propagation)

**Take** automatic mention-name propagation on rename is the smallest possible version of "you changed this, here is what else that touches," done for a string rather than a fact, with no review step because nothing except display text moved. It is a good floor for what B2's mention decorations should guarantee for free, at zero cost to the GM, before C3's real propagation plan ever runs.

**Leave** connections are hand-typed pairs with no inference and no suggestion; nothing in Kanka proposes a relation the way B3's margin panel does, and per-entity rather than per-field visibility means Kanka cannot do what World Anvil's secrets do inside one article.

## LegendKeeper — canvas-plus-wiki, and the export promise as a sales pitch

**Maps to** entry anatomy and export (B1, F4)

LegendKeeper is a solo-developer product (Braden Herndon) built as, in its own words, a "precision blade" against World Anvil's kitchen sink: no CSS, no forms, no ad-supported free tier, one paid tier at $9/month or $90/year with a 14-day trial and no credit card required. Its distinguishing shape is three entity kinds sharing one wiki: Pages (markdown articles), Maps (which nest inside each other, so a city map sits inside a continent map), and Boards (an infinite canvas where "Page Cards" embed a live preview of a wiki page and an arrow tool draws quest flows or family trees). A map pin can link directly to a wiki page and vice versa, so dropping a pin on a location article's map auto-suggests linking it back.

**Evidence** https://www.legendkeeper.com/pricing/ (LegendKeeper's own pricing page, opened directly, quoting the exact $9/$90 figures, the 14-day no-card trial, and this sentence on lapsed accounts: "We will always ensure you can view or export your own data. Data lock-in is completely against our values. We commit to always maintaining an export feature so that you can leave LegendKeeper at any time, regardless of your subscription status.")

**Take** that sentence is the strongest F4 precedent in the whole category: a competitor saying the export promise out loud, unprompted, inside the pricing page itself, exactly where G10 is deciding where our own sentence should live. LegendKeeper's nested maps and two-way pin-to-article linking are also a cleaner take on cross-referencing than anything else surveyed here.

**Leave** it is one developer's product; the FAQ itself says "LegendKeeper is still in Beta." A guardrail-7 style promise from a single point of failure is worth citing, not worth copying the risk profile of.

## Realm Works — the shutdown that built our F4

**Maps to** export (F4), and the reason SPEC 13 exists

Realm Works (Lone Wolf Development) modeled a world as Topics carrying Aspects, auto-linked by name-matching so mentioning "Blackwood" anywhere in the text became a hyperlink without the author doing anything, plus a granular per-snippet reveal so a topic could be shown to players piece by piece as they discovered it. In September 2019 the company's president posted that development was "officially suspended," framing it as a business failure rather than a shutdown: the servers stayed up, so the product kept looking alive while no further work happened on it. Export existed (`.rwexport` for a full backup, `.rwoutput` for a compact one) but lived behind a "Share > Manage Exports" menu that most users never found until it was too late to matter, and only after the announcement did the community write its own tools: a Foundry VTT importer and a third-party `.rwoutput` converter, both filling a gap Lone Wolf's own UI had left unadvertised.

**Evidence** https://www.wolflair.com/an-update-from-our-president/ (Lone Wolf Development's own September 2019 announcement, opened directly, containing "we are officially suspending work on Realm Works... the servers will continue running, so the product will remain incredibly useful in its current form")

**Take** nothing, structurally; this is the anti-reference our F4 decision already answers. The one thing worth repeating verbatim is DECISIONS.md's own reading of it: "a feature nobody is told about answers nobody," which is exactly what Realm Works' hidden export menu proved by counterexample.

**Leave** auto-linking by exact name match is brittle (Realm Works' own limitation, inherited and partly fixed by Kanka's mention syntax above) and per-snippet reveal with no propagation meant a GM still updated every topic touched by a reveal by hand, same as World Anvil's secrets.

## Obsidian plus Dataview, Templater, Fantasy Statblocks, and Leaflet — the plugin economy nobody can dislodge

**Maps to** the entry model as a whole, and export (B1, F4)

Obsidian's own model is the whole argument: a vault is a folder of plain markdown files on the user's own disk, backlinks are computed locally from `[[wikilink]]` syntax, and nothing about the format requires Obsidian to keep reading it. Dataview turns YAML frontmatter and inline `Key:: Value` fields into a queryable index; its own README example is `TABLE time-played, length, rating FROM #book SORT rating DESC`, rendered as a live table inside the note, recomputed whenever any source file changes. Fantasy Statblocks renders a structured YAML block into a formatted 5e-style stat card inline in a note, with community bestiary packs importable in bulk. Templater and Leaflet round out the stack: templated note creation with computed fields, and pin-and-marker interactive maps drawn over an uploaded image, both third-party, both reading and writing the same plain files as everything else.

**Evidence** https://github.com/blacksmithgu/obsidian-dataview (Dataview's own README, opened directly via the GitHub API, containing the exact `dataview` query block syntax and its four query modes)

**Take** the format decision is the one worth taking whole: markdown as the stored form, decorated in the editor but never locked in a proprietary structure, is already B2's decision and F4's justification. Dataview's live-recomputed table is a reasonable model for how a Canonry entry might surface derived facts without a human re-typing them.

**Leave** nothing in the stack has a concept of AI-drafted, evidence-linked, or accepted; a Dataview query has no idea whether the value it is displaying came from a human edit or a hallucinated frontmatter field, because nothing marks provenance. The stack's real moat is lock-in through irreplaceability of the *plugins*, not the data, which is the opposite lesson from Realm Works: Obsidian wins by never controlling the files, and loses nothing by a GM leaving, which is why nobody leaves.

## Notion — the database-of-databases a GM builds by hand

**Maps to** entry anatomy and propagation (B1, C3)

Notion has no worldbuilding product; what exists is a template gallery (`notion.com/templates`) of community-built campaign planners, each a set of linked databases (Characters, Locations, Sessions, NPCs) wired with relation properties and rollups a GM configures by hand: a relation property on the Sessions database points at Characters, a rollup on Characters counts how many sessions that character appeared in, and none of it updates itself if the GM renames a character outside the relation's own edit flow. Every cross-reference is a manual database design decision made once at template-setup time, and every new entity type (a faction, a language) means duplicating the database, relation, and view pattern again.

**Evidence** https://www.notion.com/templates/worldbuilding-campaign-planner (Notion's own template listing, opened directly, showing the linked-database structure a GM inherits by installing the template)

**Take** nothing structurally new, but it is the honest DIY baseline: this is what "no product, just infrastructure" costs a GM in setup time, and it is the ceiling our import flow (D1 to D7) should feel dramatically faster than.

**Leave** relation and rollup properties are Notion's version of B3's inference margin, except nothing infers them; the GM wires every link, and a renamed entity silently breaks any view built on the old name until someone notices.

## Notion AI — Q&A cites sources, Writer forgets it wrote anything

**Maps to** evidence display, AI text marking, accept and reject (C1, C5, C6)

Notion's AI package is three separate tools. Q&A answers a typed question by searching the pages the asker has access to and returns "a succinct answer... with references so you can verify the result"; Notion's own help copy states plainly "Q&A references only your pages, and always cites its sources." Writer, by contrast, is a drafting assistant invoked with a space keypress inside any block: it generates or edits text in place, with an accept/discard choice for that single generation, but once inserted the text is indistinguishable from anything the human typed, no marking, no history entry, nothing that survives the accept. Autofill is a third, narrower tool: a database property that summarizes or extracts a value per row, recomputed automatically as rows change, closer to a live query than a suggestion.

**Evidence** https://www.notion.com/help/guides/unearth-fresh-insights-from-your-personal-knowledge-library-using-q-and-a (Notion's own help centre, opened directly, containing the quoted sentence "Q&A references only your pages, and always cites its sources," plus the three-tool breakdown of Writer, Q&A and Autofill)

**Take** Q&A's "always cites its sources" is the right instinct for C5 and the right sentence to hold ourselves to, even though its citation is a source link rather than the specific-sentence evidence C5 requires; the "only your pages, no outside knowledge" boundary is also close to what our Ask mode already promises.

**Leave** Writer is the clearest anti-reference for guardrail 2 available: an AI-authored paragraph accepted into a page becomes ordinary text with the same weight as anything the human wrote, forever, which is precisely the "AI text is visually distinct until accepted, and stays tracked afterwards" guardrail arguing against itself if we ever relaxed C1's "unaccepted wording never enters the entry's own reading flow."

## Fandom — what live-on-save actually looks like

**Maps to** the players' wiki, and guardrail 6 (E7)

A Fandom wiki is MediaWiki with no draft state for ordinary content: an edit saved by any logged-in account is live to every reader immediately, with no moderation queue, no review step, and no distinction between a GM's canon page and a first-time editor's typo fix. Opening a page on Fandom's Critical Role wiki directly, the DOM carried 46 to 55 ad-related elements per page load (banners, sticky units, an `adsbygoogle` slot) alongside a working `?action=history` revision log and a `portable-infobox` on character pages, and the edit link (`?action=edit`) sits directly on the page with no gate in front of it. The only exception Fandom documents anywhere is JavaScript changes to site-wide gadgets, which do go through admin review; ordinary article content does not.

**Evidence** https://criticalrole.fandom.com/wiki/Vox_Machina (opened directly via browser and inspected: confirmed a live `portable-infobox`, a working `action=history` link, and a direct unauthenticated `action=edit` link with no review gate, plus 46 ad-tagged DOM elements on a single character page)

**Take** the infobox and the categories are a reasonable public-facing rendering of structured fields, close to what a players' wiki entry might look like once revealed; the revision history as a permanent, visible ledger is a pattern worth keeping for provenance (B4).

**Leave** live-on-save with no review gate is the direct opposite of guardrail 6: nothing on Fandom distinguishes reviewed canon from an edit that landed ninety seconds ago, and the ad density is what volunteer-run, unpaid-contributor wikis fund themselves with, which our own players' wiki has no reason to inherit even in spirit.

## Campfire Writing — modules priced like DLC

**Maps to** quota and cost, and entry anatomy (F2, B1)

Campfire sells worldbuilding to novelists, not GMs, and prices it per module: the free tier gives limited access to every module at once (10 Characters, 20 Timeline events, 2 Maps, 1 Calendar, 5 Encyclopedia articles, 1 Magic System, 1 Language, and so on, each capped independently), and a Standard plan removes every cap for one flat subscription ($12/month discounted from $19, or an annual and lifetime tier beside it). Its own FAQ is explicit about what happens at the cap: past the free ceiling, older elements stay editable and newer ones become read-only until the GM upgrades, one field at a time, per module.

**Evidence** https://www.campfirewriting.com/pricing (Campfire's own pricing page, opened directly, with the exact per-module free-tier caps and the $19-to-$12 Standard Monthly price)

**Take** nothing to adopt directly, but the read-only-past-the-cap pattern is a cleaner way to handle a quota ceiling than a hard block, worth a thought for F2's meter if a free tier is ever built.

**Leave** module silos mean a character element and a timeline element share no data model; nothing propagates between them, and per-module pricing turns "I want to track a magic system" into a purchase decision, which is the opposite of guardrail 4's charge-for-generation-not-for-structure principle.

## D&D Beyond — campaign notes bolted onto a ruleset platform

**Maps to** entry anatomy, and what a wiki is not (B1)

D&D Beyond's Campaigns feature is a single page per campaign holding a free-text Description, a Private Notes field visible only to the DM, and a Public Notes field visible to the DM and every player in that campaign, plus an auto-populated roster of linked character sheets. There is no NPC entity, no location entity, no session log as a structured object: years of the product's own user forum describe the same workaround independently, GMs pasting session summaries and NPC descriptions into the one Public Notes text block because there is nowhere else to put them.

**Evidence** https://www.dndbeyond.com/forums/d-d-beyond-general/d-d-beyond-feedback/170305-request-for-shared-notes-in-campaigns (D&D Beyond's own hosted forum, opened directly: "There is a note the DM can edit listing a Description, public and private notes," corroborated independently across six other threads on the same domain going back to 2017; this is the shipped feature described by its users rather than a dedicated docs page, since none exists)

**Take** the private/public split by role is a reasonable minimum default (close to E7's undiscovered-as-gap idea, in miniature), and tying campaign context directly to character sheets means player-facing data never drifts from the ruleset platform underneath it.

**Leave** a single freeform text block is not a wiki; there is no entity, no relation, no history, and nothing to propagate into, which is the entire argument for why D&D Beyond is a rules platform with notes bolted on rather than a worldbuilding product at all.

## Sudowrite's Story Bible — the closest thing to propagation in commercial software, and why it still is not one

**Maps to** propagation, evidence, accept and reject (C2, C3, C5, C6)

Sudowrite's Story Bible is a structured container per novel-writing project: braindump, synopsis, characters, worldbuilding cards, outline, scenes. A worldbuilding card is one entity (a location, a faction, a magic system rule) with a title and body text, generated by clicking "Generate," which proposes AI text the writer can accept as-is, click "Rewrite" to redirect, or hand-edit; there is no batch or per-field accept/reject control, each card is its own small negotiation with the model. The propagation-shaped part: a Series Folder shares one Story Bible across every book in a series, so editing a worldbuilding card (Sudowrite's own blog example is "civil war shatters the alliance") makes every future generation in every book in that series read the updated card. Nothing drafts the downstream consequence automatically; the writer has to remember which scenes in which books now contradict the card and fix them by hand.

**Evidence** https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/worldbuilding/uc5NfWSz4x8Wm3S19LZeo8 (Sudowrite's own documentation, confirmed opened by the researching agent's transcript, describing the Generate/Rewrite/edit flow per worldbuilding card) and https://sudowrite.com/blog/how-to-write-fantasy-series-ai/ (Sudowrite's own blog, describing series-wide Story Bible sharing)

**Take** series-wide sharing of one canonical fact store, read by every downstream generation, is the right substrate for propagation to sit on top of; it is the part of our own architecture Sudowrite already has half of.

**Leave** the other half never shipped: no drafted list of what a changed card touches, no diff, no queue, and once a card is accepted the AI origin is gone, nothing marks it, which answers our own research question directly. If the product closest to propagation in the entire category still requires the writer to manually notice every downstream implication, nobody in this category has built guardrail 1's "here is what else that touches, drafted and waiting."

## NovelAI's Lorebook and AI Dungeon's World Info — context injection is not canon editing

**Maps to** why propagation is hard, and what the copilot is not (C3)

Both are the same mechanic under different names: an entry (title, one or more trigger keywords, body text) that gets inserted into the model's context window when its keyword appears in the recent story text, to keep the AI's next output consistent with established facts. NovelAI's own docs describe placement controls (insertion order, token budget, a trim direction for what gets cut if an entry does not fit) and a "Lore Generator" that proposes entry text on request, saved directly with no accept/reject modal. AI Dungeon splits World Info between a Scenario (the reusable template) and an Adventure (the played session): starting to play copies the scenario's World Info into the adventure once, and after that copy the two drift independently. Editing the scenario does not update adventures already started from it, and editing an adventure's World Info does not write back to the scenario.

**Evidence** https://docs.novelai.net/en/text/lorebook/ (NovelAI's own documentation, confirmed opened, describing keyword activation, placement and token-budget controls, and the Lore Generator's save-with-no-review flow)

**Take** nothing to adopt; this pairing is useful mainly as a boundary marker. It shows precisely what a copilot looks like when it only ever reads canon to inform generation and never writes structured proposals back into it, which is the negative space our C2 inbox and C3 propagation plan fill.

**Leave** the scenario-to-adventure one-way copy is the sharpest illustration available of why "the same fact living in two places" without a propagation mechanism rots: World Info entries fork the moment play starts and nothing reconciles them again, ever.

## Mem, Reflect, and Saga — the AI-wiki graveyard that never made the AI useful

**Maps to** propagation, accept and reject, evidence (C2, C3, C5, C6)

All three raised money on some version of "AI organizes your notes so you don't have to," and none of them ships anything resembling propagation. Mem auto-tags notes (person, org, topic) and surfaces a "Related Notes" panel by semantic similarity, reactively, with no accept/reject on a tag and no way to see why a note was surfaced. Reflect pivoted in July 2026 to an open-source, local-first, markdown-only tool with an MCP server that lets an external coding agent (Claude Code, Cursor) read and edit notes directly; its own blog describes longform "improvement suggestions" a user can individually approve or reject, but MCP-driven edits from an agent apply directly with no per-edit approval step at all, and nothing distinguishes AI-written text after either path completes. Saga auto-hyperlinks a page name the moment it is typed and offers "Live Blocks," a reusable block a user can opt into syncing across pages, with a per-block accept/reject on the sync suggestion only, not on any AI-generated content, and its AI assistant answers questions about mentioned pages with a free-form synthesis that cites nothing.

**Evidence** https://reflect.app/blog/edit-notes-with-coding-agents (Reflect's own blog, confirmed opened, describing the MCP read/edit workflow with no per-edit approval, alongside the separate longform-suggestion approval flow)

**Take** Saga's opt-in sync-suggestion accept/reject on a duplicated block is the one genuinely reusable idea here: it is a narrow, honest version of "I noticed a duplicate, want me to link these," offered as a choice rather than an automatic action.

**Leave** everything else. None of the three shows evidence for a suggestion, none marks AI text as AI after acceptance, and none proposes an update to a second entity when a first one changes; three funded products spent years on "AI wiki" and every one of them stopped at reactive surfacing, which is the strongest evidence available that propagation with per-change accept and evidence is not an obvious next feature anybody else was one release away from shipping.

## Fantasia Archive, Notebook.ai, Chronicler, and Archivist — the free and the offline tier

**Maps to** export and lock-in (F4)

Fantasia Archive is a free, open-source (GPL-3.0) offline desktop app (Vue 3 and Electron) with no signup and no cloud: a hierarchical document tree with two-way backlinks and importable "blueprint" templates, entirely local, last released in 2021 and effectively dormant since. Notebook.ai is still live, free up to five universes with form-based entity creation (Characters, Locations and Items free; Creatures, Religions, Organizations and Languages behind a $9/month Premium tier), unlimited collaborators with full read/write access and no conflict resolution on simultaneous edits. Chronicler is a separate, currently-maintained free offline markdown wiki (Rust and Tauri, 16,000-plus installs) that is deliberately Obsidian-compatible: `[[wikilinks]]` with automatic backlinks, YAML frontmatter as an infobox, and spoiler syntax (`||hidden||`) for session-table secrecy without a server. Archivist is a 2025-founded, still-active TTRPG "campaign memory" product distinct from the same-named worldbuilding tools of the 2010s: it ingests a session transcript (via Discord, Foundry, or Obsidian integration) and generates a recap, quest log, and cast analysis after the fact, one direction only, session to summary, never summary back into canon.

**Evidence** https://github.com/vishiri/fantasia-archive-v1 (Fantasia Archive's own repository, confirmed opened, showing the GPL-3.0 license, Vue/Electron stack and last-release date) and https://chronicler.pro/what-is-chronicler (Chronicler's own site, confirmed opened, describing the wikilink, YAML-infobox and spoiler-block feature set)

**Take** Chronicler's Obsidian-compatible plain files are the strongest small-scale proof that "your data is markdown on disk, always exportable" and "still has wikilinks, backlinks and infoboxes" are not in tension; it is close to what F4's flat zip should be able to open into.

**Leave** Archivist's one-directional recap is worth naming precisely because it looks adjacent to propagation and is not: it summarizes what happened, it never proposes what an entry should now say, and nothing it produces waits for a per-entry accept the way ours does.

## Does anyone do propagation

No. Across every product surveyed here, including the two (Sudowrite, Kanka) that came closest, nothing changes one piece of canon and drafts what else that touches for a human to accept per item. Kanka propagates a rename into mention display text automatically, which is real but is string substitution, not a canon update. Sudowrite's Story Bible propagates a changed worldbuilding card into what future generations *read*, but drafts nothing and proposes no downstream edits; the writer notices contradictions by rereading. World Anvil and Realm Works both let one secret or topic back several articles, which means one edit changes what several pages *show*, but again nothing drafts a corresponding edit anywhere else. Saga's Live Blocks sync is the nearest thing to a per-item accept on a propagated change, and it only ever propagates a literally duplicated block, never an inferred consequence. Every AI-labelled product in the survey (Sudowrite, NovelAI, AI Dungeon, Mem, Reflect, Saga, Notion AI) either has no accept/reject at all, or has one that applies to a single generation in isolation with no concept of a second entity being affected. None of them shows evidence per suggestion beyond Notion Q&A's source links, and none of them keeps AI-authored text visually marked once a human has accepted it; Sudowrite and Notion AI both confirmed this in their own documentation, and it held for every other product where an accept step exists at all. This is not an oversight anyone is one release away from fixing: three separately funded "AI wiki" products (Mem, Reflect, Saga) spent years iterating on note organization and every one of them stopped short of drafting a cross-entity update, which is the strongest evidence that the gap is structurally hard rather than merely unbuilt.

## Onboarding: signup to something useful

World Anvil takes roughly four to five steps and two to three minutes to a first article: email and username, a role pick (Writer, GM, Player, Worldbuilder), naming the world, then a "Get Started" checklist that gamifies creating an article, a timeline and a map with a badge on completion (`worldanvil.com/learn/interface/create-account`). Kanka is faster, three to four steps and one to two minutes: email, social login, or nothing at all, since registering auto-creates a first campaign with a skippable preset that renames the player role and seeds example content (`docs.kanka.io/en/latest/getting-started.html`, `blog.kanka.io/2025/12/08/version-3-6-onboarding-new-users/`). LegendKeeper's own 14-day trial needs no card, and its "LegendKeeper 101" guide walks straight from account creation into dragging a page from the directory onto a map to auto-link it, no separate onboarding gate (`legendkeeper.com/legendkeeper-101-the-basics-beyond`). Notebook.ai and Campfire both ask for an email and drop the GM straight into a free-tier universe or project with capped elements, no wizard. D&D Beyond asks for nothing beyond a campaign name and player emails, two to three clicks to a usable if entity-less notes page. Obsidian asks for nothing at all: pick a folder, that is the vault, and every plugin is a separate install decision made later, which trades a zero-friction start for a setup tax paid entirely by the GM in research and configuration, none of it product-guided. What every one of them asks for first is a name, either the world's or the account's; none of them asks a GM to bring existing material on day one the way our own import-first path (D7) does, and none of them earns "something useful" faster than Kanka's auto-seeded campaign, which is the bar D7's pre-indexed fallback path has to clear.

## What I would build from this

- Ship LegendKeeper's export sentence, not just the export feature. G10 is still deciding where our F4 sentence lives; LegendKeeper puts theirs on the pricing page itself, unprompted, which is the strongest evidence in this file that saying it out loud costs nothing and buys trust.
- Treat World Anvil's embed-not-attach secret as the model for E7's gap page: a reader without access should see an entry that reads as complete without the missing part, never a locked placeholder, the same way an unauthorized reader of a World Anvil secret sees a paragraph that simply was never written.
- Hold C5's evidence bar above Notion Q&A's: "always cites its sources" with a source-page link is real but weaker than our own sentence-level evidence requirement, and it is worth stating that difference in our own docs since Notion is the AI product most GMs will already have used.
- Guarantee mention-name propagation on rename the way Kanka does, for free, with no review step, before C3's real propagation plan runs on top of it; string substitution is not canon change and does not need an accept.
- Use D&D Beyond and Notion-as-DIY-baseline as the honest comparison point for D7 onboarding: import-first has to visibly beat "paste everything into one text block" or "wire six databases by hand" inside the first ten minutes, not eventually.
- Treat Sudowrite's Series Folder (one shared fact store, read by every downstream generation) as partial validation of our own architecture, and its missing half (no drafted downstream edits, no marking after acceptance) as the exact gap C2 and C6 exist to close.
- Do not build a dedicated AI hue, ever, on the strength of nothing in this category doing it either; the closest analogue, World Anvil's tab-heavy density, was walked back by its own team, which is a second independent argument for restraint alongside our own P1 decision.
- Match Saga's one honest idea, opt-in accept/reject on a detected duplicate, as a narrow pattern worth a line in C7's reject-reasons vocabulary: "already covered elsewhere" as a first-class reject reason, not just free text.

## Anti-references

- **Realm Works** shut down with an unadvertised, badly-placed export menu, and the community had to write its own converters after the fact. Its ghost is the entire reason F4 ships flat markdown export on day one, unhidden; do not let ours end up needing a `github.com/farling42`-style rescue tool.
- **Fandom** publishes every edit the instant it is saved, with no review gate and no distinction between reviewed canon and a drive-by change, funded by ad density most GMs would never choose for their own table. It is the clearest available picture of what guardrail 6 is written to prevent.
- **Notion AI's Writer** accepts a generated paragraph into a page and immediately forgets it was ever AI-written: no mark, no history entry, nothing distinguishing it from human prose a year later. If we ever loosened C1's "stays tracked afterwards," this is exactly what we would become.
- **World Anvil's 28-template, tab-per-facet Character sheet** is the density trap A1 and G2 were written against, and tellingly the company's own blog has twice apologized for it and shipped simplifications; a competitor's self-correction is still a correction worth reading before we make the same mistake ourselves.
