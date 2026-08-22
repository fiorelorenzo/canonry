# References: landing door and first hour

This file covers the landing page at `canonry.io` and the propagation demo that is its hero (F6, G10), the app's own door page at `/` for a signed-out visitor (I1), the auth screens as a title page with an optional argument pane (I2), import-first onboarding measured to first accepted proposal (D7), the one empty-state component with three variants (I8), the docs pages inside the app, and the call to action now moving from a waiting list to sign-up now that the product is live (M1). None of this is a green field: SPEC and DECISIONS.md already settled the shape of most of these screens, and guardrail 7 already forbids the one sentence every product in this cluster is tempted to write, that a canon here will hold together. Every reference below earns its place by showing a mechanic we can build, not a mood board.

## Observable Framework — reactive dataflow as the demo without a video

**Maps to** the propagation demo (F6)

Observable Framework's page model runs like a spreadsheet: a JavaScript block that references a variable defined elsewhere reruns automatically, in the order its dependencies resolve, the instant that variable changes, and only the blocks downstream of the change recompute, not the whole page. The docs demonstrate this live, on the page itself, with a radio input and a range slider whose movement updates every block that reads them, in the browser, with no export step and no recording. It is a real, working "change one thing, see what else it touches" demo staged entirely in markup and script.

**Evidence** https://observablehq.com/framework/reactivity ("code re-runs automatically when referenced variables change"; "only the code blocks that are downstream of changed variables run"; demonstrated live on the page with radio and range inputs)

**Take** The dataflow language is our vocabulary for the hero: a small set of scripted cells (one canon entry, a relation, an inferred fact) wired so that editing the entry cell reruns only the cells downstream of it, staged live rather than pre-rendered into a video. "Only downstream cells rerun" is the same honest proof guardrail 3 already asks for: a change reaching exactly the entries it touches, not a blanket refresh.

**Leave** Observable's reactivity is unscoped, any cell can depend on any other, and nothing about it marks an AI-authored change apart from a deterministic recompute. Our hero still needs guardrail 2's shape, dashed underline and a margin marker, on the propagated text even inside a scripted demo, or the demo teaches a visitor the wrong lesson about what a proposal actually looks like.

## Excalidraw — the wall sits at persistence, not at use

**Maps to** the landing hero (F6) and the sign-up call to action (M1)

Excalidraw's own app is its landing page: excalidraw.com opens straight into the canvas, with no signup anywhere in the drawing flow. A visitor draws immediately, and the scene autosaves to the browser's localStorage and IndexedDB, no account and no server round trip for a solo session. The wall appears only where Excalidraw's own docs are candid the free path genuinely cannot help: cross-device sync, version history, or a cache that gets cleared, at which point the guidance is to export a `.excalidraw` file or pay for more.

**Evidence** https://plus.excalidraw.com/how-to-start ("Excalidraw is free to use and no account is needed. Just visit excalidraw.com and start drawing"; drawing stored locally, end-to-end encrypted only when shared); https://excalidraw-excalidraw.mintlify.app/guides/storage (localStorage and IndexedDB persistence; export to a `.excalidraw` file)

**Take** The wall belongs at the moment of real consequence, wanting sync or history, not at the moment of first use. That is M1's own reasoning: let a stranger do the real thing first, and ask for an account only when they want something the free path cannot give them.

**Leave** Excalidraw's persistence is honestly fragile, the docs say outright that a cleared cache with nothing exported means lost work. Canonry's demo can borrow the no-signup shape without the risk, since the demo is a fixed, shipped scenario with nothing of a stranger's own to lose.

## Photopea — the case for no landing page at all

**Maps to** F6 (the demo as the hero, no copy above it), pushed to its limit

Photopea has no marketing site separate from the product. Visiting photopea.com opens the full editor directly: no hero section, no feature list, no form above or below it. Photopea's own explanation of this, written for schools rather than for users generally, states plainly that it works immediately, asks for no account, and never sends a file anywhere; it keeps working offline once loaded. The closest thing to a pitch anywhere on the site is one sentence about student data privacy, on a page most visitors never see.

**Evidence** https://www.photopea.com/schools/ ("Photopea.com can be used right after opening the website, without making any accounts... it works immediately after you open the website"; "Photopea runs completely in your device. No file ever leaves your computer")

**Take** F6 already chose no copy above the demo, and Photopea is proof that the instinct to add a reassuring sentence above the fold is almost always wrong when the product itself is the argument. It is a useful check on our own hero: if a sentence above the demo would not survive being deleted, delete it.

