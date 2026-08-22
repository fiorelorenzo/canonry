# References: table mode and players

This file covers table mode end to end: the mode switch itself (E1), progressive freshness with no spinner (E2), the two-tier quick-action dock (E3), the phone layout (E4), the reveal flow and session log (E5, G7, G8), secrets authored inline in a public entry (E6), and the players' wiki at `/p/<slug>` (E7, V7). The honest state of ours today: table mode has shipped `stream: 0 events received` next to an empty state naming an action with no control (#470), the dock used to cover the content underneath it until T11 made the shell reserve its height, and the players' index published the name of every entry, revealed or not, until V7 corrected it to list only what was revealed. Nothing here is academic. Every mechanic below is either a live defect or a shape we have not built at all yet.

## Foundry VTT: journal permission tiers plus a manual "Show Players" push

**Maps to** the reveal flow and G7 (live for what the GM taps, the log for everything else), and the secrets block (E6)

Every Journal Entry in Foundry carries one of four permission levels per user: None, Limited, Observer, Owner. None of that is what makes content reach a player's screen mid-session, though. A GM clicks "Show Players" from the entry's header menu, picks all players or specific ones, and the entry (or, in multipage view, a single page) is pushed to the front of the chosen players' screens immediately, independent of their stored permission level. Permission decides what a player could eventually open on their own; "Show Players" decides what appears on their screen right now, without changing the underlying grant. Separately, inside a Journal Entry's rich text, a GM can mark any paragraph "Secret," and that block renders only to the GM until a "reveal" toggle exposes it to players currently viewing the page.

**Evidence** https://foundryvtt.com/article/journal/ ("Journal entries and their pages may be shown to specific players, or all players... Once you have selected the players to show, clicking the button Show Players will confirm and display that page for the players you selected, bringing it to the forefront of their screen." Also: "Foundry VTT adds a custom formatting called Secret to text entries which will only be visible to the GM or Owner of the Journal Entry... Secret text blocks can be toggled as visible to players by clicking the 'reveal' button.")

**Take** the exact split G7 already chose: a push action (what the GM taps) is a distinct, instant act from a stored permission or a batched log entry. Foundry proves the push doesn't need to touch the underlying grant to work, which is the model for our reveal action: tapping "reveal" on an entry or a secret block should be a live broadcast to players currently in table mode, separate from whatever gets written to the session log at table-break. The inline Secret paragraph, toggled per block rather than per page, is exactly E6's "inline block typed in place."

**Leave** Foundry has no preview of what the secret looks like to a player before you toggle it, and no distinction between "shown once" and "now permanently visible": once revealed, a secret block stays revealed with no undo and no record of when. E6 asks for a preview and E5 asks for a session log; Foundry gives us neither, so we build both on top of its push mechanic rather than copying it whole.

## World Anvil: secrets as a reusable block, gated by subscriber group

**Maps to** secrets authored inline (E6)

A World Anvil "Secret" is a piece of text that can be embedded inside any article and independently marked public, private, or private-to-specific-subscriber-groups. Subscriber groups are named cohorts the GM defines (one per party, one per player, whatever the campaign needs); a secret's visibility is a checkbox against that list rather than a single public/private toggle. Because a secret is a reusable object rather than inline-only prose, the same secret can be dropped into multiple articles without being rewritten, and an "open secrets" world setting lets co-GMs see everything regardless of subscriber group, separately from what players see.

**Evidence** https://www.worldanvil.com/w/WorldAnvilCodex/a/subscribers ("The Subscribers feature allows you to make private content visible to specific people... You can have as many groups of subscribers as you want, which means you can give different secrets to different groups of subscribers.") and, corroborated via World Anvil's own knowledge base excerpt on the secrets feature: "Secrets are a way to hide snippets of information from your readers in articles... A secret can be added to multiple articles" (worldanvil.com/learn/secrets/secrets; the page blocked a direct fetch with HTTP 403, so this line is [INFERENCE] from the search engine's cached quotation of that exact URL, not a page I rendered myself).

