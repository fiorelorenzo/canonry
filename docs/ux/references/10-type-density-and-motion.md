# References: Type, density and motion

This file is craft rather than a screen: the type scale's role-named tokens, the reading measure
for canon prose, the density of the working surfaces now that a card is a hairline-ruled row,
tabular figures in a serif interface, the dark palette as half the design system, elevation spent
only on what floats, the two-token motion system, micro-interactions on controls, the `key-hint`
component, and the accessibility floor: the surfaces gated by A1, G1, G2, Q6, T5, V1, V3, V9, V10
and V11. Today the two duration tokens (140ms, 200ms) and two easings exist and are honoured under
`prefers-reduced-motion`, the type scale has five role names and a 12px floor, and `tabular-nums`
is forced globally in `layout.css`, but none of it has ever been checked against another product's
own published numbers, so a reviewer has no way to tell 140ms was chosen rather than guessed.
Everything below earns its place because it publishes an actual number, names a mechanic rather
than a vibe, or shows how a serif reading surface keeps numbers, identifiers and dense tables
legible without switching face.

## IBM Carbon Design System — distance-scaled duration and the productive/expressive split

**Maps to** the motion system's two duration tokens (Q6, V9)

Carbon publishes six static duration tokens in milliseconds: `duration-fast-01` 70ms for a button
or toggle micro-interaction, `duration-fast-02` 110ms for a fade, `duration-moderate-01` 150ms for
a small expansion or short-distance move, `duration-moderate-02` 240ms for a larger expansion or a
toast, `duration-slow-01` 400ms for a large expansion or an important system notification, and
`duration-slow-02` 700ms for background dimming. Carbon's own guidance treats these as a fallback:
"duration is calculated based on the style and size of the motion... the larger the change in
distance or size of the element, the longer the animation takes," and it ships a Motion Generator
tool to compute a bespoke, non-linear duration per element rather than picking one of the six. Two
motion styles run through the system, productive (subtle, for button states, dropdowns, table
rendering) and expressive (deliberately more visible, reserved for opening a page or a primary
action), each with its own easing, for example productive standard easing is
`cubic-bezier(0.2, 0, 0.38, 0.9)` against expressive standard's `cubic-bezier(0.4, 0.14, 0.3, 1)`.
Its own evaluation checklist asks whether "micro-interactions fall within a static duration ranging
from 90-120ms."

**Evidence** https://carbondesignsystem.com/elements/motion/overview/ (Carbon's own Motion page:
the Style, Easing and Duration sections, the six duration tokens table, and the evaluation
checklist)

**Take** our own `duration-fade` (140ms) and `duration-move` (200ms) sit squarely inside Carbon's
moderate band (150-240ms), the right register for a hairline-ruled row settling into place or an
evidence popover opening: not a hover-fast micro-interaction and not a full-screen transition. That
comparison is worth writing into `MOTION.md` itself, so the next person who asks "why 140 and not
120" has an answer that points outward, not just at Q6's own prose.

**Leave** the two-styles-times-three-curves matrix (productive/expressive times standard/entrance/
exit) is six curves before anyone touches duration, and a non-linear, distance-computed duration
for every individual move is the opposite of Q6's whole point: two flat tokens that never vary, so
nobody has to run a generator before shipping a transition.

## Material Components for Android — sixteen duration tokens and seven easing curves

**Maps to** the motion system's numeric defense (Q6, V9)

Material's own component library, not just its marketing pages, ships sixteen duration attributes
in four bands: four "short" tokens from 50ms to 200ms, four "medium" from 250 to 400ms, four "long"
from 450 to 600ms, and four "extra long" from 700ms to 1000ms, plus a rule that "duration should
increase as the area/traversal of an animation increases." Easing comes in two families of three
(standard and emphasized, each with a base, decelerate and accelerate curve) plus one linear curve
for non-stylized motion, all published as literal `cubic-bezier()` values, for example standard is
`cubic-bezier(0.2, 0, 0, 1)` and emphasized-decelerate is `cubic-bezier(0.05, 0.7, 0.1, 1)`.
Material also ships a parallel, newer physics system: six named springs (fast, slow and default,
each split into spatial and effects) with real damping and stiffness numbers, for example the
fast-spatial spring for "small components like switches and buttons" is damping 0.9, stiffness
1400.

