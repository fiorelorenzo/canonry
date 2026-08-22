# References: Ask dock and conversation

This file covers the copilot's front door (the floating pill and the panel it expands into, gated by A3, C8, O3, R5, R6, S8, S9, S10, S11, T7 to T11) and the Ask page it now feeds (U11, P4, P5). The honest state today: the dock is a docked palette input wearing a chat's job, the panel is a fixed 352px box that throws its conversation away on navigation, every turn ends in a two-button keep card, and the retrieval layer takes its top six sentences by lexical overlap with no floor, so a weak match reads on screen exactly like a strong one.

## Consensus — a confidence floor before the meter fires at all

**Maps to** the Ask page's source panel and the dock's per-turn footer (guardrail 3, the citation honesty problem)

Consensus is an academic search engine that shows a yes/no/mixed verdict, the "Consensus Meter," built from the top papers it retrieves for a claim-shaped question. The meter only renders once at least five relevant papers clear its relevance bar; the corner of the widget shows exactly how many papers contributed, and if the classifier isn't confident enough about which way a result leans, no prediction is forced at all. Its own limitations section says outright that the meter is not a complete picture of the science, only of what cleared the bar.

**Evidence** https://help.consensus.app/en/articles/10069920-the-consensus-meter (the Consensus Meter help article: the 5-paper minimum to display, the contributing-paper count shown on the widget, and the explicit statement that a low-confidence classification is withheld rather than forced)

**Take** put a real floor under the six-sentence source list: if the top matches don't clear a similarity threshold, or there simply aren't enough of them, the footer should say there is nothing supporting, not lay out six weak lexical matches dressed identically to six strong ones. Show the count the way Consensus shows its paper count, so a reader can tell "six of six cleared the bar" from "two scraped by."

**Leave** the meter's aggregated yes/no/mixed verdict is itself a claim about consensus, and guardrail 7 forbids exactly that framing when it comes to canon coherence. We can take the threshold discipline without ever rendering a verdict.

## shadcn/ui chat components — the scroller and turn vocabulary our own control layer ships

**Maps to** the dock panel and the Ask page turn layout (T7, T8, T9, T10, T11)

In June 2026 shadcn/ui, the component library Canonry's shadcn-svelte layer already tracks, shipped `MessageScroller`, `Message`, `Bubble`, `Attachment`, and `Marker` as a first phase of chat primitives. `MessageScroller` auto-scrolls to the bottom while a reply streams in, but only while the reader is already at the bottom; the moment they scroll up to reread something, auto-scroll backs off and a small "jump to newest" button appears instead of yanking them back down. The scroller's content region ships `role="log"` and `aria-relevant="additions"` by default, so a screen reader announces new text as it streams without extra wiring.

**Evidence** https://ui.shadcn.com/docs/changelog/2026-06-chat-components (the changelog post describing `MessageScroller`'s auto-scroll opt-out, turn anchoring, the jump-to-newest button, and the default `role="log"` / `aria-relevant="additions"` on the content region)

**Take** adopt the auto-scroll-with-opt-out behavior and the jump-to-newest affordance for the panel's own scrollback, and mirror the `role="log"` pattern so T7's streaming bar is announced the same way without a spinner or a label doing the work. The naming (`Message`, not "bubble," reserved for the surface) is close enough to our own three-part turn that porting the concept costs little.

**Leave** the demo's `Bubble` component is a rounded, backgrounded chat bubble, which is precisely the floating-card-on-paper shape our reading room refuses. Our turn is a heading, prose, and a footer under a rule (T9), never a colored box.

## Anthropic Citations — grounding an answer in the literal sentence, not the document

**Maps to** the source footer under every turn (T9, guardrail 3)

Anthropic's Citations API chunks a submitted document into sentences (or developer-defined blocks) and every claim in Claude's answer carries a pointer to the exact extracted text it drew from, returned as `cited_text` in the response, not a document-level "this file was consulted" flag. Anthropic's own evaluation reports this beating prompt-based citation approaches on recall because the model is constrained to quote what it actually read rather than describe it from memory.

**Evidence** https://platform.claude.com/docs/en/build-with-claude/citations (the Citations docs: automatic sentence-level chunking of plain-text and PDF documents, the `cited_text` field returned per citation, and the claim that built-in citations beat prompted approaches on precision)

**Take** our source footer should carry the retrieved sentence itself, quoted, not a bare "Entry X was used" pointer. Guardrail 3 says "which entry, which sentence," and Claude's `cited_text` is the literal shape of that requirement already built and shipping.