**Take** the subscriber-group model is more machinery than a one-GM, one-table product needs, but the core idea (a secret is content, not a page state, and it can gate on more than a binary) is worth keeping in the data model even if Canonry's UI only ever shows "GM only" versus "revealed to the table." The reusability (one secret block referenced from two entries) is a real idea worth a note for later: if a hidden fact belongs to both a person entry and a place entry, writing it once and referencing it twice avoids the two copies drifting apart.

**Leave** World Anvil's secrets require a genuinely separate authoring surface (a secrets sub-panel keyed by ID) from the article's own prose, which is precisely the two-place authoring E6 rejects in favor of typing the secret inline where it lives. We take the concept, not the UI.

## LegendKeeper: an inline secret block inside a page players otherwise see

**Maps to** secrets authored inline (E6), the players' collaboration surface generally

LegendKeeper's pitch for its secrets feature is explicitly about mixed pages: a GM writes a public wiki article and drops GM-only paragraphs into the middle of it, so the same page a player opens shows the public prose and silently omits the hidden blocks. The company's own collaboration page states the mechanic as "hide specific wiki pages, map pins, or individual blocks of text within an otherwise public article," which is page-level, pin-level, and block-level in one system rather than three different features.

**Evidence** https://www.legendkeeper.com/features-collaboration/ ("Thanks to the secrets feature, you'll be able to keep any information you don't want your players to know (such as story twists and turns) hidden from them, ensuring that they don't accidentally spoil the surprise... It's easy to share your Legendkeeper projects with your players, simply by sharing a link with them to the pages you want them to have access to.")

**Take** this is the strongest confirmation that E6's chosen shape (one entry, inline GM-only blocks, no separate secrets database) is the right one for a solo-GM tool. The same page renders two ways depending on who's reading; the block, not the page, is the unit of hiding.

**Leave** LegendKeeper's marketing copy never shows what happens if a player's browser tab still has the page open when a secret is later revealed mid-session; there's no described live-push mechanic, only "share a link." That gap is exactly what G7's live/log split has to cover and LegendKeeper apparently doesn't: we need the inline block to also be pushable, not just link-shareable.

## Elgato Stream Deck: folders as the canonical two-tier physical dock

**Maps to** the two-tier quick-action dock (E3)

A Stream Deck's base layout is one grid of buttons. A "folder" button opens a second grid in place, temporarily replacing the first, and closes back to the top level either by pressing a dedicated back button or via an idle timeout. Folders can nest, but Elgato's own guidance and the wider community converge on the same limit: "nesting too deeply slows you down. Two levels is usually enough for a live workflow." A Multi Action (several actions fired from one button press) can live inside a folder but cannot itself contain another Multi Action, which keeps the depth of "what happens when I press this" bounded to two hops even when a single button is doing several things.

**Evidence** https://www.elgato.com/us/en/explorer/products/stream-deck/how-to-use-folders-stream-deck/ ("A folder is an action that opens into another set of keys. When you press it, your Stream Deck temporarily switches to that folder layout... Press the back arrow to return to your main layout, or let Stream Deck exit automatically after a set time... You can create unlimited subfolders within folders," with the practical guidance elsewhere on Elgato's own site capping useful depth at two levels for live use).

**Take** E3's two-tier dock should hard-stop at two: tier one is the handful of actions a GM reaches for constantly at the table (create an NPC here, mark revealed, set the mood), tier two is a "more" tile that opens a second grid and returns automatically after a tap or a timeout, never a third grid. The folder's own auto-return-after-idle behavior is worth copying literally: a GM who opens tier two and then gets pulled back into the scene shouldn't have to remember to back out.

**Leave** Stream Deck folders are keyed to physical buttons with no room for scrolling or search, which works because a deck owner curates a small fixed set ahead of time. Table mode's dock needs at least one item (search, "who is this") that is inherently query-based rather than a fixed tile, so the second tier can't be a pure folder grid; it needs one slot reserved for a live search field, which Stream Deck's model doesn't have an answer for.

## Apple's Controls (Control Center, Lock Screen, Action button): the platform's own two-tier grid

**Maps to** the two-tier quick-action dock (E3), the phone layout (E4)