**Evidence** https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md
(Material Components for Android's own theming docs, the "Curves (easing & duration)" and
"Springs" sections, with every token's literal default value)

**Take** sixteen tokens is the scale problem Q6 refuses on purpose, but a system this large still
expressing every one of them as a plain, named millisecond value rather than a formula is the
precedent that matters: our two tokens are a compressed version of the same idea, not a different
one. `duration-move` at 200ms lands on Material's own `motionDurationShort4`, "for utility focused
animations that begin and end on screen," a fair description of most of what we use it for.

**Leave** sixteen duration tokens and seven easing curves, doubled again by a whole separate spring
system, is the token sprawl V3 was written to kill in this codebase's own type scale; adopting
Material's granularity here would just move the 66-arbitrary-sizes problem from font sizes to
animation timings.

## Atlassian Design System — interaction and transition bands, and four motion principles

**Maps to** the motion system and its two duration tokens (Q6, V9, V11)

Atlassian's own motion docs split duration into two named bands rather than a token ladder:
"Interactions (50-150ms)," used for hover and press states, where "short durations ensure the
interface feels immediately responsive," and "Transitions (150-400ms)," used for something
entering, exiting or moving, where "longer durations help users track spatial changes" and "larger
elements generally require longer durations to feel proportional." Its worked examples put a
list-item hover at 50ms, a dropdown entrance at 150ms, and a modal entrance at 250ms. Four named
easing curves ship as literal `cubic-bezier()` values with a stated intent each, for example
ease-out-practical, `cubic-bezier(0.4, 1, 0.6, 1)`, is "a subtle, everyday entrance curve. Best for
elements like Popup or hover background fades." The system runs on four principles, Human, Clarity,
Accessible ("our system honors reduced-motion settings, providing clear low- or no-motion options")
and Performant.

**Evidence** https://atlassian.design/foundations/motion (Atlassian Design System's own Motion
foundations page: Duration, Easing curves and the four motion principles)

**Take** a two-band model, instant for a control responding, one register slower for something
entering or leaving, is a cleaner mental model to hand a component author than a name like
`duration-move`, and it is worth stating explicitly in `MOTION.md`: our fade token (140ms) sits
inside Atlassian's interaction band, our move token (200ms) sits inside its transition band, so
both numbers already read as considered once somebody draws that box around them.

**Leave** Atlassian's four principles are aspirational prose without an enforcement mechanism
beyond the page itself (its own tokens are still "Early Access" behind a feature flag on a limited
component set); Q6's rule 4 and V9's own two limits are stricter, because they name the specific
things motion may never do (delay an action, run while a model is already making the reader wait)
rather than trusting a principle to be remembered.

## GitHub Primer Primitives — a token rulebook written in MUST, SHOULD and NEVER

**Maps to** the type scale's role-named tokens, the density of the working surfaces, and the
motion system's own ceilings (V3, Q6, V11)

Primer's own token guide states its motion, typography and density rules as RFC 2119 keywords
rather than a paragraph of prose: "MUST keep animations ≤motion.duration.medium (300ms) for UI
interactions," "SHOULD use motion.duration.micro (100ms) for hover and focus micro-interactions,"
"NEVER exceed motion.duration.long (500ms)." Its typography tokens are named by role, not by size,
on the same pattern our own `--text-label`/`--text-body`/`--text-title` already follows:
`--text-[role]-shorthand-[size]`, where role is `display`, `title`, `body`, `subtitle`, `caption`,
`codeBlock` or `codeInline`, with a stated rule to "match the token to the semantic role (e.g., use
title tokens for headers, not just a large body token)." Its density tokens for interactive
controls take a `condensed`/`normal`/`spacious` axis directly, `--control-[size]-paddingInline-
[density]`, the same three-way vocabulary V3's "one step up and flat" reaches for without yet
naming it as a formal axis anywhere in `layout.css`.

**Evidence** https://github.com/primer/primitives/blob/main/DESIGN_TOKENS_GUIDE.md (Primer's own
design tokens master guide: the Motion, Typography and Spacing keyword-enforcement tables, and the
Control and Stack token patterns)

