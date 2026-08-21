# Motion

Decision Q6, round twelve (`DECISIONS.md`), built in #367. Two pages of reasoning are in
that entry; this is the part a component author needs, and it is deliberately short.

Round seventeen's V9 (#501) widened _where_ this pattern may appear, not the pattern
itself: a state that changed, a list arriving, and a control responding to the pointer
or a press. It changed nothing about reduced motion, added no third token, and Q6's own
refusals (text on load, a canon reading surface, anything that delays an action, anything
moving while `ModelRunning` is on screen) still decide every individual case. The two
rules that keep V9 from being a third rule of its own are folded into rule 1 and rule 4
below rather than written twice.

## What reduced motion means here

**Nothing travels.** Every state change still happens and still shows. The ones that would
have crossed the screen arrive at once instead. Opacity and colour keep their transition,
because a cross-fade is a value changing in place, and it is the cheapest honest way to
tell somebody who asked for less movement that something is different now.

It is handled once, in `apps/web/src/routes/layout.css`, and it needs nothing from you:
the move token collapses to 1ms, tw-animate-css's translate, scale, rotate and blur
offsets go to their no-op values so `slide-in-from-bottom-2` becomes a plain fade, delays
go to zero, a looping animation stops outright, and `transition`, `transition-all` and
`transition-transform` collapse whole, because those are the three utilities whose property
list can carry a transform and CSS has no selector for "transitions transform". So a
chevron that rotates on `transition-transform` stops rotating without its own file knowing
any of this exists. There is no in-product setting: unlike dark (G1), a vestibular
preference is not something the OS can get wrong.

So a component that uses the tokens below is already correct in both modes, and a
component that hardcodes `duration-200` is not.

## The four rules

1. **Two duration tokens, named by what they may move.** `duration-fade` (140ms) is for
   opacity and colour, and survives reduced motion. `duration-move` (200ms) is for
   position, size and scale, and goes instant. If you are reaching for a third, the
   question is which of the two your change is, not what number it wants. V9 widened
   where these two may be spent; it is not licence to mint a third one, and a numeric
   literal standing in for either (a bare `140ms`, a `duration-[180ms]`) is the same
   defect as before.
2. **Two easings.** `ease-arrive` for something coming in, `ease-leave` for something going
   away. A numeric literal in a class or in a `transition` shorthand is the defect, not the
   value it happens to hold.
3. **Enter in CSS, and do not animate an exit you own.** Use tw-animate-css
   (`animate-in fade-in-0 slide-in-from-bottom-2 duration-move ease-arrive`), never a
   Svelte `transition:` directive: those take a duration in JavaScript, which cannot read a
   token and cannot see the media query. An `{#if}` that closes removes its node at once,
   and that is right, because Q6 refuses anything that delays an action behind its own
   animation. Exits exist only in the vendored primitives, where bits-ui holds the node
   open for them.
