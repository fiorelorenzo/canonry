# References: Proposal review loop

This file covers the proposal inbox, the propagation plan, the per-entry diff, the evidence
popover, accept and reject with the `j k a r u` queue, reject reason chips, and the audit flag
badge: the surfaces gated by C2 through C9, G6, T4, U7, U9, V2 and V6. Today the inbox is three
rows that all read `From: an edit to Corvin Ashe`, twice, identically, with no diff, no reason,
no evidence and one badge that is not a button, so neither of SPEC 14's two deciding metrics can
be measured off it: every accept still costs a navigation. Everything below earns its place
because it survives dozens of items, marks a machine's authorship without a colour, or refuses to
certify more than it can promise.

## Google Docs — Suggesting mode's per-suggestion card and the walk-through review

**Maps to** the per-entry diff and its accept/reject affordance (C4, C6, T4)

Suggesting mode marks an insertion in the suggester's colour and strikes a deletion through
inline, in place, and clicking either opens a comment-style card in the right margin with a
checkmark and an X right on the change. `Tools > Review suggested edits` opens a box in the top
right that walks every suggestion in document order, one at a time, with a down arrow that
previews the document with or without the change before you commit, and Accept or Reject moves
you straight to the next one.

**Evidence** https://support.google.com/docs/answer/6033474?hl=en&co=GENIE.Platform%3DDesktop
(Google's own help page for suggesting, accepting and rejecting edits, including the walk-through
reviewer)

**Take** the buttons sit on the change itself, not in a side panel disconnected from the text,
which is C4's "in place" already proven at prose scale; the preview-before-you-commit toggle is
worth stealing for `ProposalDiffCard.svelte`, since it answers "what would accepting this actually
do" without spending the accept.

**Leave** the walk-through also ships `Accept all` and `Reject all` with a live count, which is
exactly the bulk action guardrail 1 forbids everywhere except the one re-import exception; and
Google attaches no reason to a suggestion beyond whatever the human suggester typed by hand, so it
has nothing that plays the role our evidence popover has to play.

## GitHub pull request review — Files changed, the viewed checkbox and the progress bar

**Maps to** the proposal inbox surviving forty pending proposals (V2, V3, U7)

Reviewing a pull request happens one file at a time: mark a file **Viewed** and it collapses, and
a progress bar in the header fills in as more files are viewed, so the page always shows how much
of the diff is actually left. Typing `?` on any GitHub page opens an overlay listing that page's
keyboard shortcuts, and the Files changed tab adds its own, including `T` to jump the cursor into
a "Filter changed files" field.

**Evidence**
https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request,
https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts (GitHub's own docs for
marking a file viewed, the progress bar, and the full shortcut list including the Files changed
tab's own row)

**Take** a settled item collapsing but staying in the DOM, with a running count of how much is
left, is the direct model for "the page has to survive forty pending proposals" and for U7's "a
settled proposal stays readable": nothing disappears, it just takes less room.

**Leave** the shortcuts are real but invisible until you press `?`, which is the cheat-sheet-
nobody-reads failure mode T5 was written to avoid; our own key hints have to live on the row, not
behind a lookup.

## Linear — Triage's four keyed exits and the Inbox's `j`/`k`

**Maps to** the keyboard queue model and its discoverability (C6, V2)

Opening a triage issue shows its four possible exits as part of the issue view itself: accept
(`1`), mark as duplicate (`2` or `MM`), decline (`3`), or snooze (`H`), and taking any of them
moves the issue out of Triage immediately, there is no fifth state to leave it in. The separate
Inbox view scrolls with `J`/`K` or the arrow keys, and Linear's own framing is blunt: "a triaged
issue is not done until it leaves the queue."

**Evidence** https://linear.app/docs/triage, https://linear.app/docs/inbox (Linear's own product
docs for the four triage actions and the Inbox's navigation keys)

**Take** showing the keys as part of the open item, not as a separate reference, is exactly what
our key-hint component (T5) already commits to; "not done until it leaves the queue" is the right
one-line test for what a pending proposal is.

**Leave** all four triage actions are one-shot and mutually exclusive, and the issue simply
disappears from the list with no settled state left behind, which is the opposite of U7's "a
settled proposal stays readable"; copied verbatim it would delete the very history our proposals
have to keep.

## Reviewable.io — persistent per-file state and the three-way counter

**Maps to** proposals grouped under a plan, with settled groups collapsed (V2, U7)

Reviewable tracks, per file and per revision, whether you personally have reviewed it, independent
of whatever GitHub's own UI says, and shows that as one of three counter colours in the sidebar:
red for something you owe, grey for something someone else owes, and grey with a red stripe for
something you have deferred back to the group. A discussion matrix groups every open thread into
To reply, Unresolved and Resolved, so the shape of "what is left" is visible before you open
anything.

**Evidence** https://docs.reviewable.io/reviews (Reviewable's own manual, the "Counters" and
"Discussion matrix" sections)