**Leave** Photopea has no lock-in question to answer, a raster edit has nowhere else to be locked into, so it says nothing about G10. Our demo is a scripted five-minute story, not the whole product, so unlike Photopea's front door we still need the one sentence under it answering what a visitor cannot yet see for themselves.

## Figma Community — interact freely, own it after signing in

**Maps to** M1 (a door, not a waiting list) and I1 (the wall a signed-out visitor meets)

Every file in Figma's Community has a resource page where a visitor can view and interact with the file's preview or prototype exactly as they would any embedded prototype, no account required. The account requirement sits at a specific, later verb: duplicating the file into your own drafts. Duplicating strips version history, comments, and permissions from the original, so signing in buys ownership of a working copy, not merely a look.

**Evidence** https://help.figma.com/hc/en-us/articles/360038510873-Duplicate-Community-files ("You need a Figma account to duplicate Community files"; every file has "a resource page where you can view file information and preview the file or prototype," which visitors can "interact with... like you would any regular embed")

**Take** Free to look and interact, an account only to keep a copy, is the right boundary between the marketing-site demo and the app's door page. A stranger runs the propagation demo and reads a published players' wiki with no account; only "make this yours," sign up, create a universe, asks for one. That is M1's own answer now that the waiting list has something real behind it.

**Leave** Figma's wall is silent: nothing on that resource page explains why duplicate needs an account. I1's "links a visitor is owed" and guardrail 7's honesty standard both ask for more than a gate with no sentence beside it.

## Metabase — the sample database as the onboarding fallback

**Maps to** D7 (import first, with the pre-indexed universe path as the fallback)

Metabase's setup wizard collects an admin account, then asks for database details, but "I'll add my data later" is a first-class button, not a buried escape hatch, and choosing it drops the new user straight into a Sample Database shipped inside every install. That database has four real tables (Orders, People, Products, Reviews) wired into the same dashboards and query builder a live connection would use, and Metabase's own tutorials lean on it as the default teaching data throughout. Deleting it is reversible from an admin panel.

**Evidence** https://www.metabase.com/docs/latest/configuring-metabase/setting-up-metabase ("if you'd like to deal with all of this later, that's okay: just click I'll add my data later. Metabase comes with a Sample Database that you can play around with to get a feel for how Metabase works"); https://www.metabase.com/glossary/sample-database (four named tables; "you'll see the Sample Database used in examples all over Learn")

**Take** The pre-indexed universe fallback D7 already names needs exactly this: a real button beside "import," not a smaller link under it, built from the same entry types, relations, and propagation the copilot uses on a GM's own world, since that is what makes the fallback teach the real product rather than a toy.

**Leave** Metabase's sample data is disposable and generic; nobody minds that "Orders" means nothing to them. A GM exploring the pre-indexed universe is meant to feel the propagation loop on a world worth reading, so ours has to be a genuinely well-written setting, not four blank tables with fantasy names on them.

## Linear — import once, or sync forever, and never a dead end for having nothing to import

**Maps to** D7 (import first)

Linear separates a one-time import from Jira from an ongoing Jira Sync that keeps two tools current during a slow migration. The import runs through an in-product wizard rather than a bare CLI because it "offers a CSV import option and imports more fields," and the docs are candid about what does not survive: creation and modification dates never carry over, and Linear recommends importing only open issues so the new workspace stays usable rather than importing an entire backlog. Sync is framed explicitly for a team "not ready to fully switch over yet," the case of someone with real data elsewhere and no appetite to migrate it all today.

**Evidence** https://linear.app/docs/jira ("Jira Sync connects your Jira spaces to Linear teams... It's designed for teams that aren't ready to fully switch over yet"; "we recommend importing Jira projects through the in-product importer instead of the CLI, which also offers a CSV import option but imports more fields"; "creation and modification dates on issues will not carry over")

**Take** Naming exactly what an import will not carry over, on the same screen that starts it, is the honesty guardrail 5 and D2's estimate screen both already ask for, and Linear's wording is worth following closely in our own per-source guides. The sync-versus-import split also answers a real case D7 does not cover on its own: a GM whose world lives somewhere they are not ready to leave yet.

**Leave** Linear's import has no equivalent of D6's batched matching question or D3's four-bucket dry run, because two Jira tickets are never ambiguously "the same issue" the way two fantasy characters can be. This reference is good for the onboarding entry point and the honesty about loss, not for the review mechanics after.