4. **Ask what earns it before you ask how it looks.** Earns motion: a thing arriving or
   leaving, a panel expanding in place (O3, G5), a section opening (O2), a proposal
   accepted or rejected, a state that changed where a reader would otherwise wonder
   whether their click registered - V9 (round seventeen, #501) adds two more to that
   list without changing its shape: **a list arriving**, once, in a roughly-40ms cascade,
   and only on a working surface (an inbox, an entries table, a review queue - never an
   entry, never the players' wiki, because a list of prose fading in on load is exactly
   the "text on load" this rule already refused); and **a control responding** to a
   press, a pointer over a card, or its own state settling (a mark drawing in rather than
   appearing whole). Does not: text on load, anything on a canon reading surface,
   anything that delays an action, and anything that moves while a model is already
   making the reader wait (`ModelRunning` on screen means everything else holds still).
   Every one of V9's own additions still has to be checked with `prefers-reduced-motion`
   emulated through CDP rather than read off the media query - see "Checking it" below -
   because "it uses the tokens" is a claim about the code, and reduced motion is a claim
   about what actually painted.

## Cascading a list

A working surface's own list fades its rows in once, in order, about 40ms apart, and
nothing else does. The shape, copied from `EntryTable.svelte`'s `<tbody>`:

```svelte
{#each rows as row, i (row.id)}
	<tr class="motion-row-arrive" style={`animation-delay: ${Math.min(i, 11) * 40}ms`}>
```

```css
tr.motion-row-arrive {
  animation: motion-row-arrive var(--transition-duration-fade)
    var(--ease-arrive) both;
}
@keyframes motion-row-arrive {
  from {
    opacity: 0;
  }
}
```

Four things about that shape are not incidental. It is **opacity only**, on
`duration-fade`, never a slide: a translate does not paint the same on every element
(a `display: table-row` in particular), and a fade is the one motion that was already
going to survive reduced motion regardless. The stagger is **capped** (`Math.min(i, 11)`
above) so a 25-row page finishes in half a second rather than growing with the page
size. It is keyed by a real id, so a genuinely new set of rows - a sort, a page, a
filter - remounts and replays it, while nothing about paging through with `j`/`k`
(EntryTable's own keyboard binding) touches these nodes to retrigger it. And it runs
**once per mount**, which is the whole difference between this and the "text on load"
refusal: a page that already has its rows on screen and then re-fetches the same rows
does not refade them, because they are not new DOM nodes.

This is the only place the pattern is built today. The inbox and the import review
queue are named in the same breath in the decision (V9, #501) and are the other two
working surfaces that may cascade - both are mid-rebuild under #498 this round, so the
recipe above is what that issue's own list should reach for rather than a fourth
invented one.

## Where it already is

- `components/ui/**`: popover, dialog, sheet, select, dropdown menu and tooltip open and
  close on these tokens. Nothing there needs a second pass.
- Shell: the Loremaster panel expanding out of its pill, the phone drawer, nav rows, and
  now (V9, #501) the sidebar's own pending-count badge, which crossfades to a new number
  on the fade token rather than snapping - it stays mounted across a navigation, so a
  count that changes while it is on screen is a real case and not a first paint.
- Ask, and the command palette's own dock (`QuickAsk.svelte`): a streaming answer ends in
  a one-character bar on the accent, pulsing, from round fifteen's T7 - already on this
  system, just not previously named in this file.
- Controls: `Button`'s own press nudge (`active:translate-y-px`, #147) predates this
  round. V9 adds `AcceptMark` (`components/ui/accept-mark`), a checkmark that draws its
  stroke in on `duration-move` rather than appearing whole, used where a proposal settles
  (`LiveProposalFeed`) and where a style preset is picked (universe settings' image and
  narration pickers) - and a hover lift on those same picker cards, transform only, never
  `shadow-elevated` (V3 spends that token only on what genuinely floats over the page).
- Table mode: the toast, the session banner, the context form and the note form arriving,
  and now (V9) the queue tab's own list, which fades a row in once as it lands over SSE -
  one at a time, since that list never arrives whole, it grows for as long as the session
  runs.
- Proposal review: the accept/reject toast and the reject reasons opening. The card
  leaving a group on accept or reject, and the queue's own arrival cascade, belong to the
  inbox rebuild under #498 (V2, #498) rather than to this file - see "Cascading a list".
- The entries table: hover and focus colour only until this round. V9 names it as a
  working surface, so each page of rows now cascades in once on mount (see "Cascading a
  list"); `j`/`k`, the sort arrows and pagination are otherwise exactly as before.
- World home (`ContinueRow`, `WorldPulse`, `WaitingForYou`): still hover and focus colour
  only, on purpose - it is a curated page, not a working surface's list, so nothing there
  cascades.

## Checking it

`/dev/ui` has a Motion block at the bottom of each palette pane: the four tokens with
their values, a replayable enter animation, a replayable cascade (three rows, the same
recipe as `EntryTable.svelte`) and a replayable `AcceptMark` draw. Emulate the preference
rather than reading the media query, which for a headless Chrome means CDP:

```js
await session.send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "reduce" }],
});
```

With it on, the block's boxes appear with no slide, `getComputedStyle` reports
`transition-duration: 1ms` where a surface used `duration-move`, the popover, dialog and
sheet fade without sliding or zooming, the cascade's three rows appear together rather
than in sequence, and the accept mark appears whole rather than drawing - each of those
is the same "nothing travels" claim, checked at a different call site rather than a
different rule. A render of the inbox, the entries table and an entry with the same
emulation on, beside the normal render of each, is what a claim about any of this rests
on; a screenshot with no reduced-motion pass beside it is not evidence that nothing
travels, only that something arrived.