Apple's Human Interface Guidelines added a dedicated "Controls" page for iOS 18, formalizing a control as either a button (fires an action, possibly launching the app) or a toggle (flips a boolean), placeable in Control Center, the Lock Screen, or bound to the hardware Action button. The guidance is specific about the one-handed constraint: because some placements show only an icon, with no room for a value label, "make sure that your controls feature distinctive symbols," and every control needs a `displayName` specific to what it does plus a configuration-time description. Control Center itself in iOS 18 became a home-screen-style grid (an 8-by-4 arrangement of open slots) with a default "favorites" screen plus additional screens for grouped controls (media, home, connectivity) reached by a swipe, which is the platform's own two-tier structure: the always-visible favorites screen, and named secondary screens one gesture away.

**Evidence** https://developer.apple.com/design/human-interface-guidelines/controls (the page's own description: "A control provides quick access to a feature of your app from Control Center, the Lock Screen, or the Action button.")

**Take** two ideas worth taking directly: every dock tile needs a name specific to what it does, not a bare glyph, which the guardrails already require via `aria-label` and tooltip; and the platform's own solution to "more actions than fit" is not a longer list but named, swipeable groups, which supports E3's tier-two-as-a-named-group design over a scrolling list.

**Leave** Apple's controls are configured once, in Settings, by a user who isn't under time pressure when they arrange their grid. A GM building an NPC mid-scene has no equivalent quiet moment to curate a favorites screen; table mode's tier one has to ship with a sensible default ordering (created-this-session actions and revealed-related actions ranked first) rather than assuming the GM pre-configured anything, which is where E3 has to diverge from the platform pattern.

## Kanka: visibility levels plus "view campaign as member"

**Maps to** the players' wiki (E7, V7), and G7's live/log split

Kanka's entities each carry a visibility setting (All, Admins, Only me, Only me & Admins, or "Members of the campaign") which is a coarser, faster control than a full permission matrix and is explicitly aimed at the case that matters here: "useful for a public campaign where members of it should see more than a public viewer." Permission chaining then propagates that setting through relations: if an entity is visible to everyone but the entity it relates to is admin-only, the relation itself doesn't leak the hidden entity's existence. Separately, a GM can click "View campaign as member" from either the campaign's member list or an individual entry's permissions tab, which redirects the GM into the campaign rendered exactly as that specific non-admin user would see it, changes are logged as impersonation, and a one-click "back to my user" restores the GM's own view.

**Evidence** https://docs.kanka.io/en/latest/advanced/visibility.html ("Members of the campaign: Only members of the campaign will see the element. Useful for a public campaign where members of it should see more than a public viewer... if a relation is visible to all, but the relation's target is only visible to admins, then only admins will see the relation.") and https://docs.kanka.io/en/latest/guides/testing-permissions.html ("As a campaign admin, you can view your campaign as one of your non-admin members... This reveals the View campaign as member option. Clicking on it will redirect you to the campaign's dashboard as the user.")

**Take** two things worth building. First, permission chaining is the right behavior for V7: a relation, a mention, or a fact pointing at an unrevealed entry must not leak that entry's existence through the back door even if the pointing content is itself public; this generalizes the gap-page principle (E7) beyond the index page to every surface that can name an entry. Second, "view as member" is exactly the verification tool a GM needs before trusting the players' wiki: a one-click, logged, reversible way to see `/p/<slug>` exactly as the party would, catching a V7-style leak before a player ever does.

**Leave** Kanka's five-level visibility list is more granularity than one binary (revealed / not revealed) needs for Canonry, and the "Only me" tier (hidden even from co-admins) has no Canonry equivalent since there's one GM per world. We take the propagation rule and the preview-as-member tool, not the full visibility taxonomy.

## Obsidian Publish: a zero-configuration public site gated by one frontmatter flag, with no way to hide a single field

**Maps to** the players' wiki (E7, V7)

Obsidian Publish selects which notes go live from a single `publish: true/false` frontmatter flag (or folder-level include/exclude rules), and there is no separate publishing dashboard to configure per page, which is the "zero configuration" model E7 and V7 need: a note either carries the flag or it doesn't, and unflagged notes are unreachable, not merely unlisted. Where the model breaks down is field-level: Obsidian Publish cannot selectively hide individual frontmatter properties on a published note, so a page can be public-with-a-flag while still carrying whatever metadata was on it, and the only documented workarounds are CSS to visually hide fields (a cosmetic patch, not a data boundary) or a custom `publish.js` on paid custom domains.

