# Product references, surface by surface

`DECISIONS.md` records what we chose. This file records **what already exists elsewhere**, per
surface, so that the next round of design starts from a shape somebody has already shipped and
debugged rather than from a blank artifact. Seventeen rounds of decisions were taken by looking at
our own preview and disliking things, which works and has a blind spot: it can only ever improve
what is already there. A reference set is the other input.

Eleven files under [`references/`](references/), one per cluster of surfaces. Each one is a list of
named mechanics from real products, with the URL I opened to check the claim, what we should take,
and what does not survive our guardrails. Nothing here is a decision. Where a reference argues
against something on record, the file says so and the decision stands until it is changed in
`DECISIONS.md`.

## The rules the set was written under

- **A claim about another product carries a URL that was actually opened.** 201 distinct sources
  across the eleven files, 192 of which answer 200 to an anonymous request; the nine that do not
  are Fandom, Shopify Help, World Anvil and two GitHub raw pages behind bot protection or rate
  limits, plus two Adobe Help pages that need a real browser, and each was read through the browser
  tool or is marked `[INFERENCE]` against a named weaker source.
- **Mechanics, not vibes.** A reference is a named behaviour with numbers where numbers exist:
  Atlassian's 50-150ms interaction band, Turbo's 500ms progress delay, Butterick's 45 to 90
  characters, Spotify's 1 to 12 second crossfade, Stream Deck's two-tier folder depth.
- **Anti-references are first class.** Every file ends with two to four products that get the
  surface wrong, so a bad idea has a written reason for staying dead.

## The eleven files

| File | Surfaces | Strongest reference |
| --- | --- | --- |
| [01 shell, navigation and search](references/01-shell-navigation-and-search.md) | App shell, sidebar, palette, entries table, settings shell, empty states, progress and pending | Linear's capped sidebar with the palette as overflow; Turbo Drive's delayed progress bar |
| [02 entry page and editor](references/02-entry-page-and-editor.md) | Entry read view, aside, cover, mention previews, markdown editor, history | HackMD's `![](image =30%x)` width syntax, which is R9's convention already shipping somewhere |
| [03 proposal review loop](references/03-proposal-review-loop.md) | Inbox as queue, plan, diff, evidence, accept and reject, reject reasons | Google Docs suggesting mode, GitHub's viewed checkbox, and a CSCW paper on when explanations help |
| [04 import and onboarding](references/04-import-and-onboarding.md) | Source selection, estimate, dry run, conflicts, matching, batch review | Terraform's `Plan: N to add, M to change` and Sanity's dry-run-by-default CLI |
| [05 ask dock and conversation](references/05-ask-dock-and-conversation.md) | The dock, the conversation, streaming, citations, the Ask page | Consensus's confidence floor and Anthropic's sentence-level `cited_text` |
| [06 table mode and players](references/06-table-mode-and-players.md) | Table mode, quick actions, freshness, reveals, secrets, players' wiki | Foundry VTT's permission tier plus a separate "Show Players" push |
| [07 money, trust and admin](references/07-money-trust-and-admin.md) | Credit meter, paid-action confirmation, privacy sentence, export, admin metrics | Vercel's spend setting, OpenAI's alert-versus-hard-limit split, Notion AI's plain sentences |
| [08 category and competitors](references/08-category-and-competitors.md) | The whole product against what a GM already pays for | World Anvil's embed-not-attach secret; LegendKeeper's unprompted export promise |
| [09 images, styles and audio](references/09-images-styles-and-audio.md) | Generation, style catalogue, media gallery, cover, ratios, ambient audio | Recraft's style library, WordPress's attachment model, Syrinscape's Elements and Moods |
| [10 type, density and motion](references/10-type-density-and-motion.md) | Type tokens, measure, density, dark mode, motion, key hints | IBM Carbon's duration system and Apple's Reduce Motion technique list |
| [11 landing, door and first hour](references/11-landing-door-and-first-hour.md) | Landing demo, door page, auth argument, onboarding, empty states, docs | Observable's reactive dataflow as a demo; Figma Community's wall at "make it yours" |

## What the whole set says, across the files

**Nobody in this category does propagation.** File 08 checked it product by product rather than
assuming it: World Anvil, Kanka, LegendKeeper, Obsidian's plugin stack, Campfire, D&D Beyond,
Notion AI, Sudowrite, NovelAI and the AI-wiki cohort. The closest anything gets is Sudowrite's
Story Bible series folder, one shared fact store that every downstream generation reads, and it
still never drafts an edit to an existing page and waits. Kanka does guarantee mention integrity
across a rename, which is worth having and is string substitution rather than canon change. So the
product's central claim is intact, and the thing to copy from the category is not a mechanic, it is
LegendKeeper's habit of stating its export promise on its own pricing page unprompted.

**Bulk accept is the industry default, everywhere, including in the products we admire.** Google
Docs puts `Accept all` with a live count next to an otherwise excellent one-at-a-time reviewer,
Cursor binds accept-every-change to a single key, Notion AI replaces a whole block with no diff,
HubSpot pre-selects one side of a merge, Mailchimp has one global duplicate toggle for an entire
import. Guardrail 1 is therefore a real cost we are paying on purpose, and the reference set gives
it two supports: Sanity's CLI, where you type `--no-dry-run` to actually write, proves the ordering
can live in the API and not only in the UI, and the Buçinca, Malaya and Gajos CSCW 2021 result is
the argument for forcing evidence open only on weak candidates rather than on everything.