**Take** the three-way distinction between mine to decide, someone else's to decide, and
deliberately deferred is a better model than a flat pending count for a plan with several
proposals still open; it maps cleanly onto a plan header that has to say more than "12 of 40 left."

**Leave** the deeper shortcut help only appears on hover or behind `F1`, an optional layer for
power users bolted on after the fact, the same cheat-sheet trap GitHub's `?` falls into and T5 is
meant to prevent.

## Superhuman — one undo key, and shortcuts taught by using them

**Maps to** `j k a r u` and the meaning of `u` (C6)

`J`/`K` move down and up a list without leaving it. `E` archives, `H` sets a reminder that pulls
the item off the list, and if you hit either and change your mind, one key, `Z`, undoes whichever
of the two you just did. `Cmd+K` opens a command box that both looks up a shortcut and executes
the action, "so you can see the shortcut for next time" instead of reading a printed list; sending
a message has its own ten-second undo window on the same `Z`.

**Evidence** https://blog.superhuman.com/inbox-zero-in-7-steps/ (Superhuman's own onboarding guide,
steps 2 and 5, describing `J`/`K`, `H`, `E`, `Z` and Cmd+K)

**Take** one undo key that reverses whatever the last action was, rather than a different undo
per action, is the right shape for our own `u`; teaching a shortcut by executing it through a
command box the first time, then letting muscle memory take over, is a stronger answer to "how
does a keyboard model stay discoverable" than any static legend.

**Leave** Superhuman's send-undo is time-boxed, ten seconds and it is gone, which is right for an
email a server is about to transmit but wrong for us: a GM has to be able to notice a bad accept
and undo it whenever they notice, not only inside a short window, since guardrail 6 already keeps
anything unpublished from reaching a player regardless of timing.

## Microsoft Word — the reviewing card and Simple Markup's margin line

**Maps to** the per-entry diff, and the change bar itself (C4, T4, V6)

Clicking a tracked change opens a card naming who suggested it, with Accept and Reject on the
card, and hovering either button previews what the document would look like if you clicked it.
Word's All Markup view colours insertions and deletions per reviewer inline; Simple Markup
collapses all of that down to a single vertical line in the margin wherever a change exists,
leaving the prose itself untouched until you click in.

**Evidence** https://support.microsoft.com/en-US/Word/training/track-changes-in-word (Microsoft's
own training page, "View tracked changes" and "Choose how you would like to see the changes")

**Take** Simple Markup is a working, shipped proof that "collapse a change to a plain vertical bar
in the margin, expand only on demand" reads clearly at document scale, which is exactly V6's
answer for a pending proposal's mark on canon; hover-to-preview-the-result before committing is
worth adding to `ProposalDiffCard.svelte`.

**Leave** All Markup's per-reviewer colour coding is a second, human-authored colour system on top
of the document, and we have exactly one non-human author and, per decision, zero colours budgeted
for it; a multi-author palette does not transfer to a product with one machine and no hue for it.

## Grammarly — a suggestion card with a reason, not a score

**Maps to** the evidence popover and its "no bare confidence score" rule (C5, guardrail 3)

A detected issue gets a coloured underline by category (red for correctness, blue for clarity, and
so on, never a red/green pass-fail pair), and clicking it opens a card holding the suggested fix,
an Accept button, a trash-can Dismiss, and a "Learn more" expansion that writes out the actual
grammatical or stylistic reasoning in a sentence. Nothing on the card is a percentage.