**Evidence** https://obsidian.md/help/publish/setup, corroborated by the platform documentation on how notes are selected for publishing: "Files are selected for publishing based on frontmatter publish: true/false flag (highest priority), excluded/included folders" (quoted from Obsidian's own publish tooling documentation, npmjs.com/package/obsidian-headless, which packages the same selection logic Obsidian Publish itself uses) and the community forum threads confirming there is still no way to publish only some properties of a note as of this writing (forum.obsidian.md/t/obisidian-properties-in-obsidian-publish/79737: "There is no ability to publish obsidian properties in obsidian publish").

**Take** the binary flag-gates-existence model is exactly right for `/p/<slug>`: an entry is either revealed (and its route resolves) or it isn't (and the route is a gap page), with nothing in between and nothing to configure per page. That is the zero-configuration promise V7 and E7 are describing.

**Leave** the field-level gap is a warning, not a pattern to copy: if Canonry ever renders any GM-authored metadata alongside a revealed entry (a fact table, a status badge, an internal tag), that metadata needs the same reveal gate as the prose, checked at read time, not hidden with a stylesheet. Obsidian Publish's CSS workaround is a defect dressed as a feature and we should never reach for it.

## Vercel's SWR: stale-while-revalidate as a named, documented pattern

**Maps to** progressive arrival with a quiet marker (E2)

SWR's entire model is the shape E2 asks for: return cached data immediately, then revalidate in the background and reconcile the view when fresh data lands, with three named triggers for the background refetch (refocus, a polling interval, and network reconnect) each independently toggleable, and a `useSWRImmutable` escape hatch for data that never needs revalidating at all. Nothing in the documented API surface is a loading spinner tied to the refetch; the stale value stays on screen the whole time, and the UI only changes when new data actually arrives.

**Evidence** https://swr.vercel.app/docs/revalidation ("When you re-focus a page or switch between tabs, SWR automatically revalidates data... refetching will only happen if the component associated with the hook is on screen"; and on the immutable escape hatch: "The revalidateIfStale controls if SWR should revalidate when it mounts and there is stale data.")

**Take** the naming discipline is worth taking as-is: table mode's "quiet marker" needs the same three triggers (regained focus after the GM tabs away, a background poll while table mode is open, reconnect after a dropped connection) rather than one undifferentiated "refresh," and needs its own equivalent of `revalidateIfStale` false for anything that legitimately never goes stale mid-session (a locked session log entry, for instance).

**Leave** SWR's model assumes the client already has something to show (a cache hit) before revalidating; it has no opinion on what to render on a genuine first load with nothing cached, which table mode does have to handle (a GM opening table mode for the first time on a new device). E2's under-100ms promise is a claim about graph reads with warm data, not about a cold cache, and SWR's docs don't cover that case because it isn't SWR's problem to solve.

## Instagram (Threads) engineering: responsive components with no request left waiting for feedback

**Maps to** progressive arrival with a quiet marker (E2)

Instagram's own engineering blog post on building Threads describes three techniques aimed at the same goal E2 wants for table mode: never let an interaction feel like it's waiting on a network round trip. Buttons respond physically the instant they're touched (a scale transform plus light haptic feedback), independent of whatever the tap eventually triggers; a custom `UICollectionViewFlowLayout` lets list cells stretch under a finger during a scroll gesture rather than the whole list moving as one static block; and theme changes propagate through an "appearance binding" system that reconfigures each already-mounted view in place via `NSNotificationCenter`, with no view ever being torn down and reloaded to pick up a new theme.

**Evidence** https://about.instagram.com/blog/engineering/on-building-a-fluid-user-interface ("The response should feel physical. A button should depress as you touch down, and elevate as you release... Through a process called appearance binding, this system handles theme updates in realtime, allowing us to reconfigure individual views in the app without reloading each view.")

**Take** the "reconfigure in place, never reload" principle is the right target for table mode's quiet marker: when fresh graph data lands, the affected rows update their values directly rather than the list re-rendering or flashing a loading state, exactly what "progressive arrival with a quiet marker" is asking for. The immediate-touch-response principle also matters for the two-tier dock: a tile press should register instantly (scale or highlight) before whatever it triggers resolves, so the dock never reads as unresponsive even if the underlying action takes a beat.