## Shopify Polaris — one empty state, three real jobs

**Maps to** I8 (one component, three variants: cold start, settled, derived absence)

Polaris's own composition guide names exactly three situations for an empty state: onboarding a merchant to create their first item in a collection, a search or filter that returns nothing, and prompting activation of a feature not yet turned on. Every example pairs a short illustration, a heading naming the missing thing, one sentence of explanation, and a primary action button carrying a verb ("Create puzzle," not "Get started"). The guidance insists the subtitle explain what is actually missing rather than a platitude, and that a button be predictable, a merchant should know what will happen before clicking it.

**Evidence** https://shopify.dev/docs/api/app-home/patterns/compositions/empty-state ("Onboarding merchants to create their first item in a collection," "Guiding merchants when search or filters return no results," "Prompting feature activation or configuration" as the three named use cases; example copy: "Start creating puzzles" / "Create and manage your collection of puzzles for players to enjoy." / "Create puzzle")

**Take** Polaris's three use cases map closely onto I8's three variants: cold start is their onboarding case, derived absence is close to their no-results case (a filter, or a derived universe's base corpus, turning up nothing), and settled sits where their feature-activation case does, a legitimately empty screen that still works. One component, one heading-plus-sentence-plus-verb-button shape, three copy sets, is the right scope for I8's nine screens.

**Leave** Polaris's empty state is decoration-first, a stylized illustration above the text in every example. The reading room's "no floating cards" rule and guardrail 2 both push against decoration for its own sake; ours should earn its space with the sentence and the action, an illustration only where a derived-absence case genuinely benefits from showing the shape of the gap, not as a default.

## Atlassian's Forge EmptyState — one required field, three ranked actions

**Maps to** I8 (one component, three variants)

Forge's `EmptyState` component has exactly one required prop, `header`; description, a spinner, and three action slots are all optional and additive. The action slots are explicitly ranked: primary recommends the best next step, secondary offers an alternative, and tertiary is reserved for a link to documentation, rendered below the first two rather than beside them. Accessibility is written into the spec itself: the heading defaults to `h4` but must be overridden if the empty state does not follow an `h3` in reading order, because a skipped heading level breaks screen-reader navigation.

**Evidence** https://developer.atlassian.com/platform/forge/ui-kit/components/empty-state/ ("The only required property of an empty state is the header"; primary, secondary, and tertiary action props, tertiary described as linking "to external resources or documentation"; `headingLevel` "Defaults to 4," with the accessible-order rule stated beside it)

**Take** A header-only floor, with description and actions layered on only where a variant needs them, is the right minimum for I8's own component. Cold start, settled, and derived absence do not need the same number of slots filled, and forcing all nine screens through an identical four-part template is exactly the sprawl I8 was written to end. The tertiary-links-to-docs slot is also a clean hook for pointing a derived-absence screen, an empty relation panel, say, at Canonry's own in-app docs page for that mechanic.

**Leave** Forge's component has no concept of an AI-generated absence versus a genuinely empty one; it is a generic admin-UI primitive with no opinion about provenance. Guardrail 3 means our derived-absence variant has to say more than Forge's header-plus-description would: which entry was checked, and why nothing turned up, not just that nothing did.

## GitHub's new-repository quickstart — the empty state that hands you the exact command

**Maps to** I8 (cold start) and D7 (import first, generalized to "bring something in")

A brand-new GitHub repository's quickstart runs two parallel paths, the web UI (toggle "Add README" on, click Create) and the CLI (`gh repo create`, then the literal `git add`, `commit`, `push` sequence printed inline), and both end at the same place: a repository that already holds something, a README, rather than a truly blank page. The guide frames the README as the first real content a repository needs, so the empty-state action is never "create an empty thing," it is always "create a thing with a first real artifact already inside it."

**Evidence** https://docs.github.com/en/repositories/creating-and-managing-repositories/quickstart-for-repositories ("Toggle Add README to On"; the CLI path prints the exact `git add README.md && git commit -m "Add README"` sequence to run; "README files are a great place to describe your project in more detail")

**Take** Cold start's primary action should behave the same way: not open a blank editor, but hand the GM the exact next step, start an import, or open the pre-indexed universe, with no intermediate decision required, the way GitHub's quickstart prints the literal command rather than describing it in prose.

**Leave** GitHub's two parallel paths, web click-through and CLI, have no analogue here, there is no command-line Canonry. The reusable idea is narrower than the whole pattern: an empty state's primary action should produce a first real artifact, not an empty shell waiting for one.

## Standard Notes — the lock-in sentence, said three ways

**Maps to** G10 (one sentence below the demo, plus a docs page) and M1 (a door, not a waiting list)

Standard Notes's homepage carries a "Try live demo" link beside its download button, letting a stranger use the product before creating an account, the same move M1 asks Canonry's landing page to make now that a working product exists to point at. Underneath, the export argument is stated three separate times in three registers: a plain declarative sentence ("you'll always have an offline copy of your data"), a numbers-first version on the company page ("100% Revenue from paying users, $0 In venture capital, 10 years In service"), and a mechanism-first version on the features page ("Export all notes as plaintext or encrypted JSON. Your data is always portable and never locked in").

**Evidence** https://standardnotes.com/ ("Try live demo" beside "Download for free"; "Your notes and files, always... You'll always have an offline copy of your data"; "100% Revenue from paying users / $0 In venture capital / 10 years In service")

**Take** The numbers-first register is the sharpest of the three, because it is falsifiable rather than a mood. G10's own sentence under the demo should carry a real number if it has one (a format, a day-one guarantee tied to SPEC's markdown export) rather than an adjective like "portable."