**Take** stating a rule as MUST/SHOULD/NEVER rather than as descriptive prose is a small, cheap
upgrade worth taking directly into `MOTION.md` and the type-scale comment in `layout.css`: "MUST
use `--text-body`, not a bracketed size" reads as an enforceable contract in a way "we use role
names" does not, and it is the same shift V3's own decision text already wants, a name is the only
thing that stops the next arbitrary value.

**Leave** Primer's density axis is a per-control property (`paddingInline-condensed` versus
`paddingInline-spacious`), meant so one button can be denser than its neighbour on the same page;
V3 chose one density for the whole app rather than a dial any component reaches for individually,
and giving each control its own condensed or spacious choice is exactly the kind of local,
un-reviewed decision that produced the 66 arbitrary sizes V3 was written to undo.

## Apple Human Interface Guidelines — the concrete techniques behind Reduce Motion

**Maps to** the reduced-motion rule in `layout.css` (Q6)

Apple's own accessibility guidelines list five specific techniques for responding to Reduce Motion,
not just "turn animations off": "tightening animation springs to reduce bounce effects," "tracking
animations directly with people's gestures," "avoiding animating depth changes in z-axis layers,"
"replacing transitions in x-, y-, and z-axes with fades to avoid motion," and "avoiding animating
into and out of blurs." The same page frames the setting around a real harm rather than a
preference: "people who are prone to these effects can turn on the Reduce Motion accessibility
setting" because fast-moving or blinking animation "can be distracting, cause dizziness, and in
some cases even result in epileptic episodes." A separate Motion page adds a rule that reads like
it was written for a product with a Loremaster: "let people cancel motion... don't make people wait
for an animation to complete before they can do anything, especially if they have to experience the
animation more than once."

**Evidence** https://developer.apple.com/design/human-interface-guidelines/accessibility (Apple's
own HIG, the Cognitive section's Reduce Motion guidance), https://developer.apple.com/design/
human-interface-guidelines/motion (Apple's own Motion foundations page)

**Take** "replace an x/y/z transition with a fade" is the exact rule `layout.css` already
implements (translate, scale, rotate and blur collapse to no-ops and fade survives), and this page
is worth citing as the reason that substitution is an industry answer rather than a Canonry
invention: the state change still has to happen and still has to show, only the travel is optional.
"Don't make people wait for an animation to complete before they can act" is Q6's rule 4 stated a
second way and is worth quoting in `MOTION.md` directly.

**Leave** Apple's list is written for spring-physics animation (SwiftUI, native transitions) and
assumes a platform that can tighten a spring's damping rather than swap a CSS transition; "track
animations directly with people's gestures" has no analogue in a web app with no drag gesture to
track, so it stays a principle rather than a technique to port literally.

## Material dark theme — elevation as a colour shift, not a shadow

**Maps to** elevation without grey shadows on warm paper, the dark palette (G1, V3)

Material's own dark-theme documentation states the problem plainly: "shadows are less effective in
an app using a dark theme, because they will have less contrast with the dark background colors and
will appear to be less visible." Its answer is an elevation overlay, "a semi-transparent overlay
conceptually placed on top of the surface colour," whose opacity is "calculated using an equation
based on elevation, which results in higher alpha percentages at higher elevations, and therefore
lighter surfaces," composited into a single background colour rather than drawn as a second layer,
"to avoid overdraw." A stated list of exactly which components may carry the treatment (Card,
Dialog, Menu, Bottom Sheet, FAB, Button, Chip, Switch, and the various app bars) keeps the effect
off anything not genuinely elevated.

**Evidence** https://github.com/material-components/material-components-android/blob/master/docs/theming/Dark.md
(Material Components for Android's own Dark Theme docs, the "Elevation overlays" section and its
theme-attribute table)

**Take** the underlying move, separation on a dark surface coming from a colour value shifting
rather than from a shadow darkening (which reads as a hole, not a lift, once the background itself
is dark), is the same instinct behind V3's single `--shadow-elevated` token being redefined per
palette rather than reused as one literal value: `--shadow-elevated` in dark mode is already
`color-mix(in oklab, var(--dark-paper) 70%, transparent)`, a lighter-than-background wash rather
than a black shadow, Material's own logic arrived at independently.

**Leave** Material's overlay is graduated, a different, brighter alpha at each of several elevation
levels, the multi-tier system V3 explicitly rejected in favour of one flat token spent only on what
genuinely floats (the popover, the dialog, the sheet, the dropdown, the Loremaster dock); adopting
a ladder would reopen the "eleven elevated boxes read as a dashboard" problem V3 exists to close.

## Apple Human Interface Guidelines — Dark Mode as one systemwide setting, and its contrast floor

**Maps to** the dark palette as a whole-app preference, the accessibility floor (G1, V3)

Apple's own Dark Mode guidance opens with the position G1 already took: "avoid offering an
app-specific appearance setting. An app-specific appearance mode option creates more work for
people because they have to adjust more than one setting to get the appearance they want. Worse,
they may think your app is broken because it doesn't respond to their systemwide appearance
choice." Its own dark palette runs two named background tiers, base and elevated, "base colors are
dimmer, making background interfaces appear to recede, and elevated colors are brighter, making
foreground interfaces appear to advance," switched automatically by the system when a popover or
modal sheet becomes the foreground surface. On contrast, the same page states a floor and a target:
"make sure the contrast ratio between colors is no lower than 4.5:1. For custom foreground and
background colors, strive for a contrast ratio of 7:1, especially in small text."

**Evidence** https://developer.apple.com/design/human-interface-guidelines/dark-mode (Apple's own
HIG Dark Mode page, "Best practices" and "Dark Mode colors" sections)