**Our weakest surface, measured against its own references, is Ask's citations.** Consensus refuses
to render a verdict below a source floor, Anthropic's Citations API returns the literal `cited_text`
sentence, Elicit and Scite both make sentence-level grounding the product claim. Our own-canon layer
takes its top six by lexical overlap with no threshold at all, which is the exact failure Google AI
Overviews is criticised for. Guardrail 3 is written for proposals and has never been applied to
answers.

**Marking by shape rather than by hue is what the references do too.** Word's Simple Markup puts a
single change bar in the margin and nothing in the text, iA Writer's syntax decoration is reversible
and never rewrites the paragraph, Primer's `KeybindingHint` and shadcn's `Kbd` both treat the glyph
as decoration with the accessible name elsewhere. Nothing in the category paints AI output its own
colour. U10 deleted our AI hue after three rounds of rejecting it; the reference set says that was
the industry position all along.

**Permission-aware reading is somebody else's solved problem and we should copy the vocabulary.**
Notion labels a backlink the reader cannot open as `Private` rather than hiding the row, Glean
filters retrieval by what the asking account may read before ranking rather than after, Kanka
propagates an entity's visibility to every mention and relation that would otherwise name it,
Foundry keeps the permission grant and the live push to players as two separate mechanisms. Those
four cover guardrail 6 across the mention preview, the Ask retrieval, the players' index and the
reveal flow respectively.

**Several of our numbers can stop being guesses.** 140ms and 200ms sit inside Atlassian's published
interaction and transition bands and Carbon's moderate tier. 44rem sits inside Butterick's 45 to 90
characters. A route progress bar should wait 500ms before it appears, which is Turbo's own
threshold. A two-tier dock is two tiers because Stream Deck's own documentation says two levels is
usually enough for a live workflow. An ambient crossfade caps at half the shorter clip, which is
Syrinscape's default.

**Two places where we are already ahead of the reference.** The palette classifies a typed question
automatically; Notion parks the same thing behind a "search with AI" link and Raycast behind a Tab
press, and both are regressions from what we ship. And our empty-state component's settled variant
carries a recovery action, which shadcn's own `Empty` composition does not.

## The shortlist I would take from this

Ranked by what changes a GM's experience most, each naming the file it comes from. These are
candidates for a round eighteen, not decisions.

1. **Put a confidence floor under Ask's sources** and quote the literal sentence rather than the
   entry name. Below the floor the honest answer is "nothing in this world supports that". (05,
   Consensus and Anthropic Citations. Touches #354 and #355's neighbourhood.)
2. **Give the proposal inbox GitHub's viewed-checkbox economy**: settled rows collapse rather than
   disappear, a progress count that is three-way rather than a fraction, and the `j k a r u` hints
   on the row itself, since both GitHub and Reviewable show a `?` overlay goes unread. (03)
3. **State the import plan as Terraform states it**, one summary line of counts above the four
   buckets, and make the internal API dry-run-first the way Sanity's CLI is, so guardrail 1's
   ordering cannot be reversed by mistake in our own code. (04)
4. **Make the field conflict symmetric the way VS Code's merge editor is**: identical width, font
   and action row on both sides, nothing pre-selected, plus a base-value toggle showing what the
   field said at the last import. (04)
5. **Split the spend confirmation in two** on OpenAI's model: the price on the button for every
   generation, and a running-total notice at a threshold, never a second dialog. That is where G11
   stops being a per-click question. (07)
6. **Hold `MentionPreview.svelte` to WCAG 1.4.13** (Escape dismisses, hoverable, persistent) and
   borrow Notion's `Private` label for a target the reader may not see, in the aside's relation
   rows too. (02)
7. **Give the media gallery WordPress's attachment discipline**: one row per file, the cover pointer
   and the body reference both resolving to it, delete checking both before it is permitted. (09)
8. **Add Recraft's "Test it" step to the custom image style** so a GM sees one preview against their
   own prompt modifier before it becomes the world's only style. (09)
9. **Ship the reveal as a live push distinct from the session log**, Foundry's split, and add a
   GM-side "preview as player" mode for `/p/<slug>`, Kanka's "view campaign as member", which is the
   only reliable way to catch a V7-style leak before a player does. (06)
10. **Stage the landing demo as a real dataflow**, Observable's shape, and put the account wall at
    "make this yours" rather than at "look at this", Figma Community's line. (11)
11. **Write the lock-in sentence in Obsidian's register**, mechanism first and adjective-free, and
    keep it to G10's one sentence plus one docs page rather than Standard Notes's three. (11, 08)
12. **Defend the motion and type numbers in the token comments** with Atlassian, Carbon, Apple and
    Butterick, so the next round argues with a source rather than with taste. (10)

## What this set deliberately does not do

It does not choose. Four of the twelve above touch a decision on record (C5, C6, D3, G11), and
changing one of those means editing `DECISIONS.md` and saying so on the issues it blocks,
which is the same rule as always. It also does not
collect screenshots of other people's products into this repository: the URL is the evidence, and a
page that has changed since it was read is a page worth reading again.