**Leave** Instagram's scale-and-haptic button response and elastic scroll are motion-heavy by design, aimed at a consumer social app. Table mode's own motion rule is narrower (state changes and controls only, never a canon reading surface, honoring reduced motion); we take the responsiveness principle, not the bounce.

## Apple's Human Interface Guidelines for CarPlay: glanceable, three levels deep, one-handed by construction

**Maps to** the phone layout with bottom tabs (E4)

CarPlay's guidance is written for the extreme version of the constraint E4 is solving in miniature: a driver who can spare a glance, not a study session. The rules are concrete: limit content hierarchy to three levels or fewer even though the system permits five, place the most important content and controls in the upper (here: thumb-reachable) portion of the screen, keep titles and subtitles short enough to scan peripherally, and lean on imagery over text wherever an image communicates identity faster than a label does.

**Evidence** https://developer.apple.com/design/human-interface-guidelines/technologies/carplay/introduction ("Keep titles and subtitles short so they can be scanned quickly and peripherally... Limit your content hierarchy to three levels or fewer. The less navigation required to reach content, the better... Place the most important content/controls in the upper half of the screen.")

**Take** "three levels or fewer, even though five is technically allowed" is a hard number worth adopting for the phone layout directly: bottom tabs (level one), a tab's list (level two), an item's detail (level three), full stop, no drill-down past that at a lit table in ten seconds. The thumb-zone rule also argues for where the two-tier dock's launcher sits on the phone: bottom, within the same reach zone as the tab bar, not floating wherever the desktop layout happened to put it.

**Leave** CarPlay optimizes for a driver who cannot touch the screen precisely while looking at the road and leans on voice and large hit targets accordingly; table mode's phone layout is touch-first with the reader looking directly at the screen, so CarPlay's largest-target, voice-first affordances don't transfer, only the depth and placement rules do.

## OBS Studio: Program/Preview Studio Mode as a background-edit, foreground-push split

**Maps to** propagation running silently in the background (G8), and the live/log split (G7)

Studio Mode splits the interface into two panes: Preview, where the operator edits a scene, and Program, what the audience currently sees. Nothing done in Preview reaches viewers until the operator clicks Transition (or a hotkey-bound quick transition), which swaps the two; until that click, "viewers cannot see when Studio Mode is enabled or not." The distinction OBS draws is specifically about layout and composition, not content already live inside a source: a video feed inside a source keeps playing in real time in both panes regardless of which one is "live."

**Evidence** https://github.com/obsproject/obs-studio/wiki/OBS-Studio-Overview ("Activating Studio Mode allows you to change your Scenes in the background without your viewers being able to see you making those changes... After you are done editing the Scene you can click on 'Transition'... Viewers cannot see when Studio Mode is enabled or not.")