**Leave** Citations is a per-document API flag a developer sets and a paid model capability; our retrieval pipeline is in-house Postgres and Qdrant lexical overlap. The sentence-chunking step is the piece we are missing, not a UI widget to copy.

## Perplexity — numbered inline citations, and an engineering warning about faking them

**Maps to** the streaming answer's footer and T7's streaming bar

Perplexity's Agent API streams search results and content chunks separately over server-sent events: search results arrive as their own events carrying `id`, `title`, and `url`, and the model inserts numbered markers like `[1]` and `[2]` into the streaming text that resolve against that `id` space once matched up. Perplexity's own cookbook carries an explicit warning for implementers: a response can trigger more than one round of search, and if a client only keeps the first batch of results, most of the later `[N]` references in the text will not resolve, "and citations will look hallucinated."

**Evidence** https://docs.perplexity.ai/docs/cookbook/articles/streaming-citations/README (the Streaming Citation Parsing cookbook: the separate `search_results` and `output_text.delta` event types, the numbered-marker convention, and the warning about unresolved references looking hallucinated if a client drops earlier search batches)

**Take** the numbered-marker-to-source-id convention is worth borrowing verbatim for the footer under a streamed answer: attach a stable id to each retrieved entry the moment it is chosen, stream the answer, and only resolve `[N]` to a real footer chip once the id set is complete, so a fast reader never sees a dangling number.

**Leave** Perplexity's own product has been reported, in secondary reviews rather than in anything Perplexity states about itself, to present citations with the same visual confidence regardless of how weak the underlying match was. [INFERENCE, from a third-party review rather than a Perplexity statement: https://konabayev.com/blog/perplexity-ai-review/, "Perplexity cites sources with a confidence that is frequently unwarranted."] That is the exact failure our own six-sentence, no-threshold footer risks, which is why Consensus's threshold above is the piece to take instead.

## Elicit — sentence-level citations as the whole product, not a feature

**Maps to** the source footer, and the Ask page's honesty about weak retrieval

Elicit is a research tool built entirely around the claim that every AI-generated statement it produces is backed by a citation naming the exact sentence, in the exact paper, that supports it, described on its own site as the difference that separates it from general-purpose chat tools. It advertises this as its core differentiator over broader AI assistants, not an add-on: "transparency" sits beside "scale" and "accuracy" as one of the three pillars the product is sold on.

**Evidence** https://elicit.com/ (the homepage's "How we're different" section: "Elicit supports all AI-generated claims with sentence-level citations from the underlying sources," listed as a top-level differentiator alongside scale and accuracy)

**Take** treat sentence-level grounding as a product-level commitment stated in our own copy, not an implementation detail: if the Ask page or the dock ever answers a question the retrieval layer could not actually support at the sentence level, that gap belongs in the footer as an admission, matching Elicit's framing that this is the whole promise of the surface.

**Leave** Elicit's UI is built for a slow, deliberate research report workflow (tables, multi-step generation, a paper library) that has nothing to do with a fast conversational dock; none of its screen layout transfers.

## Scite — "grounded, never hallucinated" as the product's entire pitch

**Maps to** the source footer, and guardrail 3's evidence requirement generally

Scite answers research questions from a database of 300 million scholarly articles and states outright, on its own homepage, that every answer is "grounded in real papers, never generated or hallucinated," with each claim linked "back to the specific sentence in the specific paper it came from." Its "Smart Citations" go further than a plain link: they show whether later research supported, disputed, or merely mentioned the cited paper, so a reader can tell a citation that backs a claim from one that only name-drops it.

**Evidence** https://scite.ai/ (the homepage: "Verifiable Evidence: Every answer is grounded in real papers, never generated or hallucinated," and "Every claim Scite's AI makes links back to the specific sentence in the specific paper it came from")

**Take** the wording itself is worth stealing almost verbatim as an internal design principle for the footer: a source chip should link to the specific sentence, not the entry as a whole, and the product should be able to say, truthfully, that nothing in an answer is ungrounded.

**Leave** the "supported, disputed, or discussed" classification is built for a citation graph across a scholarly corpus; a Canonry universe has no equivalent of one entry "disputing" another, guardrail 7 forbids claiming that kind of resolved judgment about canon anyway.

## Notion AI Q&A — a docked launcher with an honest boundary on what it can answer

**Maps to** the launcher pill and its deterministic promise (R6, O3)