**Leave** Three registers for one claim, spread across a landing page, a features page, and a company page, is more repetition than G10 budgeted: one sentence below the demo, plus one docs page. Standard Notes can afford that redundancy because export is its entire pitch; ours is one guardrail among seven, and repeating it everywhere would crowd out the propagation demo F6 made the actual hero.

## Obsidian — the vault is a folder, said as plainly as that

**Maps to** G10 (the lock-in answer, one sentence plus a docs page)

Obsidian's help article on data storage opens with the plainest possible sentence: notes are Markdown files in a vault, and a vault is a folder on the local file system, "including any subfolders." It never reaches for "your data belongs to you"; it says what a vault is made of and where it lives, then documents where the app's own settings and caches live separately, so a reader can tell their content apart from the app's bookkeeping. The whole page reads as documentation of a fact, not an argument for a feature.

**Evidence** https://obsidian.md/help/data-storage ("Obsidian stores your notes as Markdown-formatted plain text files in a vault. A vault is a folder on your local file system, including any subfolders"; "Because notes are plain text files, you can use other text editors and file managers to edit and manage notes")

**Take** This is the register G10's sentence should borrow: state the mechanism, not the virtue. "Every entry is a markdown file in a zip you can open with anything" says more than "portable" or "open" ever would. F4's flat, unadvertised export zip already has the mechanism; G10's sentence just has to say it this plainly.

