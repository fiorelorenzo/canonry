# Motion

Decision Q6, round twelve (`DECISIONS.md`), built in #367. Two pages of reasoning are in
that entry; this is the part a component author needs, and it is deliberately short.

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
   question is which of the two your change is, not what number it wants.
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
   accepted or rejected, a state that changed where a reader would otherwise wonder whether
   their click registered. Does not: text on load, anything on a canon reading surface,
   anything that delays an action, and anything that moves while a model is already making
   the reader wait (`ModelRunning` on screen means everything else holds still).

## Where it already is

- `components/ui/**`: popover, dialog, sheet, select, dropdown menu and tooltip open and
  close on these tokens. Nothing there needs a second pass.
- Shell: the Loremaster panel expanding out of its pill, the phone drawer, nav rows.
- Table mode: the toast, the session banner, the context form and the note form arriving.
- Proposal review: the accept/reject toast and the reject reasons opening.
- World home and the entries table: hover and focus colour only, on purpose. Nothing
  arrives or expands on either, and a list of entries fading in on load is the "text on
  load" case Q6 refuses.

## Checking it

`/dev/ui` has a Motion block at the bottom of each palette pane: the four tokens with their
values, and a replayable enter animation. Emulate the preference rather than reading the
media query, which for a headless Chrome means CDP:

```js
await session.send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "reduce" }],
});
```

With it on, the block's boxes appear with no slide, `getComputedStyle` reports
`transition-duration: 1ms` where a surface used `duration-move`, and the popover, dialog
and sheet fade without sliding or zooming.