Notion's Q&A opens from a small sparkle icon docked at the bottom of every page and answers questions using retrieval over the pages a user already has permission to see, returning an answer with links back to the source pages. Notion's own documentation is unusually blunt about the boundary: Q&A "doesn't have access to wider knowledge," so a question about anything not explicitly written into the workspace returns nothing rather than a plausible-sounding guess pulled from the model's general training.

**Evidence** https://www.notion.com/help/guides/understanding-how-q-and-a-finds-answers-can-help-you-get-better-results (the "How Q&A finds answers" guide: Q&A "doesn't have access to wider knowledge... Q&A won't return a result" for topics outside the workspace, and it only searches pages a user has permission to view)

**Take** the launcher's promise should be exactly this narrow and exactly this stated: our copilot answers from this universe's canon and nothing else, and when the retrieval layer has nothing that clears the bar, the honest answer is "nothing in this universe supports that" rather than a fluent paragraph built on thin sources.

**Leave** Notion's entry point is a single small icon with no visible text and no suggestions before you type, which is the corner-and-silent pattern R6 already rejected in favor of a wider bottom-centre pill that states its shortcut and offers three suggestions up front.

## GitHub Copilot Chat — a References dropdown that declares exactly what was used

**Maps to** the context line that follows the page (R5, T11)

GitHub Copilot Chat in Visual Studio implicitly includes the active file and current selection in every prompt without the user asking, and after every response a "References" dropdown appears beneath the answer, listing exactly what context, which file, which method, which commit, was actually used to generate that specific reply. The same panel supports named threads so a user can start a fresh conversation to discard stale context on purpose rather than have it silently bleed into unrelated questions.

**Evidence** https://learn.microsoft.com/en-us/visualstudio/ide/copilot-chat-context-references?view=visualstudio (the "Manage chat context" doc: implicit inclusion of the active file and selection, the References dropdown shown "after every result," and the New Thread control for discarding prior context on purpose)

**Take** the dock's context line should work the same way as this References dropdown: state plainly, per turn, what page or entity the answer was scoped to. Today's context line only shows once in the header and goes stale the moment the reader navigates underneath the panel.

**Leave** Copilot Chat's reference vocabulary (`#file`, `@workspace`, `#commit:`) is a power-user syntax for scoping a coding assistant's context by hand; our GM never types a scoping token, the dock infers context from the route the same way O3 already specifies.

## Cursor — context pills that name exactly what was sent, before sending

**Maps to** the composer and its declared context (T8, S11)

Cursor's chat composer shows "context pills" beneath the input as the user types, one pill per file, folder, terminal output, or diff that will be attached to the next message, so the sender can see and remove exactly what is about to be sent before committing to it. By default the current file is always included as one of those pills, and Cursor documents that a user can override this per-message.

**Evidence** https://cursor.com/help/customization/context (the "@ mentions and context" doc: "context pills below the input" show what will be attached before sending, and the current file is included as a pill by default)

**Take** the composer's borderless bottom band (T8) has room for a similar declaration: a small, dismissible chip naming the entry or route in scope, sitting right where the reader is about to type, so "what am I asking about" is visible at the moment of composing rather than only in a header line above the scrollback.

**Leave** Cursor's pill vocabulary is built for attaching many heterogeneous, developer-chosen context sources to one message; our dock has exactly one context source at a time, the current route, so a single always-present chip is enough. A multi-pill picker would be S11's "command palette wearing a chat's job" all over again.

## Glean — enterprise answers that only draw from what the reader can already see

**Maps to** the retrieval layer's honesty and permission boundary (guardrail 3, guardrail 5's adjacent trust story)

Glean's AI Answers feature generates a direct answer from an organization's internal documents and attaches a citation to each one, but it is explicit that answers "use only content you already have permission to see" and "never surface information from documents you can't access," a permission check applied before the answer is generated rather than redacted after the fact.

**Evidence** https://docs.glean.com/user-guide/assistant/ai-answers (the AI Answers doc: "Answers use only content you already have permission to see. They never surface information from documents you can't access.")

**Take** the same permission discipline applies to a multi-GM or shared-universe Canonry install: retrieval for the dock and the Ask page should filter to entries the asking account can actually read before ranking, not after, so a weak-permission reader never even sees a citation to something they cannot open.

**Leave** Glean's answers are permission-scoped enterprise search across many connected tools (Slack, Confluence, Drive); Canonry's single-universe retrieval has no equivalent multi-source permission model to replicate, this is a principle to carry forward, not a feature to port.

## Intercom Fin — what a persistent launcher costs on mobile, and how it hides without disappearing