**Take** the "app-specific appearance setting confuses people" argument is worth having on file as
outside confirmation of G1's own "dark is not a table-mode skin, it is half the design system"
call, since it is the same argument made from the opposite direction: a product with per-surface
theming is the failure mode, not an alternative worth considering. The 4.5:1 floor and 7:1
aspiration for custom colours is a concrete number to hold `--color-muted` and prose links against,
the same two #469 already found under AA in this codebase.

**Leave** Apple's base/elevated distinction is automatic and system-driven, the OS decides when a
surface is "elevated" as it becomes the foreground window, which assumes a windowing model this
product does not have; a two-tier background scheme would need its own manual trigger here, and
V3's own single `--shadow-elevated` token already does the job with less machinery for a browser
tab that never has a second window stacking on top of it.

## Butterick's Practical Typography — measure, and what makes a figure line up

**Maps to** the reading measure for canon prose, tabular figures in a serif interface (A1, V1, G2)

Butterick's own rule for line length is a number, not a feeling: "aim for an average line length
of 45-90 characters, including spaces," with a fallback test that needs no software, "you should be
able to fit between two and three alphabets on a line." His page on alternate figures draws tabular
versus proportional as one axis and lining versus oldstyle as a second, independent one, and states
plainly that "tabular figures are essential for one purpose: vertically aligned columns, like you
find in grids of numbers," with a test anyone can run without a font inspector: "type a line of
zeroes above a line of ones... if they're the same length, then your font has tabular figures." His
page on grids of numbers gives the rule those figures serve: "in any column, digits with the same
meaning must be vertically aligned with each other," and different number kinds (a quantity, an
ordinal, a nominal identifier) take different alignment and formatting because they mean different
things.

**Evidence** https://practicaltypography.com/line-length.html,
https://practicaltypography.com/alternate-figures.html,
https://practicaltypography.com/grids-of-numbers.html (Butterick's Practical Typography, the Line
length, Alternate figures and Grids of numbers chapters)

**Take** 44rem for a reading-width route is roughly 68-74 Literata characters per line at the body
size, inside Butterick's 45-90 range and close to his own "two to three alphabets" heuristic; that
arithmetic is worth writing down next to V1's own measurement so "44rem" reads as a chosen number
rather than a round one. His zero-over-one test is worth adding to `/dev/ui`'s type gallery as a
literal, visible proof that `tabular-nums` is doing something in Literata, since G2's own decision
only asserts it, it never shows it.

**Leave** his preference for lining over oldstyle figures inside a grid, "because of their vertical
consistency," is already the default in most system and web fonts and is not itself a decision
Canonry has to make; G2 already settled the harder question (tabular figures everywhere numbers
appear in a column), and revisiting lining versus oldstyle for its own sake would be relitigating a
question nobody asked.

## iA Writer — reading distance decides the size, not preference

**Maps to** the reading measure for canon prose, and the body-size argument behind G2's numeric
columns (A1, V1, G2)