**Leave** Obsidian's vault is the entire product, nothing else exists to protect. Canonry's export is one guardrail among seven behind a copilot doing most of the actual work, so one plain sentence has to carry more (implicitly standing in for guardrail 4's promise too) than Obsidian's file-format sentence ever has to.

## Intercom — articles read inside the product, never a separate site

**Maps to** the in-app docs pages (per-source import guides, the languages page, the lock-in answer's own page)

Intercom's Help Center lets a visitor search for and open articles from directly inside the Messenger, without leaving the host app or starting a support conversation; selecting an article opens it inline in the panel the user is already looking at. Intercom's own docs are explicit that the reverse is deliberately unsupported, embedding Help Center articles onto a separate website is not possible, because the whole design keeps a reader inside one surface rather than sending them to a marketing-style help site.

**Evidence** https://www.intercom.com/help/en/articles/56640-articles-and-your-help-center-explained ("Your users or visitors can search for and view articles right inside your Messenger without having to start a conversation... they won't need to leave your app or website to find the help they need"; "It is not currently possible to embed your Help Center articles onto your own website, as access is restricted to Intercom only")

**Take** That deliberate one-way constraint, docs live inside the product surface rather than exported elsewhere, is exactly what D1's per-source guides and G10's docs page need: the seven import playbooks and the lock-in answer's own page belong inside `/docs` in the app shell, sharing its nav and its language switch, not on a marketing subsite with its own header.

**Leave** Intercom's articles are written for a support conversation an AI agent might also answer from, tuned for search and retrieval rather than for a reader working through steps in order. Canonry's per-source guides are closer to a runbook (detect, confirm, map, resolve conflicts) than a searchable FAQ, so the five-heading template from Notion's importer (what imports, what doesn't, how it maps, limitations, troubleshoot) is the better shape for the guide's content; Intercom's contribution here is about where the guide lives, not how it reads.

## 37signals — one rule per sentence, no hedging, no filler

**Maps to** guardrail 7 (never promise consistency) and G10 (honest copy)

37signals's internal writing guide is not marketing copy, it is the company's own rulebook for how it communicates, but the register is the one its product pages use too: short declarative sentences, one claim each, written to be read once and understood rather than to persuade. "Writing solidifies, chat dissolves." "If your words can be perceived in different ways, they'll be understood in the way which does the most harm." Thirty numbered rules, none longer than two sentences, none hedged with a qualifier.

**Evidence** https://37signals.com/how-we-communicate/ ("Writing solidifies, chat dissolves. Substantial decisions start and end with an exchange of complete thoughts, not one-line-at-a-time jousts"; "If your words can be perceived in different ways, they'll be understood in the way which does the most harm")

**Take** That second rule is the argument for guardrail 7 in one sentence: a hedge like "helps keep your canon consistent" gets read as a promise, not a hedge, so the honest version has to say the narrower true thing outright, shows you what does not add up, rather than trust a reader to supply the caveat. Every sentence on the door page, in the empty states, and in the docs pages should survive being read the way it does the most harm.

**Leave** 37signals writes for employees who already trust the company; a stranger reading Canonry's door page for the first time has no such trust yet, so our sentences need more context per claim (what a proposal is, what accept means) than an internal memo would, even while keeping the same one-claim-per-sentence discipline.

## What I would build from this

- Stage the propagation demo as a real dataflow, Observable's shape: a handful of scripted cells (entry text, a relation, a derived fact) wired so editing one reruns only its downstream cells live in the browser, no video, with F6's dashed-underline-plus-margin-marker treatment intact on every propagated cell.
- Let a stranger interact with the demo and read a published players' wiki with zero signup, the way Figma lets a Community visitor open and interact with a file's preview; put the account wall only at "make this yours," sign up, create a universe, matching M1's own reasoning now that the product is live. Give the auth screens' optional right pane (I2) a distilled version of the same argument, in Standard Notes's numbers-first register, since that is the moment someone is actually deciding.
- Give the pre-indexed universe fallback (D7) the same first-class weight Metabase gives its Sample Database: a real button beside "import," not a smaller link under it, built from a genuinely well-written setting rather than placeholder content.
- Write G10's one sentence in Obsidian's register, mechanism first, adjective-free ("every entry is a markdown file in a zip you can open with anything"), and let the docs page behind it carry the kind of number Standard Notes proves reads better than a mood.
- Build I8's component on Forge's minimum shape, one required header, optional description, three ranked action slots, so cold start, settled, and derived absence each fill only the slots they need rather than sharing one identical four-part template.
- Split I8's three variants along Polaris's three named use cases, cold start to their onboarding case, settled to their feature-activation case, derived absence to their no-results case, keeping the heading-plus-sentence-plus-verb-button shape without a decorative illustration by default.
- Route the seven per-source import guides and G10's own lock-in page through `/docs` inside the app shell, sharing its nav and language switch the way Intercom's articles stay inside the Messenger, while keeping Notion's five-heading template for the guide's own structure.
- Name what an import will not carry over on the same screen that starts it, the way Linear's Jira docs state plainly that creation dates never survive the trip, and offer a lightweight path for a GM who is not ready to leave their existing tool, mirroring Linear's Jira Sync framing.
- Hold every sentence on the door page, in the empty states, and in the docs pages to 37signals's own test: read it the way it does the most harm, and if that reading promises a coherent canon, guardrail 7 says rewrite it.

## Anti-references

- Figma's account wall for duplicating a Community file is silent, nothing on the resource page explains why signing in is required. https://help.figma.com/hc/en-us/articles/360038510873-Duplicate-Community-files I1's "links a visitor is owed" and guardrail 7's honesty standard both ask for more than a gate with no sentence beside it.
- Airtable's template gallery requires an account before a visitor can even use a template's structure, "Use template" sits behind login for every template in the gallery. https://support.airtable.com/articles/3008352242-using-airtable-templates This is the opposite of M1's instinct to let a stranger use something real before asking for anything.
- Standard Notes repeats its export claim across three separate pages in three registers, landing, features, and company. https://standardnotes.com/ G10 budgeted one sentence below the demo plus one docs page; repeating the claim everywhere would crowd out F6's demo as the actual hero of the page.