**Maps to** the phone tab bar and table-mode hiding (O3, R6, E3, E4, I10)

Intercom's Fin Messenger launcher is a fixed corner bubble on desktop web, but on mobile Intercom's own settings collapse it to the bottom-right regardless of the desktop launcher position, because a floating corner circle has to compete with the OS chrome and the page's own content on a small screen. Separately, hiding the launcher via audience rules "removes only the launcher button but leaves the Messenger itself functional and accessible through other methods," a distinction between removing the entry point and removing the feature.

**Evidence** https://fin.ai/help/en/articles/10697253-customize-the-fin-messenger (the "Customize the Fin Messenger" doc: "On mobile, the launcher shows on the bottom right of the screen," launcher position is not independently configurable there, and hiding the launcher "leaves the Messenger itself functional and accessible through other methods")

**Take** the distinction between hiding the entry point and disabling the feature is exactly what table mode needs: when the two-tier dock in E3's corner owns the screen, the ask launcher should hide the same way, present as a real, reachable surface, not deleted, matching the "hidden, not gone" model Fin documents.

**Leave** Fin gives up on a distinct mobile launcher position and just fixes it to a corner; our phone answer is stronger and already decided, the dock becomes a tab in the bottom bar (O3, E4, I10), not a floating circle competing with system chrome.

## Orange accessibility guidelines — a persistent launcher a screen reader user can actually find

**Maps to** the launcher pill's discoverability and the panel's streaming announcement (R6, T7, T11)

Orange's own accessibility guidelines walk through, in code, why a corner chat launcher is invisible to screen reader users by default: it usually sits at the end of the DOM after the footer, so a user has to listen through the entire page before reaching it, and a visually obvious button alone does not solve that; the fix is a skip link, an ARIA landmark region, or a heading naming the chat. The same article documents the fix for streaming replies: an `aria-live="polite"` region on the message list so new content is vocalized automatically, disabled momentarily around a multiple-choice prompt to avoid double-announcing the same text twice.

**Evidence** https://a11y-guidelines.orange.com/en/articles/chatbot/ (the "Best practices for a chatbot" guide: DOM-order launcher discoverability for screen reader users and the fix via skip links or `role="region"`; and the `aria-live="polite"` pattern for vocalizing streamed messages, with the temporary disable-around-a-prompt pattern to avoid double announcement)

**Take** because the launcher lives at the very bottom of every route's markup, it needs the same fix Orange describes: a landmark region and either a skip link or heading naming it, so a screen reader user doesn't have to listen through an entire canon entry to discover the copilot exists. The streaming bar (T7) should sit inside a `polite` live region so its arrival is announced without a spinner needing to say so.

**Leave** Orange's guide assumes a corner-anchored launcher throughout (its own worked example is bottom-right); R6 already moved ours to bottom centre for different, valid reasons, so the DOM-order and landmark fixes transfer but the specific corner-proximity advice about screen magnifier tooltips does not.

## Claude.ai — a conversation kept forever, with its own separate surface for finding it again

**Maps to** T10's "every turn is kept," and P5's "history lives in the account menu's own surface"

Claude.ai keeps every conversation by default in a reverse-chronological sidebar list, and when Claude's own memory feature pulls information from an earlier chat into a new one, it shows "past chat citations," links back to the original conversation, alongside the option to delete that specific source conversation. Anthropic's own support article is candid that sidebar search only matches conversation titles, not the text inside them, which is a known limitation once a user accumulates hundreds of chats.

**Evidence** https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context (the chat search and memory help article: "When Claude references previous conversations, you'll see citations linking back to the original chats, along with the option to delete specific conversations")

**Take** the "past chat citation" pattern, a link from a live answer back to the specific earlier conversation that informed it, is the right shape for our own conversation id: every turn kept (T10) needs to be addressable, and the one icon button that opens a turn on the Ask page (per the goal) is doing the same job Claude's past-chat link does.

**Leave** Claude's history lives in the main navigation sidebar, competing for space with every other chat; P5 deliberately kept our history out of the seven-item nav and put it in the account menu's own surface instead, because a history of what the copilot said is not navigation.

## WCAG APG Dialog (Modal) Pattern — the contract our panel must not sign

**Maps to** the panel that survives navigation without blocking the page underneath (R5, S11)

The W3C's Authoring Practices Guide defines exactly what a modal dialog owes the rest of the page: it traps the tab sequence entirely inside itself, everything under it becomes inert (visually obscured and non-interactive), and it must not be marked `aria-modal="true"` unless both the interaction trap and the visual obscuring are actually implemented, because getting that flag wrong actively harms assistive technology users who are told content is inert when it isn't.