iA Writer's own argument for its type sizes is physical rather than aesthetic: "the size of your
body text doesn't depend on your personal preference. It depends on reading distance," illustrated
with two letters of identical metric size that read as different sizes once one is held further
from the eye. On serif specifically: "against common beliefs, both serif and sans serif can perform
equally well, if you choose a body text size above 12 pixels. Below 12 pixels serifed typefaces
don't render sharply enough." On line height: "with more reading distance... it's wise to give
screen text a little bit more line height than printed text. 140% is a good benchmark, but of
course, it depends on the typeface you use." And on measure: "optimal readability requires a
certain amount of control over the measure (column width) of the text," which is why the piece
argues for "adaptive with as few break points as possible" over a fluid layout that lets the line
grow with the viewport.

**Evidence** https://ia.net/topics/responsive-typography-the-basics (iA's own blog, "What Size?",
"Line height and contrast" and the responsive-layout argument)

**Take** `--text-body`'s 1.5rem line height on 1rem type is exactly 150%, inside iA's stated 140%
screen benchmark, and citing this page next to that ratio in `layout.css`'s own comment turns 150%
from an unexplained number into a defended one. "Reading distance decides size, not taste" is also
the right answer for a future GM who asks for a font-size preference: the product already has one
considered size, and adding a slider would be optimizing for the wrong variable.

**Leave** iA's own conclusion from this argument is to refuse a user-facing type-size setting
entirely ("what we want is that iA Writer works without settings"), further than Canonry needs to
go: the reading room's accessibility floor still has to let a reader's OS-level text-size preference
through, iA's refusal is about a bespoke in-app slider, not about honouring the platform's own
accessibility setting.

## Google Fonts — Literata's own specimen, and the version question it raises

**Maps to** Literata shipped with the app (V10)

The specimen Google itself publishes states Literata's origin and intent in one line: "Originally
created as the brand typeface for Google Play Books, it exceeds the strict needs of a comfortable
reading experience on any device, screen resolution, or font size." It also states something
decision V10 does not mention: "Two versions of the family exist, one for print and the other for
Ebooks. This is the print version of the family," meaning the specimen Google Fonts serves, and by
extension whatever a self-hoster downloads from it, is specifically the print-optimised cut rather
than the screen-tuned Ebook cut Play Books itself actually reads with.

**Evidence** https://fonts.google.com/specimen/Literata (Google Fonts' own Literata specimen page,
its description paragraph and version note)

**Take** the "brand typeface for reading, not a generic serif" origin story is worth a sentence in
V10's own write-up as the reason Literata beat Source Serif 4 on more than warmth: it was
purpose-built for the exact use case, long-form reading on a screen a reader did not choose the
resolution of, rather than adapted to it afterward.

**Leave** the print-versus-Ebook distinction is a real open question this file cannot close on its
own: whichever `.woff2` actually got self-hosted under V10 should be checked against which of the
two cuts it is, since "warmer on paper than Source Serif 4" was judged from a rendering that may
not be the same optical cut Play Books itself ships to a phone screen.

## The CSS spec — tabular figures are a font feature, not a font

**Maps to** tabular figures in a serif interface (G2)

The CSS Fonts specification, as MDN documents it, makes tabular versus proportional one axis of
`font-variant-numeric` (`tabular-nums` or `proportional-nums`) entirely independent of
`lining-nums` versus `oldstyle-nums`; the property "controls the usage of alternate glyphs for
numbers, fractions and ordinal markers" and inherits, applying to text generally including
`::first-letter` and `::first-line`. `tabular-nums` maps directly to the OpenType feature tag
`tnum`, the same feature Butterick's own zero-over-one test is checking for; the value has no
effect at all if the loaded font never shipped that OpenType table, a fact about the specific font
file, not about the CSS declaration being correct.

**Evidence** https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric (MDN's own
reference page for `font-variant-numeric`, the value list and the formal syntax)

**Take** the spec confirms that G2's global `font-variant-numeric: tabular-nums` in `layout.css` is
a request the browser passes straight to the font's own `tnum` table, so the entire guarantee that
entry ages, revision counts and the entries table's row numbers actually line up rests on Literata
itself shipping that table; that is a one-line fact worth a comment next to the declaration, since
right now the rule reads as self-evidently correct when it is conditional on the font file.