**Take** this is the clean mental model for G8: proposal generation is Preview (it keeps running, keeps composing, in full view of nobody but the GM's own inbox count) and the only thing that ever "transitions" to the players is what the reveal flow explicitly pushes. The count riding out silently on the way out of table mode is the equivalent of the audience seeing the new Program only at the moment of Transition, never mid-edit.

**Leave** OBS's two panes are two views of the same operator's own attention; nothing in Studio Mode addresses a second audience (the players) watching a completely different, deliberately impoverished view the way table mode has to. We take the "never signal an in-progress background change" discipline, not the two-pane UI.

## Keynote: a presenter display that is instantly a different view than the audience's, on one keystroke

**Maps to** G7 (live for what the GM taps, the log for everything else), and the "switch" a GM-facing tool needs for separating its own view from the shared one

Keynote's Rehearse Slideshow mode brings up a presenter display carrying the current slide, the next slide, presenter notes, and elapsed time, entirely separate from whatever the audience-facing display shows; pressing X toggles between the presenter display and the current slide on the presenter's own screen, and Option-X picks which physical display gets which view. Presenter notes are editable live, in place, without leaving the rehearsal flow, and the whole presenter-only surface can be customized (auto-layout, font size, inverted colors) without any of that customization touching what the audience sees.

**Evidence** https://support.apple.com/guide/keynote/rehearse-on-your-mac-tan1cb6ca7a3/mac ("The presenter display appears. To switch between the presenter display and the current slide, press X on the keyboard... If you have an external display connected to your Mac, press Option-X on the keyboard to choose which display to rehearse on.")

**Take** the single-keystroke, always-available toggle between "my own working view" and "what the audience sees" is the right shape for a GM-facing switch inside table mode: whatever the equivalent of X is for us (a segmented control, per O4's pattern of a binary state getting a segmented control) needs to be one control, always visible, never buried in a settings menu, exactly like Keynote never hides X behind a menu click.

**Leave** Keynote's presenter display and the audience display run on two physically different screens by design; table mode's GM and player views run on two different devices too, but through the network rather than a second monitor cable, so the "which physical display" question (Option-X) doesn't transfer; our equivalent question is which device receives the push, not which port it's plugged into.

## Syrinscape: crossfade as the default transition between ambient layers

**Maps to** audio and ambient layer controls with crossfade and a GM-chosen mood

Syrinscape's SoundSet model layers many short samples that are individually, continuously randomized in timing and stereo position rather than looping a fixed mixed track, specifically so the ambience never repeats identically. A "Mood" is a saved combination of elements from potentially several SoundSets; starting a mood eases each newly-started element's volume up to its target level rather than snapping it in, and where crossfade is enabled between samples within an element, "the end of one sample will be faded out while the beginning of the next sample is faded in," with the crossfade duration automatically capped at half the shorter sample's length so it can never overrun.

**Evidence** https://syrinscape.com/about-syrinscape/ ("It does this by using powerful algorithms to distribute samples randomly in time and in the surround sound environment... Each individual sound separately controlled by the app, automatically randomised and positioned"); the crossfade-timing detail is drawn from Syrinscape's own in-app SoundSet Creator documentation served at app.syrinscape.com, which states: "When crossfade is enabled, the end of one sample will be faded out while the beginning of the next sample is faded in... reduced to half the shorter sample duration, if necessary."

**Take** two mechanics worth building as-is: new elements ease in to target volume rather than snapping (borrow this for any layer a GM adds mid-mood), and a crossfade duration that auto-caps against the shorter of the two clips involved, so a GM never has to hand-tune a transition time that could exceed either sample. "GM picks the mood, the product handles the transition" is exactly the right split of responsibility for our own mood control.

**Leave** Syrinscape's randomized-sample-distribution engine is a substantial audio product in its own right (its own mixing algorithm, its own content library, its own creator tool); Canonry's ambient layer control almost certainly should be a thinner control surface over a small preset library rather than attempting Syrinscape's generative layer, which is not a UX question but a scope one.

## Archive of Our Own: an explicit opt-out from warning, instead of a forced binary

**Maps to** secrets as a spoiler affordance inside otherwise public text (E6)

AO3 requires every posted work to carry one of a short fixed list of warnings, but rather than forcing every author to either warn precisely or warn not at all, it offers "Choose Not To Use Archive Warnings" as an explicit, first-class option distinct from "No Archive Warnings Apply." The two read identically to a naive glance but mean opposite things: one says nothing in this list applies, the other says the author is deliberately declining to say either way, including specifically "if you want to avoid some spoilers, but not others."

**Evidence** https://archiveofourown.org/help/tags_warnings ("Choose Not To Use Archive Warnings: Use this if you don't want to warn for anything. You may also choose this option if you don't know what you should warn for; if you don't like warning for certain topics or warnings in general; if you want to avoid some spoilers, but not others; etc.")

**Take** the idea worth taking is the three-state model, not a two-state one: for a secret block, "no preview needed" (this text is mechanically inert, doesn't matter if a player glimpses it) is a different, equally valid GM choice from "here is exactly what a player sees instead," and both are different from simply hiding the block with no explanation at all. E6's preview toggle should support all three rather than collapsing "preview" and "no preview" into a binary the way a lesser design would.

**Leave** AO3's warning system exists because the platform is legally and reputationally exposed to unwarned graphic content reaching an unwilling reader at web scale; nothing about Canonry's stakes resembles that, so the specific fixed vocabulary (violence, character death, and so on) has no equivalent here. We take the three-state shape, not the taxonomy.

## What I would build from this

- Cap the quick-action dock at two tiers, hard: tier one is a short, sensibly pre-ordered set of common actions (create an NPC here, mark revealed, set the mood), tier two is one named "more" surface that auto-returns after a tap or an idle timeout, reserving one slot in tier two for the live "who is this" search field rather than trying to fit search into a fixed grid tile, from Stream Deck's folder depth limit and Apple's Controls grouping.
- Make the reveal action a genuine live push, separate from the session log: tapping reveal broadcasts to players currently in table mode immediately, and the session log is a batched, confirmed-after-the-table-breaks record of the same actions, not the mechanism that delivers them, from Foundry's "Show Players" push distinct from stored permission, and Keynote's single-keystroke switch between the GM's own view and the shared one.
- Author secrets as one inline block type in the entry editor with a three-state preview control (no preview needed / preview shown / hidden with no player-facing text at all), styled and toggled in place rather than in a separate secrets panel, from LegendKeeper and World Anvil's inline-block model plus AO3's three-state warning choice.
- Treat table mode's progressive freshness exactly like SWR: an instant render from whatever's cached, three named background triggers (refocus, poll, reconnect) for revalidation, and the update lands by reconfiguring the affected row in place rather than a reload or a spinner, from SWR's documented API and Instagram's "reconfigure in place, never reload" appearance-binding pattern.
- Model G8's silent background propagation as OBS's Program/Preview split: proposal generation is Preview, composing continuously with nobody watching; only the outgoing badge count is ever "transitioned" into what the GM notices, and nothing about an in-progress plan is ever signaled to the inbox mid-generation.
- Give the players' wiki index the same propagation-through-relations rule Kanka enforces: an entry's own visibility gates its own page and every mention, relation, and fact that would otherwise name it, so a public entry can never leak the existence of an unrevealed one through a back door.
- Ship a GM-side "preview as player" mode for `/p/<slug>`, logged and one click to enter and exit, the same shape as Kanka's "view campaign as member": the only reliable way to catch a V7-style leak before a player does.
- Bound the phone layout's navigation depth at three levels (tabs, list, detail) and put the dock launcher in the same thumb-reachable zone as the tab bar, following CarPlay's glanceability limits even though our medium is touch rather than voice.
- Give ambient layer changes an automatic crossfade capped at half the shorter clip's length, with newly-added layers easing to target volume rather than snapping in, following Syrinscape's default transition behavior, so a GM choosing a mood never has to also tune a fade.

## Anti-references

- **Roll20's handout permissions** require two disconnected steps before content reaches a player: first grant per-player view permission on the handout, then separately click "Show to Players," and if nobody has view permission yet the tool has to interrupt with a dialog asking whether to grant it to everyone. A reveal action that requires configuring a permission before it can push anything is exactly the friction G7 and E5 are trying to keep out of a live session; ours has to be one action, not a permission setup followed by a broadcast.
- **Notion's "Publish to web"** lets a page become public because it inherited its parent page's sharing state, not because anyone made a deliberate decision about that specific page (Notion's own help documentation states a new subpage "will take on the permissions of its parent page" by default) and in production this has caused pages nobody meant to expose to leak publicly, including, per independent security reporting, the editor's own name, email, and photo embedded in the page's block data. A players' wiki that can go public by inheritance rather than by an explicit reveal is the opposite of V7's "only what was revealed," and is precisely the failure mode E7's gap page exists to prevent.
- **Wikipedia's spoiler policy** is a deliberate, well-reasoned refusal to build any spoiler-hiding mechanism at all: "It is not acceptable to add 'spoiler warning' notices or to delete information from (or hide it within) an article because you think it spoils the plot," on the grounds that an encyclopedia's job is completeness, not managing a reader's experience of surprise. That is the correct call for an encyclopedia and the wrong one for us; Canonry's whole premise is that a party's experience of discovery is the product, so a wiki that refuses on principle to distinguish "known" from "not yet known" is a model to name and reject, not to borrow from, when the players' index and the gap page get designed.