**Evidence**
https://support.grammarly.com/hc/en-us/articles/360003474732-Grammarly-Editor-user-guide
(Grammarly's own editor guide, "Writing and editing text")

**Take** "Learn more" writes the reasoning as a sentence, never a number, which is the shape
guardrail 3 asks for; Grammarly's separate, whole-document "Overall score" panel proves a product
can keep an aggregate metric for the writer without ever letting it near an individual
suggestion, which is the same boundary our staff-only accept-rate dashboard has to keep from the
per-proposal evidence popover.

**Leave** Dismiss removes the suggestion from view but the underline's category persists as a
setting ("turn off suggestions like this"), a durable preference rather than a labelled reason;
it teaches the system less than a chip that says why, which is closer to what C7 already chose.

## Cursor — word-level Tab, whole-response Cmd+Return

**Maps to** the granularity of the per-entry diff's own accept action (C4, C6)

A typed completion accepts with `Tab`, or one word at a time with `Cmd →`, the finest grain
Cursor ships. Once the agent proposes a multi-file diff instead of a typed completion, the
granularity drops: `Cmd Return` with suggested changes present accepts every change in the
response, `Cmd Backspace` rejects all of them, and there is no documented keybinding for accepting
one hunk out of an agent-authored diff.

**Evidence** https://cursor.com/docs/reference/keyboard-shortcuts (Cursor's own keyboard shortcuts
reference, the Tab and Chat sections)

**Take** the honesty of the drop from word-level to whole-response is useful: nobody, including
the most funded AI coding tool on the market, has shipped a keyboard-bound "accept just this
hunk" for a model-authored diff. That confirms our own scope is right: one proposal, one accept,
never a partial accept inside a single diff.

**Leave** "accept all changes" for an entire agent response is precisely the bulk-accept shape
guardrail 1 forbids; it is the single most popular AI coding agent shipping the exact anti-pattern
our spec calls out by name.

## GitHub Copilot code review — always a comment, never an approval

**Maps to** the evidence popover and audit flags reasoning without a score (guardrail 3, C9)

Copilot's review always posts as a "Comment," never an "Approve" or "Request changes," so it can
never singlehandedly clear a merge requirement. Each comment carries written reasoning and, where
it applies, a one-click suggested change; in VS Code the reviewer works through them with
**Apply and Go To Next** or **Discard and Go to Next**, and feedback on a comment is a thumbs up
or down, never a numeric score shown back to the reviewer.