**Leave** the spec also defines `oldstyle-nums`, `diagonal-fractions`, `stacked-fractions` and
`slashed-zero`, none of which G2's decision asked for and none of which this product has a use case
for; the axis worth caring about here is exactly the one G2 already named, tabular versus
proportional, and reaching for the rest of the property's vocabulary would be scope nobody
requested.

## Shopify Polaris — one density per page, never mid-page

**Maps to** the density of the working surfaces (V3)

Shopify's own app design guidelines state a density rule as a single sentence with a named failure
mode: "avoid changing information density within a single page, otherwise your app can feel
disjointed," alongside the general instruction to "use looser spacing for low-density layouts, use
tighter spacing for high-density layouts" depending on the task. The same page grounds all of it in
one number, "the Shopify admin is built on a 4px spacing grid," so that whatever density a given
surface picks, its spacing still resolves to multiples of a single unit.

**Evidence** https://shopify.dev/docs/apps/design/layout (Shopify's own developer documentation,
the "Information density" and "Spacing" sections)

**Take** "never change density mid-page" is worth stating as an explicit rule in V3's own component
guidance, not just as an emergent property of using the shared tokens correctly: a settings pane
that mixes a dense table with an airy form on the same screen would violate this even while every
individual size on the page is a valid token, exactly the kind of defect a token audit alone would
not catch.

**Leave** Polaris still lets density vary page to page across the whole product (an index table is
high-density, a curated dashboard is not), a per-surface choice V3's own "one step up and flat"
made once for the entire app rather than leaving open; that is a stricter, more defensible position
for a product this size than Polaris's own per-surface latitude.

## Gmail's Comfortable, Cozy and Compact — a density setting, named honestly

**Maps to** the density of the working surfaces, as the anti-pattern to not repeat (V3)

Google's own 2011 announcement of Gmail's density setting is candid about the trade-off in a way
most design-system documentation is not: "Comfortable is the spacing that we recommend for most
people... Compact is the densest setting and matches the line spacing that existing Gmail users are
used to... Cozy is somewhere in the middle." Its author, a Google UX designer, calls the mechanism
exactly what it mathematically is: "the density setting is really a ceiling function," meaning each
level caps how loose the layout is allowed to get as the window grows, rather than fixing an
absolute size.

**Evidence** https://groups.google.com/g/gmail-blog-posts/c/CTvQcH69O-I (the Official Gmail Blog's
own 2011 post, "Changing information density in Gmail's new look," archived on Google Groups and
posted by Gmail UX designer Jason Cornwell)

**Take** naming a density level by what a reader gets, rather than by a generic "small/medium/
large," is worth borrowing in prose if this product ever needs to describe its own single density
choice to a GM in settings copy: "the density that keeps a proposal's evidence on the page" reads
better than "compact."

**Leave** Gmail shipped three settings precisely because two audiences (people who wanted the new
airy default, and existing users who wanted the old cramped one back) both had a legitimate claim
on the product; V3 deliberately closed that door for Canonry with one density for the whole app,
and offering a Comfortable/Cozy/Compact choice here would reopen a debate V3's own decision text
already settled, with the added cost of three surfaces to keep visually correct instead of one.

## Linear — "structure should be felt, not seen," and a warning about ungoverned tokens

**Maps to** the density of the working surfaces, micro-interactions and elevation feel (V3, V9)

Linear's own account of its latest visual refresh names its density problem in almost the same
words this decision set uses: "Linear is designed to surface exactly what you need, when you need
it. The challenge was preserving that rich density of information without letting the interface
feel overwhelming." Its answer runs on two stated principles, "don't compete for attention you
haven't earned" (a sidebar dimmed a few notches once its orientation job is done, tabs made more
compact with smaller icons) and "structure should be felt not seen" (borders rounded and softened,
with fewer of them, so separation reads without becoming its own visual layer). The same post also
describes building an internal, AI-assisted colour tool that let "anyone at Linear" nudge the hue,
chroma and lightness of individual design tokens ad hoc and share a preferred "recipe."

**Evidence** https://linear.app/now/behind-the-latest-design-refresh (Linear's own product blog, "A
calmer interface for a product in motion," March 2026, the "What changed in the interface" and "The
tools that helped us move faster" sections)