**Evidence** https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ (the Dialog (Modal) Pattern spec: modal dialogs "contain their tab sequence" and make everything outside inert, and `aria-modal` should be set "only when both" the interaction trap and the visual obscuring are implemented, since a false claim of modality harms assistive technology users)

**Take** use this as the negative space that defines our panel: it should never trap tab order, never mark `aria-modal="true"`, and never render the page underneath as inert, because the shell's own reserved-height layout (T11) means the page underneath is still live, readable, and scrollable while the panel is open. The panel is a `region`, not a `dialog`.

**Leave** none of APG's modal-specific keyboard trapping or focus-return behavior applies to us at all; it is documented here specifically as the pattern to avoid, not one to adapt.

## Google AI Overviews — citations as garnish, not evidence

**Maps to** the source footer under a turn (guardrail 3), as the cautionary counter-example

Google's AI Overviews attach citation links beneath a generated summary, but independent analysis of over 20,000 ranking queries found that even the top-cited position in an Overview draws roughly the clickthrough of a position 6 organic result, and that citations are rendered small, truncated, and hard to scroll through, "basically a mousehole," compared to a normal search result's title and description. The same analysis found citation position within an Overview can be "bizarre and random," often favoring forums and low-authority sites over the pages that actually informed the summary.

**Evidence** https://searchengineland.com/ai-overview-citations-clicks-what-to-do-462389 (the Search Engine Land analysis of 200+ SERPs: "Citations are small, hard to scroll, and visually unappealing," ranking first in an Overview performs like position 6 in organic results, and "AI Overview citations consistently underperformed, even compared to traditional blue links near the bottom of the SERP")

**Take** nothing to adopt directly; this is the shape a citation takes when it exists to reassure rather than to inform, small, truncated, hard to act on, and it is the clearest possible argument for T9's footer treating a source as a first-class row under a rule rather than a squeezed-in afterthought.

**Leave** everything: the small truncated citation, the citation as trust theater rather than a real link to the exact sentence, and the total absence of any admission that a given Overview's sources might be weak, exactly the gap Consensus above closes and Google's own product does not.

## What I would build from this

- Add a real confidence floor to the retrieval layer before it ever renders a source footer: fewer than N sentences clearing a similarity threshold means "nothing in this universe supports that," not six weak matches dressed as evidence (Consensus).
- Chunk retrieved entries into sentence-level extracts and quote the literal `cited_text` in the footer instead of only the entry name (Anthropic Citations, Elicit, Scite's "grounded, never hallucinated" framing).
- Assign a stable id to each source the moment it is chosen and stream numbered markers that resolve against that id set once complete, so a fast reader never sees a dangling `[N]` (Perplexity's streaming citation cookbook and its own warning about unresolved references).
- Wrap the panel's turn list in an auto-scroll-with-opt-out scroller with a jump-to-newest control, and mark the content region `role="log"` so the streaming bar (T7) is announced without a spinner or a label doing the work (shadcn `MessageScroller`).
- Turn the header's context line into an explicit, itemized statement of scope, not an implicit "page context" note, following the shape of Copilot Chat's References dropdown and Cursor's context pills.
- Give the launcher pill a landmark region and a way to reach it before the footer, so a screen reader user finds it without listening through an entire canon entry (Orange's accessibility guidelines).
- Wire every kept turn's id to a real "open in Ask" link back to that specific conversation, mirroring Claude's own past-chat citation pattern, while keeping history itself off the seven-item nav per P5.
- Filter retrieval by what the asking account can read before ranking, not after, the same permission-first order Glean documents for its own enterprise answers.

## Anti-references

- Google AI Overviews render citations small, truncated, and hard to scroll, with a clickthrough rate on par with position 6 in ordinary search results; a citation that exists to reassure rather than to be read is exactly what guardrail 3 forbids.
- Perplexity has been reported, in third-party reviews rather than anything Perplexity states about itself, to display citations with identical visual confidence whether the underlying match is strong or thin. [INFERENCE, weaker secondary source: https://konabayev.com/blog/perplexity-ai-review/] Copying the numbered-citation shape without also copying a confidence floor reproduces this exact failure.
- Arc Max's "Ask on Page" shipped with fanfare, a spoof product launch event, a dedicated settings toggle, in October 2023, then was "quietly removed... without an announcement" within a few years. A copilot feature that can be switched off (guardrail 4) needs an actual story for what remains when it is gone; a silent removal is not that story.