**Evidence**
https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review
(GitHub's own Copilot code review docs, "Using Copilot code review" and the VS Code tab)

**Take** "always Comment, never Approve" is a clean institutional pattern for keeping a machine's
word from finalizing anything by itself, the same posture guardrail 1's one exception protects;
Apply/Discard-and-Go-To-Next is essentially our `a`/`r` advancing the queue and is worth confirming
against, not copying, since we already have it.

**Leave** thumbs up/down is collected to improve Copilot's own model, not shown back as any kind
of confidence, and Copilot's reasoning is general code judgement rather than a citation to a
specific prior line; it cannot stand in for guardrail 3's "which entry, which sentence" because it
was never built to name one.

## Renovate — the Dependency Dashboard issue and its Closed/Ignored section

**Maps to** the propagation plan as a flat checklist surviving many pending items (C3, V2)

One GitHub issue is the dashboard: every pending, deferred and declined dependency update is a
checkbox row inside it. Checking a box (when approval is required) is what asks Renovate to raise
that specific update as a pull request; closing a PR without merging it demotes that update into a
"Closed/Ignored" section rather than deleting it, and re-checking its box later resurrects it.

**Evidence** https://docs.renovatebot.com/key-concepts/dashboard/ (Renovate's own docs, "Visibility
into rejected/deferred updates" and "Dependency Dashboard Approval workflow")

**Take** nothing a person declines actually disappears, it moves to a named, re-openable bucket;
that is a strong model for what a rejected propagation candidate should do inside a plan, and the
flat-checklist shape holding hundreds of items across many repositories is a real existence proof
for C3 at scale.

**Leave** the dashboard is markdown checkboxes with no diff, no evidence and no reasoning on the
page itself, so every actual decision still requires opening a separate linked PR; that is the
extra navigation V2 exists specifically to remove from our own inbox.

## Sourcegraph Batch Changes — the burndown chart

**Maps to** the propagation plan's own progress signal (C3, SPEC 14)

One batch change tracks many changesets across many repositories and code hosts, and shows their
overall progress as a burndown chart: the proportion merged over time since the batch began,
alongside each changeset's live check status and review status pulled from its code host.

**Evidence** https://sourcegraph.com/docs/batch-changes (Sourcegraph's own docs, "Create a Batch
Change" and its burndown chart screenshot)

**Take** a trend line instead of a static "12 of 40 pending" count is a plausible shape for a
plan header showing how a propagation is going; it is a different instinct from a raw accept rate
and worth trying at the plan level before assuming a single number is enough.

**Leave** Batch Changes assumes the actual review, diff and decision always happens back on the
code host; it orchestrates and tracks rather than being the review surface itself, which is the
opposite of what V2 is trying to build.

## Dependabot — release notes in the body, and a bare compatibility score beside them

**Maps to** evidence attached to a machine-authored change, and the anti-pattern for guardrail 3

A Dependabot pull request body typically carries the actual changelog or release notes for the
version bump, in place rather than behind a link. When enough public repositories have applied the same
update, the body also shows a compatibility score: the percentage of other repositories' CI runs
that passed after taking the identical bump.

**Evidence**
https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-security-updates
(GitHub's own docs, "About compatibility scores")

**Take** putting the real evidence text, the changelog itself, directly in the body rather than
one click away is exactly guardrail 3's "which entry, which sentence" instinct, applied to a
dependency instead of a wiki entry.

**Leave** the compatibility score is a bare percentage with no visible reasoning behind it, and by
GitHub's own account most updates have too few candidate repositories for the number to mean
anything, and it disappears entirely once updates are grouped; it is the exact shape guardrail 3
names and forbids.

## Graphite — "Needs your review" and the stack navigator

**Maps to** proposals grouped under the plan that produced them (V2)

Pull requests waiting on you land by default in a section literally named "Needs your review," not
a status noun like "Open." Reviewing a stack of dependent PRs together is supported by a dedicated
navigator, `S`, that shows where the current PR sits among its siblings so a reviewer can move
sibling to sibling without re-finding each one from the flat list.

**Evidence** https://graphite.com/docs/review-pull-requests (Graphite's own docs, "Review queue"
and "Navigate a stack of PRs to review")

**Take** naming the default section by the verb the reviewer needs to perform, not a status word,
is a small, cheap clarity win worth taking directly; moving sibling to sibling inside one group
before returning to the top-level list is a good precedent for staying inside a plan's own
proposals before jumping back to the inbox.

**Leave** the stack navigator assumes a strict dependency order between items, each PR depends on
the one below it, which does not hold for propagation candidates ordered by relevance; copying the
navigator verbatim would impose an ordering constraint our plan does not actually have.

## Gerrit — the attention set chevron and the submit requirements panel

**Maps to** who a proposal is currently waiting on, and audit flags as a status marker (U7, C9)

Every change shows a per-person "attention set" mark, a chevron that says whose move it currently
is; clicking it removes that person from the set, the closest thing Gerrit has to "you have dealt
with this." Separately, a Submit Requirements panel shows each merge condition met or unmet,
coloured green for satisfied and red for outstanding.

**Evidence** https://gerrit-review.googlesource.com/Documentation/user-review-ui.html (Gerrit's own
Review UI documentation, "Change metadata" and "Submit Requirements")

**Take** a compact "it is currently your move" marker, cleared by one click once you have acted, is
a clean way to say a proposal is waiting on a specific person without a second inbox; useful if a
universe ever has more than one GM deciding proposals.

**Leave** the green/red submit-requirements panel is the red/green pattern our diff explicitly
rejects; Gerrit can get away with it because it is a status light, met or not met, rather than a
content diff, but it is exactly the hue-carries-meaning shortcut T4 designed out of the proposal
card, and it should not creep back in through a status panel instead.

## Stripe Radar — named risk factors beside a bare 0-99 score

**Maps to** the evidence popover, and directly the anti-pattern guardrail 3 names (C5)

The review queue's detail view moves between payments with `J` and `K`, the same letters our own
queue uses for different verbs. Each payment's risk insights panel names the specific factors that
contributed: a mismatch between the cardholder's name and the account email, an unusually low
authorization rate, IP and billing geography that do not agree, other payments sharing the same
card or address. The same panel also shows a single 0-99 risk score with documented thresholds for
"elevated" and "high."

**Evidence** https://docs.stripe.com/radar/reviews/risk-insights,
https://docs.stripe.com/radar/transaction-reviews (Stripe's own docs, "Risk insights" and "Review
payments," including the `J`/`K` navigation and the score thresholds)

**Take** named, individually inspectable factors, this specific mismatch, this specific pattern,
are close to guardrail 3's "which entry, which sentence" bar; Stripe's own best-practice text
telling reviewers to "use risk insights... to make an informed decision" is a real product
admitting the score alone is not enough to act on.