**Take** "structure should be felt, not seen" is a good one-line test for V3's own hairline rule
above a settled proposal: the rule should register as "something ended here" without drawing the
eye the way a full card border used to. Dimming a surface once its orientation job is done (the
sidebar, once a route is loaded) is a plausible, small addition to the working-surface list V9
already opened, worth a line in `MOTION.md`'s own inventory rather than a new decision.

**Leave** Linear's own internal token-tuning tool, letting anyone nudge a token's colour by feel and
ship a "recipe," is precisely the ungoverned, per-person tuning that produced this codebase's own 66
arbitrary sizes across 34 files; V3 exists because nobody had a name for what they were changing,
and a slider that makes changing a named token easier without a decision behind it would
reintroduce the same failure mode with better tooling.

## GitHub Primer's `KeybindingHint` and shadcn's `Kbd` — a hint, never the accessible name

**Maps to** the `key-hint` component (T5)

Primer's own `IconButton` documents a `keybindingHint` prop, a string or array of strings, whose
own description is explicit about what it is not: it "does not bind any keybindings for this
button, this is only for visual hints," rendered inside the control's own tooltip, paired with
`description` ("if description is provided, we will use a Tooltip to describe the button. Then
aria-label is used to label the button") so the accessible name and the visual shortcut hint are
two separate, deliberately distinct pieces of markup: `<IconButton icon={InboxIcon}
aria-label="Notifications" description="You have unread notifications" keybindingHint="G+N" />`.
shadcn's own `Kbd`/`KbdGroup`, added to its component set in 2025, takes the opposite shape: a thin
wrapper around the native `<kbd>` element with no props beyond `className`, meant to sit inside a
`Button`'s own label, inside a `Tooltip`'s content, or beside an `InputGroup`'s search field,
carrying no accessible-name logic of its own at all; its own docs show it used for a literal `⌘`
`K` pair beside a search input with the accessible name left entirely to the surrounding markup.

**Evidence** https://primer.style/product/components/icon-button/ (Primer's own IconButton docs,
the `keybindingHint` prop table and its "May be activated by a keyboard shortcut" example),
https://ui.shadcn.com/docs/components/base/kbd (shadcn's own Kbd docs, the Button, Tooltip and
Input Group composition examples)

**Take** both systems agree on the load-bearing rule our own `KeyHint` already follows: the glyph
is decoration, the accessible name lives somewhere else (Primer's `aria-label`, shadcn's
surrounding label text or Tooltip content, our own translated verb printed right next to the key).
That is worth stating explicitly in `key-hint.svelte`'s own doc comment as a confirmed convention
rather than an implicit choice, since two independently-built systems landed on the identical
boundary.

**Leave** Primer's version is real machinery, a prop that composes into whichever tooltip the
button already has and normalises `Mod+Z` into a platform glyph automatically; shadcn's is closer
to what `KeyHint` already is, a styled `<kbd>` with no logic. Building Primer's platform-
normalising layer on top of `KeyHint` is more component than T5 asked for, since `$lib/keys.ts`
already owns per-platform key text and hands `KeyHint` a plain string.

## shadcn's theming docs and Radix Themes — what a vendored control layer assumes about tokens

**Maps to** the token layer the control library is vendored into, and the `key-hint` shape it
composes with (V3, T5)

shadcn's own theming docs assume paired tokens by construction: "semantic background and foreground
pairs. The base token controls the surface color and the `-foreground` token controls the text and
icon color that sits on that surface," with the background suffix omitted on the base token itself
(`primary` pairs with `primary-foreground`, never `primary-background`). Its full default scaffold
names twenty-some such pairs (`card`, `popover`, `sidebar`, `chart-1` through `chart-5`) as CSS
custom properties consumed under `:root` and `.dark`, with a derived radius scale (`--radius-sm`
through `--radius-4xl`) computed off one base `--radius` value, the exact `calc()` pattern already
vendored into `layout.css`. Radix Themes, the primitive layer shadcn's own component heritage sits
near, organizes its tokens into named categories rather than a flat list: Color, Typography,
Spacing, Radius, Shadows, Cursors, each documented on its own page, with a single `Theme` component
exposing `accentColor`, `grayColor`, `panelBackground`, `scaling` and `radius` as the whole public
surface.

**Evidence** https://ui.shadcn.com/docs/theming (shadcn/ui's own theming documentation, "Token
Convention" and the full default theme CSS scaffold), https://www.radix-ui.com/themes/docs/theme/overview
(Radix Themes' own overview, the Tokens section)

**Take** the foreground/background pairing convention is already how `layout.css` treats its own
reading-room palette (`--color-paper`/`--color-ink` and friends), so vendoring shadcn's components
cost nothing extra on that axis; that is worth stating plainly as confirmation rather than assumed,
the same way an earlier round's own amendment checked the dark-mode mechanism (`.dark` class versus
`[data-theme='dark']` attribute) before restyling anything.

**Leave** Radix Themes' own `Shadows` token category, and shadcn's own reliance on a
`shadow-elevated`-style token for its popover and dialog defaults, assumes a system with several
shadow depths available to reach for; V3's decision to keep exactly one, spent only on what floats,
means every vendored component's own default shadow classes still have to be audited and overridden
down to that one token rather than left as shipped, a cost neither library's docs mention because
neither assumes a one-shadow system.

## What I would build from this

- Add a numeric-defense comment beside `--transition-duration-fade`/`-move` in `layout.css` citing
  Atlassian's interaction (50-150ms) and transition (150-400ms) bands and Carbon's moderate tier
  (150-240ms), so 140ms and 200ms read as chosen rather than invented (Atlassian, IBM Carbon).
- Write Q6's rule 4, "don't make people wait behind an animation," alongside Apple's own phrasing of
  the same rule directly into `MOTION.md`, since a second, independently-arrived-at source is the
  strongest defense a house rule can have (Apple HIG).
- Add Butterick's zero-over-one tabular-figures test as a literal, visible check in `/dev/ui`'s type
  gallery, so G2's `tabular-nums` claim is demonstrated on Literata rather than merely asserted
  (Butterick).
- State the reading route's 44rem against Butterick's 45-90 character range and iA Writer's 140%
  line-height benchmark in the same `layout.css` comment block that already documents `--text-body`,
  turning two unexplained numbers into two defended ones (Butterick, iA Writer).
- Add a "never mid-page" rule to V3's own component guidance in plain words, since a settings pane
  that mixes a dense table and an airy form can pass a token audit while still breaking the rule
  Shopify's own docs name explicitly (Shopify Polaris).
- Note in `key-hint.svelte`'s doc comment that the glyph-is-decoration, name-lives-elsewhere split
  is a convention two independently built systems (Primer, shadcn) both converged on, not a
  Canonry-only choice (GitHub Primer, shadcn).
- Extend V9's working-surface list with Linear's own "dim once oriented" pattern for the sidebar, a
  plausible next case for the same crossfade token the pending-count badge already uses (Linear).
- Flag the Literata print-versus-Ebook cut question raised by Google's own specimen page as an open
  item under V10, since "warmer than Source Serif 4" was judged from a rendering that may not match
  the self-hosted file (Google Fonts).

## Anti-references

- Gmail's Comfortable/Cozy/Compact density setting: three surfaces to keep correct instead of one,
  built specifically because two audiences disagreed after a redesign. V3 already closed that door
  with a single density for the whole app, and reopening it would relitigate a decision on record
  rather than solve a new problem.
- IBM Carbon's per-element dynamic duration, computed from an element's own travel distance through
  a dedicated Motion Generator tool, is the opposite of Q6 and V9's two flat tokens that never vary;
  adopting it would ask every component author to calculate a number before shipping a transition,
  the exact overhead two named tokens exist to remove.
- Material's graduated per-elevation overlay, a distinct, brighter surface tone at each of several
  elevation levels, is the multi-tier system V3 rejected in favour of one flat `--shadow-elevated`
  token; copying it would resurrect the "eleven elevated boxes read as a dashboard" problem V3
  exists to close.
- Linear's own internal, AI-assisted colour-tuning tool, which let "anyone at Linear" nudge a design
  token's hue, chroma and lightness ad hoc and share a "recipe," is the same ungoverned per-token
  tuning that produced this codebase's own 66 arbitrary sizes across 34 files; better tooling for
  changing a token without a decision behind it is not the fix V3 asked for.