**Leave** Stripe still puts the 0-99 score front and centre on every row, which is the bare
confidence score guardrail 3 forbids by name; if Stripe's own documentation has to keep steering
reviewers past the score toward the named factors, that is evidence the score is a liability the
evidence popover should never carry at all.

## Buçinca, Malaya and Gajos, "To Trust or to Think" (CSCW 2021)

**Maps to** why the evidence popover forces itself open only on weak evidence (C5)

The study (N=199) found that adding an explanation to an AI recommendation did not reduce
overreliance on a wrong suggestion, and in some conditions increased it, because people form a
general heuristic about whether to trust the AI rather than engaging with each individual
explanation. Forcing a person to reason before seeing the AI's answer measurably cut overreliance,
at a real cost: the forcing conditions were rated less favourably, and the benefit was uneven,
larger for people already inclined toward effortful thinking.

**Evidence** https://www.eecs.harvard.edu/~kgajos/papers/2021/bucinca2021trust.shtml (the authors'
own page for the paper, hosted by Krzysztof Gajos at Harvard SEAS, with the abstract and both the
authors' and publisher's versions linked)

**Take** this is the direct research case for C5 forcing the popover open specifically where the
evidence is weak, embedding similarity only, rather than on every proposal: forcing costs real
goodwill, so it should be spent where a wrong accept is most likely, not everywhere.

**Leave** the same paper is a caution against assuming an always-visible, unforced evidence
popover will do much on its own; "just add an explanation" was the condition that did not work, so
the forty-proposal batch still needs something better than hoping the popover gets read.

## What I would build from this

- Give `ProposalDiffCard.svelte` a hover-preview on Accept and Reject before either commits,
  the way Word's reviewing card and Google Docs' checkmark/X both preview the result first
  (Word, Google Docs).
- Replace the plan header's raw "12 of 40 pending" with a three-way count, mine to decide,
  someone else's, deferred, the way Reviewable's sidebar counters work, so a shared universe's
  plan says more than a fraction (Reviewable).
- Put the `j k a r u` key hints on the row itself as part of T5's key-hint component, never behind
  a `?` overlay or an `F1` hover, since both GitHub and Reviewable prove that pattern goes unread
  (GitHub PR review, Reviewable).
- Give a rejected propagation candidate a named, re-openable bucket inside its plan rather than
  letting it vanish from the checklist, the way Renovate's Dependency Dashboard keeps a
  Closed/Ignored section that one checkbox resurrects (Renovate).
- Make `u` a single undo key that reverses whichever of accept or reject just happened, with no
  expiring window, since Superhuman's own ten-second send-undo is the wrong shape for a decision
  that has to stay reversible whenever a GM notices it was wrong (Superhuman).
- Force the evidence popover open only on weak-evidence candidates, per C5, and treat that as the
  whole budget for forcing; the Buçinca paper is the reason a blanket, always-forced popover would
  cost more goodwill than it is worth (Buçinca, Malaya and Gajos).
- Name the inbox's default section by the verb, "needs your decision," not a status noun, the way
  Graphite's "Needs your review" beats a plain "Open" list (Graphite).
- Try a burndown line on the plan header alongside the pending count, since a trend answers "is
  this propagation converging" in a way a static number does not (Sourcegraph Batch Changes).

## Anti-references

- Google Docs' own `Accept all`/`Reject all` button, with a live count, sits right next to the
  otherwise well-built walk-through reviewer; it is the bulk-accept shape guardrail 1 forbids
  everywhere except the one re-import exception, and it must not survive the trip into our inbox.
- Stripe Radar puts a bare 0-99 risk score front and centre on every row in its review queue, the
  exact "bare confidence score or percentage" guardrail 3 names and forbids, even though the same
  page's named risk factors are worth taking.
- Notion AI's `Edit with AI` replaces a whole selected block at once and offers only Accept,
  Discard or a retry prompt: no diff, no per-sentence granularity, no cited source for why the
  edit was made. A reader cannot see what changed inside a long block, which is the opposite of
  "every changed part shown at once with enough context to read it."
  (https://www.notion.com/help/guides/notion-ai-for-docs)
- Cursor's own Agent mode ships `Cmd Return`, accept every change in a multi-file response, as its
  only keyboard-bound option once a model proposes a diff; the most widely used AI coding agent on
  the market defaults to the exact bulk-accept shape our spec forbids by name.
