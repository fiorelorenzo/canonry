# Canonry UX decisions

The record of what was decided, when, and what each answer costs the issues that
depend on it. `docs/ux/index.html` is the audit and the register, one artifact per
question with the options drawn; this file is the answer set in prose, so it can be
read in a diff and quoted in an issue.

## Decisions that changed the spec

**Guardrail 1's wording, tightened 2026-08-13.** G6 found that SPEC 3 could be read
as permitting a bulk accept, and D3's own mock had read it that way and grown an
"Accept all 19" button. Section 3 now names exactly one exception, a field a re-import
writes because the source changed and the user never touched it, on the grounds that
the merge engine and not a model made that write. Everything else a model produces
waits for a human, however it is grouped on screen. `AGENTS.md` carries the same
wording in short form. G6 itself, whether that bucket is informational or reviewable,
is still open.

**Nine rounds, 66 answers, and a tenth round still open.** Round one, 38, and round two, the 11
questions those answers opened, were both taken on 2026-08-13; round three's 2 on 2026-08-14;
round four's 10 and round five's 1, both on 2026-08-15; round six's 1 and round seven's 1 on
2026-08-16; round eight's 1 and round nine's 1, both on 2026-08-19. Rounds one to three answered
questions asked before there was code. Round four came out of the shipped UI and is recorded
further down in this file, with its audit in [`product-pass.html`](product-pass.html). Rounds
five to nine have no separate audit artifact: each is one question forced by something the
shipped product already did, not a page of drawn options, and all five are recorded at the
bottom of this file. Round ten, at the very bottom, is four questions with drawn options and no
answers yet.

To change a decision: edit this file and the `UX_REGISTER` entry in
`docs/ux/assets/ux.js`, and say so on the issues it blocks. The artifact keeps its
options and its rejected section either way, because the reasoning behind a rejected
option is what stops it being reopened in six months.

## Round one

### Foundations

| Id | Decision | Chosen |
| --- | --- | --- |
| A1 | Visual language and density | **B, reading room.** Warm paper, serif for canon prose and entry titles, burnt umber accent, a hue reserved for the copilot. Amended round eleven: that hue is no longer violet, see P1 |
| A2 | Information architecture | **A, fixed sidebar** with the universe switcher on top, capped at seven items, the palette as overflow |
| A3 | Palette and keyboard | **C, one box** that routes a typed question to Ask instead of answering inline. Amended: the shortcuts have to be cross platform |

### Canon

| Id | Decision | Chosen |
| --- | --- | --- |
| B1 | Entry page anatomy | **C, document plus a switching right column**: relations, facts, images, history |
| B2 | Editor and mentions | **C, markdown with live decorations.** Amended: a graphical menu for anyone who does not want to type markdown; round twelve's Q4 makes that menu icon buttons with a tooltip each, and adds a preview, since decoration is not a preview |
| B3 | Relations and inference | **A, in the margin**, with one-click confirm and retype |
| B4 | Facts and provenance | **B, on demand.** Facts closed by default, a permanent non-violet human against ai-accepted badge in history |
| B5 | Works and scenes | **A, tree beside a scene editor**, with the affected-scene signal read only |

### The copilot loop

| Id | Decision | Chosen |
| --- | --- | --- |
| C1 | AI text marking | **B, underline and margin marker.** Unaccepted wording never enters the entry's own reading flow. The mechanism is unamended; only its hue moved, see P1 |
| C2 | Proposal routing | **A, an inbox**, with a quiet arrival signal and never a modal |
| C3 | The plan | **A, flat checklist** ordered by relevance, entries droppable before any diff is written |
| C4 | Diff layout | **C, in place**, and the toggle is repealed by round twelve's Q1: every changed part shows at once with its context. Amended round eleven: the diff has its own colour, distinct from C1's marking, see P3 |
| C5 | Evidence | **B, popover on the changed text**, forced open where nothing but weak evidence backs the candidate. Amended (#270): weak means embedding similarity, or the GM's own request for a proposal made from Ask, and the popover names which of the two |
| C6 | Accept and reject | **B, keyboard queue**, `j k a r u`, buttons always visible |
| C7 | Reject reasons | **A, chips with a free text escape** |
| C8 | Ask mode | **B, command palette.** Amended: the palette launches the flow, an answer can move into a dedicated page, a source click goes to that entry |
| C9 | Audit flags | **B, a badge on the entry**, reading the same flag list an aside section shows |
| C10 | AI off | **B, per universe** |

### Import and onboarding

| Id | Decision | Chosen |
| --- | --- | --- |
| D1 | Source selection | **C, detect then confirm** |
| D2 | Estimate and run | **B, live feed of proposals**, so review starts before the import ends |
| D3 | The dry run | **A, four bucket cards.** Conflicts never get a bulk control |
| D4 | Import review | **B, one queue** in C6's vocabulary, with type filters |
| D5 | Field conflicts | **A, two columns**: keep mine, take theirs, keep both, edit now |
| D6 | The matching question | **B, collected** and asked as one batch before the dry run, with no similarity number shown |
| D7 | Onboarding | **A, import first**, with the pre-indexed universe path as the fallback |

### Table and players

| Id | Decision | Chosen |
| --- | --- | --- |
| E1 | Table mode | **B, a mode the whole app switches into** |
| E2 | Lane latency | **A, progressive arrival with a quiet marker.** No spinner, no promised time |
| E3 | Quick actions | **C, two-tier dock** |
| E4 | Phone | **A, bottom tabs** |
| E5 | Reveal | **C, session log confirmed after the table breaks** |
| E6 | Secrets | **A, inline block typed in place**, with a preview toggle |
| E7 | Players wiki | **C, undiscovered shown as a gap page** |

### Media, money and meta

| Id | Decision | Chosen |
| --- | --- | --- |
| F1 | Image generation | **C, one action** that always confirms the spend |
| F2 | Quota and cost | **A, a meter in the shell**, carrying the included quota and the warm budget separately |
| F3 | Privacy and keys | **C, contextual**, at the moment content leaves, linking to a settings panel |
| F4 | Export | **A, flat zip in Settings, unadvertised** |
| F5 | Metrics | **B, an admin surface** inside the product, per playbook rather than aggregate |
| F6 | Landing | **C, the demo as the hero**, no copy above it |

## The three amendments

**A3, cross-platform shortcuts.** The single palette box stands, and the shortcut
vocabulary has to work on macOS, Windows and Linux rather than being invented per
component. The modifier map, whether bare keys are allowed inside review surfaces
(C6 uses `j k a r u`), and what happens on a layout where `[` and `/` need AltGr,
are G3.

**B2, a graphical menu next to the markdown.** Markdown stays the stored form, which
is what keeps F4's export lossless, and a graphical menu covers everyone who does
not want to type it. Not a beginner's crutch: on an Italian keyboard `[` needs
AltGr, so the `[[` mention trigger is awkward for the person who owns this product.
The menu's shape is G4.

**C8, the palette launches Ask.** Three parts: the palette starts the flow, an
answer can be moved into a dedicated page, and clicking a source goes to that entry.
What the page is for, and whether following a source abandons the answer you are
reading, is G5.

## Where the decision went against the artifact's recommendation

**A1: B rather than A.** This is the consequential one, because it repaints
everything. The reading room is the only one of the three options that shipped no
dark theme and no density suited to review queues, and the copilot's surfaces are
all queues and diffs. Both halves come back as decisions rather than assumptions:
the dark palette is G1, the serif boundary on dense surfaces is G2. The shared
stylesheet has already been cascaded, so every mock in the set now renders in the
reading room and the mocks in A1 keep their comparison by scoping the other two
skins locally.

**F4: A rather than C.** Flat zip, in Settings, unadvertised. That settles the shape
of export and leaves its purpose unserved: SPEC 13 ships markdown export on day one
to answer the lock-in objection Realm Works burned into this community, and a feature
nobody is told about answers nobody. G10 asks where, if anywhere, that gets said out
loud.

## Round two, decided 2026-08-13

| Id | Question | Chosen |
| --- | --- | --- |
| G1 | Does table mode go dark, or does the reading room stay light? | **B, dark as a whole-app preference.** A setting for the entire product, prep included, and table mode inherits whatever the preference already is |
| G2 | Where does serif stop? | **C, serif everywhere**, down to the number columns, with no boundary rule to argue about |
| G3 | Which keys, on three platforms? | **B, bare keys inside a focused review surface** (`j k a r u`), modifiers everywhere else |
| G4 | Which shape does the formatting menu take? | **A, an always-visible toolbar**, which depends on no trigger character |
| G5 | What is the Ask page, and what does a source click do? | **A, expand in place, amended**: a source click opens a side panel holding that entry, no preview and no navigation |
| G6 | Do the 19 unchanged-field updates need an accept? | **A, informational, no accept.** Already in the spec: guardrail 1 names this as its one exception |
| G7 | What do players see before the log is confirmed? | **C, live for what the GM taps**, the log for everything else |
| G8 | Do proposals arrive during play? | **B, propagation keeps running**, the inbox stays silent in table mode, the count rides on the way out |
| G9 | What does off cover? | **A, generation stops, retrieval keeps reading.** Semantic search, mention suggestions and a derived universe's base-corpus read all continue |
| G10 | Where is the lock-in answer said? | **A, one sentence below the landing demo**, plus a docs page |
| G11 | How often does the product ask before spending? | **A, confirm every paid action** |

### The amendment

**G5.** Expand in place stands: "expand this answer" grows the streamed answer onto its
own route and nothing is saved. What changed is the source click. No popover preview,
no navigation away: it opens a side panel holding that entry with the answer still
readable beside it, which is A for the page and C for the click. #53 therefore needs a
two-pane answer route, and #60's source card needs a panel target rather than a link.

### Where round two went against the recommendation

**G1: B rather than A.** Dark is not a table-mode skin, it is half the design system.
Every surface now has to be checked in both palettes rather than only the ones a GM
sees at a table, C1's marking and C4's diff colours included, and the preference needs
a home in Settings. Table mode stops implying a repaint at all.

**G2: C rather than A.** No boundary rule survives, which removes a whole class of
per-component argument and buys one real obligation: serif figures are proportional, so
numeric columns need tabular figures or they will not align, and identifiers, hashes
and code keep the mono face. Both belong to #104's token work.

**G9: A rather than B.** Reading is most of what makes this a good wiki, so keeping
retrieval alive with the AI off is defensible. It carries two costs the artifact itself
named: the meter keeps moving for a universe whose badge says off, and that universe's
content still leaves for an embedding provider. That makes the switch's name and the
sentence beside it load-bearing, which is the whole of round three.

## Round three, decided 2026-08-14

| Id | Question | Chosen |
| --- | --- | --- |
| H1 | What the switch is called when off still spends, and whether reading counts against the quota | **B's half, with a mechanism neither option had: reading is free, and every price lives in a table an admin edits** |
| H2 | The mark, the favicon, and what the brand may spend | **C, the tie: two entries and the link between them, drawn so the link is also the C** |

H1 was answered by removing the problem rather than by wording around it, and the
answer is larger than the question:

- **Reading is free.** Embeddings, semantic search, mention suggestions and the
  retrieval behind an Ask never draw on the user's quota. Charging for retrieval would
  make searching your own canon feel expensive, and retrieval is what makes this a wiki
  rather than a folder. G9's one real cost, a meter that kept moving for a universe
  whose badge said off, is therefore gone rather than accepted.
- **Generation is charged**: drafted entries, propagation plans and diffs, Ask answers,
  images, ambient layers, warm drafts, and an import's extraction per document.
- **The switch is named for what it stops.** Writing, not "AI", because with reading
  still running the word "off" was overclaiming. Guardrail 4 in `SPEC.md` now says this
  in the spec rather than only in a settings string.
- **Every price lives in `operation_price`**, one row per operation, editable from an
  admin panel, in effect without a deploy. A price of zero is how an operation becomes
  free, and an operation nobody has priced fails loudly rather than silently charging
  nothing. The pattern is ai-game's `credit_costs`, minus four of its choices: integer
  prices, a missing price returning null, no audit trail on a change, and a cache long
  enough that an admin edit looks broken.
- **Free to the user is not free to us.** A zero-credit call still records its tokens
  and its euro cost, because the margin question is answered from those rows and
  nowhere else.

In the spec at guardrail 4 and section 15, and built as issue #113.

## What these answers unblock

Every surface in the inventory has its gate answered, and no decision is open. #107's
switch has both its scope (per universe) and its meaning (stops generation), #88's
meter counts what the price table says, and the admin surface F5 chose now has its
first room.

Ready to start, with the decisions that govern them: #104 app shell (A1, A2, G1, G2,
G3), #105 entry and editor (B1, B2, G4), #106 AI marking (C1, in both palettes now),
#16 relations (B3), #17 and #18 facts and revisions (B4), #47, #50, #51 the proposal
model, plan and diff (C2, C3, C4, C5, C6, G3), #53 and #60 Ask (C8, G5), #55 audit
flags (C9), #107 the switch (C10, G9, wording from H1), the import surfaces #26, #27,
#30, #36, #37, #41 to #44 (D1, D2, D3, D5, D6, G6), #42 review (D4, C6), #108
onboarding (D7), #72 to #81 table mode (E1 to E4, G1, G8), #82 to #85 reveals, secrets
and the players wiki (E5, E6, E7, G7), #66, #71, #65 media (F1, G11), #88, #89 quota
(F2, G11), #90, #109 privacy (F3), #21 export (F4, G10), #100 to #103 metrics (F5),
and #3, #4 the landing page (F6, G10).

H2 was decided once both properties were public and wearing the browser's default
document icon, which is the moment a mark stops being decoration:

- **The mark is the product, not a metaphor.** Two entries and the tie between them:
  change one and it touches the other, which is the one thing Canonry does that nothing
  else does. It happens to read as a C, which is why the wordmark can sit beside it
  without the two fighting.
- **Two options were rejected for reasons worth keeping.** A seal with a C in it renders
  as the copyright glyph, and no stroke weight argues a reader out of that; underneath
  that it also claims an authority guardrail 7 forbids. A check in a frame was drawn
  precisely so nobody proposes it later: a check means verified, and this product says
  what does not add up rather than certifying that anything adds up.
- **The brand spends the accent and nothing else.** C1 reserves the copilot's own hue for the
  copilot (violet when this was written, mulberry since round eleven's P1), so the mark never
  borrows it: a logo in the copilot's hue makes every marked proposal mean slightly less.
  Burnt umber on paper, amber on ink, and the favicon carries a
  `prefers-color-scheme` block so one file serves both tab strips.
- **The wordmark is the product's own serif.** G2 allowed no exceptions and a logo is not
  one, which also retires the landing header's uppercase-with-tracking treatment.
- **The favicon is an SVG first**, with a generated ICO and PNG set beside it for the
  browsers and platforms that still ask. Every raster was rendered from that one file
  rather than redrawn, so there is exactly one place the geometry lives.

## Round four, decided 2026-08-15

The first three rounds answered questions asked before there was any code. Round four is
the other direction: I signed into the deployed preview as a new user, could not create a
universe, and audited every route to find out why. That audit is
[`docs/ux/product-pass.html`](product-pass.html), which is not a decision artifact but a
pass over the shipped UI, one section per surface, each with what ships today drawn
faithfully, its flaws with file and line, two or three options as working mock UI and a
recommendation.

**One diagnosis produced most of the ten.** The app shell exists only inside a universe:
`Sidebar.svelte` is mounted by `routes/u/[universe]/+layout.svelte` and nothing else, so
`/`, the auth pages, onboarding, `/u/new`, the five settings leaves, docs and privacy all
render as a bare column under a forty pixel bar. Eight routes have the frame and eighteen
do not, and the eighteen are every screen a new account meets before it has a universe.

| Id | Question | Chosen |
| --- | --- | --- |
| I1 | What the app serves at `/` to somebody signed out, now that the landing lives elsewhere | **B, a door page**: the spec's own sentence, sign in and create an account, and the links a visitor is owed |
| I2 | Sign in and sign up | **C for sign-in, B for sign-up**: one layout, the title page, with an optional right pane carrying the argument where somebody is deciding |
| I3 | The home page, signed in | **B, the shell reaches outside a universe**, with C's redirect as the zero-universe behaviour |
| I4 | Creating a universe | **B, one creation surface**: `/onboarding` absorbs `/u/new` and offers three starts |
| I5 | Where the language switch lives | **B, a row in the account menu**, endonyms, with the settings page behind it |
| I6 | The account, and five settings pages with no home | **B, an account menu in the shell plus one two-pane settings page**, with a real Account pane |
| I7 | The universe home, and the entry browser that was never built | **C, one page two modes**: the browser, with a collapsible overview strip above it. **Superseded by O1 on 2026-08-19**: two surfaces, a home at `/w/<slug>` and the browser at `/w/<slug>/entries` |
| I8 | Nine empty states, nine hand-written sentences | **A, one component, three variants**: cold start, settled, derived absence |
| I9 | Who owns the controls | **C, shadcn-svelte as the control layer**, with components of our own only where it has no answer |
| I10 | The phone | **B, one responsive shell**, E4's bottom tabs generalised past table mode |

**I7 no longer holds.** It is the only answer in round four that the shipped version of itself
argued out of: one page in two modes was more than the zero the product had, and having used it,
the strip is too small to be a home and the list is too plain to be a browser. O1 in round ten
replaces it with two surfaces. The rest of round four stands as taken.

### Where round four went against the recommendation

**I1: B rather than A.** The landing page is not missing. It ships from `canonry-landing`
at `canonry.io`, in English and Italian, with F6's demo as the hero and G10's export
sentence under it, so I recommended the app redirect a signed-out visitor straight to
sign-in and keep exactly one copy of the pitch. B keeps a door page instead, which is
friendlier to a bookmarked app domain and accepts the cost A avoided: two copies of the
argument in two repositories, and the app's copy is the one nobody will remember to
update. That makes the door's sentence a guardrail 7 surface in this repository too, not
only in the landing one.

**I9: C rather than B.** I recommended extracting six components of our own and reserving
shadcn-svelte for the three primitives that are genuinely hard. C takes shadcn for
everything, and the argument that wins is the one its own costs understated: the six B
would extract are the easy six, and the hard three are exactly what B leaves hand-rolled.
Four consequences, checked against shadcn-svelte 1.5.0 rather than assumed, and none of
them optional:

- **It expects its own token vocabulary.** `--background`, `--foreground`, `--primary`,
  `--muted`, `--border`, `--input`, `--ring`, `--radius` and the rest, declared through a
  Tailwind 4 `@theme inline` block. The reading room's names are `--color-paper`,
  `--color-ink`, `--color-line` and so on, so the first task is one mapping block in
  `routes/layout.css` from our names into theirs. One place, or every component gets
  restyled on arrival and A1 dies by a thousand paste operations.
- **Its dark variant is a class, ours is an attribute.** It ships
  `@custom-variant dark (&:is(.dark *))` and this app themes on `[data-theme='dark']`
  (G1, set server side in `hooks.server.ts` so there is no flash). Redefine the custom
  variant against the attribute; do not add a second dark mechanism.
- **The CLI copies source, it does not add a runtime dependency.** Components land in
  `$lib/components/ui`, which is what makes restyling them into the reading room ours to
  do and ours to keep. What it does add is `bits-ui`, `clsx`, `tailwind-merge`,
  `tailwind-variants` and an icon set, all MIT, so nothing here conflicts with AGPL
  distribution.
- **An icon set arrives as a dependency and is a design decision.** The product has no
  icon language today, only the mark and a few glyphs. Either Lucide becomes that language
  deliberately, in both palettes, or every component that reaches for an icon gets it
  replaced as it lands. G2's serif is safe by accident here, since `--font-sans` is the
  same lever in both systems and already points at the serif stack.

### What round four costs the shell

I3 and I6 together are the structural piece: A2's sidebar stops being a universe frame and
becomes the product's frame, with an account-level mode when no universe is selected and a
footer carrying the user, the theme, the language and F2's meter. A2 itself is not amended,
its seven items still describe a universe, but the answer to "what holds the nav" is now
"the whole product" rather than "a universe". I5, I6 and half of I1 all resolve into that
one piece of work, and I10's responsive pass is the same shell seen at 390px, so it wants
to land with it rather than after it.

Two findings in the pass need no decision and are defects: the home page renders "Sign in"
twice (`routes/+page.svelte:23-26` against `i18n/en.ts:955`), and "Match system" renders the
light palette on a dark machine because the dark tokens are bound to `[data-theme='dark']`
with no `prefers-color-scheme` block behind them, which `lib/theme.ts` documents rather than
fixes.

### The board these answers land on

It was empty. Every issue that built a surface named in the pass is closed, #104 the app
shell, #86 auth, #108 onboarding, #107 the writing switch, #88 and #89 the quota, so the
board said Done for a shell that does not exist outside a universe. Round four is therefore
filed as new work under a new epic, [#135](https://github.com/fiorelorenzo/canonry/issues/135),
rather than as reopened tickets:

| Issue | What | Decision |
| --- | --- | --- |
| #136 | The home page renders "Sign in" twice | defect, no decision |
| #137 | "Match system" renders light on a dark machine | defect, G1 |
| #138 | A door at the app root | I1 |
| #139 | The auth pages as a title page, with the argument beside sign-up | I2 |
| #140 | A new account lands on onboarding instead of an empty page | I3, the interim half |
| #141 | The shell reaches outside a universe | I3 |
| #142 | One creation surface for a new universe | I4 |
| #143 | An account menu and one settings page with a sub-nav | I6 |
| #144 | The language control in the account menu | I5 |
| #145 | The entry browser, with the overview strip above it | I7 |
| #146 | One empty state component, three variants | I8 |
| #147 | shadcn-svelte as the control layer | I9 |
| #148 | One responsive shell, phone included | I10 |
| #149 | The command palette | A3, G3 |
| #150 | The quota meter in the shell | F2 |

The last two are not round four answers. They are decided-but-unbuilt work the pass found
while looking for something else, and #149 is worth recording on its own: **the command
palette has never had an issue at all.** A3 and G3 answered it, `lib/keys.ts` carries the
whole cross-platform shortcut vocabulary including mod+K, nothing listens for it, and #75,
which this file's own register names against A3, closed having shipped table mode's instant
search instead.

### Built, 2026-08-15

All fifteen landed the same day the answers were taken, in `1e7b2d8`, and are closed. The
shell is the change everything else hangs off: `AppShell.svelte` is mounted by the root
layout and switches `Sidebar.svelte` between a universe mode and an account mode on whether
`page.data.current` is present, so nothing in the product renders without a frame any more
and `AuthStatus.svelte` is gone.

Four things surfaced while building and were filed rather than folded in, because each is a
decision rather than a task:

- **[#151](https://github.com/fiorelorenzo/canonry/issues/151), password recovery.** There is
  no mail transport anywhere in the app, so I2 shipped without the "Forgotten password?" link
  the artifact drew rather than with a link that goes nowhere. The transport wants choosing
  for email verification and universe invitations at the same time.
- **[#154](https://github.com/fiorelorenzo/canonry/issues/154), account deletion.** I6's
  Account pane ships name, email, password and sign out everywhere; deletion is a sentence
  saying it is not enabled. `universe.owner_user_id` cascades, so deleting an account destroys
  every universe under it, and doing that irreversibly with no confirmation channel is not a
  thing to enable quietly.
- **[#155](https://github.com/fiorelorenzo/canonry/issues/155), the control layer's gaps.** No
  select, and three badge meanings the variant set does not carry, so a handful of call sites
  stayed hand-written after I9's migration.
- **[#153](https://github.com/fiorelorenzo/canonry/issues/153), `/u/<slug>` is ambiguous.** Not
  a round four surface at all: slug uniqueness is per owner by schema, and
  `universeAccessBySlug` resolves a slug with no owner filter and no ordering, so the same URL
  can resolve to a different universe between two requests. It cost an hour of phantom 404s
  during this work before anybody realised the bug was not in the new code.

## Round five, decided 2026-08-15

Round four filed #153 as a defect, not a decision: slug uniqueness was scoped per owner by
schema, `universeAccessBySlug` resolved a slug with no owner filter and no ordering, and the
same URL could resolve to a different universe between two requests. Answering it turned out
to require answering a question round four never asked.

| Id | Question | Chosen |
| --- | --- | --- |
| J1 | What the top-level URL segments mean, now that user profiles are certain | **`/u/<handle>` a person, `/w/<slug>` a world, `/p/<slug>` the players' wiki** |

**Answered by a fourth way, not by picking among three.** #153 was framed as a scoping
question: global uniqueness, or resolution scoped to the viewer, my own preference going in.
J1 answers neither by changing what the segment means instead. `/u/` reads as a person
everywhere else on the internet, and this product only had it pointing at a universe because
profiles were hypothetical when A2 named the sidebar's switcher. They are not hypothetical
any more, filed as #158, so the segment goes to the thing it already reads as, and the whole
GM-side app moves to `/w/<slug>`, filed as #157, under epic #156.

**What that forces.** A world's URL still carries no owner: `/w/<slug>` is exactly as
ambiguous as `/u/<slug>` was unless world slugs become globally unique, so the move does not
dodge #153, it answers it. The argument that settles it, over my own preferred scoped
resolution, is `/p/<slug>`: that is the one link a GM sends to people outside the product, so
a slug cannot mean different things to different readers depending on who is asking. A slug
that resolves per-viewer is not a shareable URL, and `/p/<slug>` is exactly the surface
guardrail 6 governs: nothing unreviewed reaches a stranger there, and an ambiguous slug is
another way for the wrong world's content to reach one. Guardrail 5 makes the same argument
from data transparency's side: a slug is part of a URL somebody may share, so what it resolves to
cannot be a private fact about which account's rows a scan happened to visit first. Two
places in the code already assumed a slug resolves to exactly one universe before any of this
was decided: `PRE_INDEXED_BASE_SLUG` in `lib/server/onboarding.ts` resolves one fixed slug for
the shared catalogue with no owner in the query, and `loadPublicUniverse` in
`lib/server/players.ts` looks a slug up the same unfiltered way `universeAccessBySlug` does.
Filed as #153, the schema change that makes global uniqueness real.

**What it costs, stated plainly.** The first GM to take `valdoria-reach` takes it, globally,
and every GM after them gets a suffix instead of the name they typed. That is not new code:
`createOnboardingUniverse` already retries on a unique violation and appends a number, so the
collision path is exercised today, just against a per-owner index rather than a global one.
The cost is a name somebody wanted, not a broken flow, and it is accepted rather than
engineered around, because a slug that means one thing to one reader and another thing to the
next is the actual bug #153 exists to close.

**What does not change.** The domain word stays universe: `universe.slug`,
`universeAccessBySlug`, `params.universe`, and the `universe` strings in the i18n catalogue.
J1 moves a URL segment, not the model, and #157's route parameter keeps its name, so no
server code changes shape. And no compatibility redirect from `/u/<slug>`: the product is not
launched, canonry.io serves a waiting list, and every link that exists today is ours to
update. A permanent redirect would also collide with `/u/<handle>` the day #158 ships, which
is the whole point of freeing the segment deliberately rather than leaving a trap in it.

## Round six, decided 2026-08-16

| Id | Question | Chosen |
| --- | --- | --- |
| K1 | Are relation types a fixed catalogue or can the Loremaster invent them? | **Free labels, reconciled**: the model may propose any label, a resolver matches it against what exists, and creating a type is a proposal a GM accepts |

**The product already answered this twice, and differently.** `relation_type` is a table,
not an enum, `label` and `inverse_label` are `text`, unique per universe rather than drawn
from a fixed list (`packages/db/src/schema/relation.ts:9-22`). The import tool agrees: its
relation-propose input takes `label: z.string().min(1).max(200)`
(`packages/import/src/tools.ts:61-74`), and `findOrCreateRelationType` inserts whatever the
model said, once per label per universe, no accept in between
(`packages/db/src/queries/import.ts:728-756`, called from
`packages/import/src/job-runner.ts:675-682`). That is free. Meanwhile the shipped catalogue
is ten labels seeded by migration (`packages/db/migrations/0001_seed_relation_type_catalogue.sql`,
extended by `0029_containment_and_protects_relations.sql`), #173 added an eleventh the same
way, and `RelationsPanel.svelte` renders confirmed relations read-only with no affordance to
see, create or manage a type at all. That is fixed, and invisible on top of it. K1 does not
split the difference. It picks free, and spends the rest of the decision on what makes free
safe to ship.

**Why free wins.** A world's vocabulary belongs to the GM running it, not to a migration
written before any campaign existed. Ten labels cannot say everything a real campaign
already wrote down, and the shortfall is not hypothetical: `session` entities can carry no
relation at all today, because no shipped label admits one on either end, a gap
`0029_containment_and_protects_relations.sql`'s own notes leave open for lack of real usage
to design against rather than close by guessing. A fixed catalogue answers a gap like that
with a migration; free answers it the day a GM's world needs the word.

**Why free needs a reconciliation pass.** Free without reconciliation is not freedom, it is
noise: relation labels feed the propagation evidence and the reject signal
(`packages/copilot/src/propagate.ts:131`, prior rejections read back by their relation
labels), so "employs", "employer of", "works for" and "hires" stored as four separate types
leave the graph worse off than storing one. The resolver (#189) is the reconciliation
mechanism, cheapest check first. Normalised exact match against the universe's own types and
the shipped catalogue: case, whitespace, the obvious morphology. Then a match against a
type's own `inverse_label`, which resolves to that type with the ends swapped rather than
minting a second type. Then semantic match through the embedder, above threshold
`reuse-proposed` and below it `new-proposed`, with no similarity number ever shown to a GM,
the same rule D6 already settled for entity matching. Then, only once a label has resolved
to a type, the allowed-type check against this pair of entities, which comes back
`widen-proposed` rather than a silent write or an outright rejection. That last rung is also
#191's answer: `allowed_from`/`allowed_to` stop being read by nothing but tests and the seed
that fills them, and become one real constraint enforced at the write, on the shipped
catalogue and a universe's own types alike.

**A human sits on the write, because a type is bigger than an edge.** Guardrail 1 already
says nothing a model produces lands without an explicit accept, and a relation type is
content, not configuration, so it counts. `findOrCreateRelationType` writing a type mid-import
is the one place that rule is quietly broken today; #189 replaces it with a resolver that
only ever proposes, and #190 turns `reuse-proposed`, `new-proposed` and `widen-proposed` into
something a GM accepts or rejects, in D4's own review queue rather than a new one. #192 gives
the same accept its other door: a GM reading the catalogue directly can rename, merge or
widen a universe's own types by hand, and the ten shipped labels stay a migration's to edit,
not a settings control's.

**What it costs, stated plainly.** An import can now stop to ask a question a fixed
catalogue never had to: is this word a synonym of something you already have, or a new
relation altogether? That is an interruption free labels alone would not have produced
either, since free-without-reconciliation would have just written the row and said nothing.
It is worth asking only because #190 asks it once per label rather than once per relation,
twelve relations that all wanted "works for" are one question about vocabulary, not twelve,
and because the alternative this decision refuses is worse: a GM's world stuck at ten words
forever, or a product that keeps inventing them with nobody reviewing it, which is the bug
K1 exists to close.


## Round seven, decided 2026-08-16

| Id | Question | Chosen |
| --- | --- | --- |
| L1 | A relation label reads as interface, so a language switch should change it. Which labels, and how, without making anybody wait? | **Identity moves off the label.** A stable `key` carries identity, the ten shipped labels ship in the i18n bundle in every locale, and a universe's own labels display as authored |

K1 made relation types free. L1 answers what happens to them when the interface changes
language, and it starts by noticing that the label was doing three jobs and only one of them
was display.

**Why the naive fix is worse than the bug.** `relation_type.label` was the identity:
`unique (universe_id, label)` in Postgres, the value inside `proposal.evidence` paths
(`packages/copilot/src/candidates.ts`), what `reject-signal.ts` compares to decide a
candidate resembles something the GM already rejected, what `db-graph.ts` builds the
traversal on, and what the model reads in a prompt (`complete.ts`, `diffs.ts`). Translating
the display for the reader would have made all four vary by who was looking, which is
invisible and degrades the copilot's judgement rather than announcing itself. So the label
stopped being identity: a `key` column carries it, hand-picked for the ten shipped types
because they are API surface the day they ship, derived from the authored label for a
universe's own, and untouched by a rename. That last part fixed a bug nobody had filed:
renaming a type used to rewrite its identity and orphan it from its own history.

**Two kinds of type, opposite treatment, and that is the whole design.** The shipped ten are
product vocabulary: nobody wrote them, every world has them, and they belong in the i18n
bundle exactly like entity type names already are. Forty strings, written once by a person.
A universe's own types are the GM's words in the language their world is written in, so they
display as authored in every interface language, because SPEC 17 rule 3 keeps canon in its
own language and guardrail 1 forbids a model rewriting it.

**Nobody waits, because nothing is translated.** The constraint was that a language switch
must not make a GM wait for a translation, and the answer is not a faster translation, it is
no translation: the shipped labels repaint from the bundle with every other string on the
page, and a GM's own labels are already the right words. Where a bilingual GM wants their own
type in a second language, they write it themselves and it is stored, or the copilot proposes
one that waits for an accept like everything else. Nothing is computed in a request path, and
there is no place in the display path where a spinner could appear.

**What it buys beyond the language switch.** An Italian world could not use the shipped
catalogue at all: its first import proposed Italian labels, matched none of ten English
strings, and forked eleven duplicates of the catalogue every other world shares. Matching a
proposed label against every locale's strings fixes that, and it was only possible once the
labels lived somewhere with locales. Cross-language matching does lean on the embedding model
being multilingual, which this one is, and which the measurement behind #168 chose it for.

**What it costs.** Every non-display consumer had to move to the key at once, including 29
evidence rows already written, and the reject signal degrades to no match for a historical
label that maps to nothing rather than being guessed at. And the shipped keys are now frozen:
`located_in` cannot be renamed, only relabelled.

Built as epic #194 with #195, #196, #197 and #198.

## Round eight, decided 2026-08-19

| Id | Question | Chosen |
| --- | --- | --- |
| M1 | The product is built and `canonry.io` still says "coming". What is the landing page for now? | **A door, not a waiting list.** The page's job becomes getting a stranger into the product or into a world they can read, and the waiting list stops being the primary action |

**What changed is the product, not the page.** F6 chose the propagation demo as the hero and
G10 put the export sentence under it, and both still hold: nothing above the demo, one place
where the lock-in answer is said out loud. What has moved is everything behind them. When those
were decided there was no product to point at, so a waiting list was the only honest call to
action a page could carry. `app.canonry.io` now serves the whole thing, healthy, on a tagged
release, and a page that collects addresses in front of a working product is not cautious, it is
wrong: it asks people to wait for something they could be using.

**The order matters more than the page, and it is the part I want on the record.** Two things a
stranger needs on the day they can create an account, and neither exists yet: there is no
password recovery, so a forgotten password is a database query, and there is no account
deletion, so somebody who wants to leave cannot. Both were blocked on having no mail transport
at all, which is now bought and verified. So the sign-up call to action does not ship until
those do, and the page's first version can point at something a stranger can already read
without an account rather than at a form. That is available today: a published players' wiki is
a real public surface, and pointing at a real world is a better argument than a demo of one.

**The waiting list becomes a decision of its own rather than a leftover.** It has been
collecting real addresses into `waitlist_signup`, which records an address and a timestamp and
nothing about what the person agreed to. Either it becomes an explicitly named newsletter
opt-in, with the consent recorded at the moment it is given, or it is retired. What it cannot
do is quietly become a marketing list, because the people on it asked to be told when Canonry
launched, and reinterpreting that after the fact is exactly the kind of thing this file exists
to stop. The addresses already there keep the promise they were collected under, and if we want
more than that we ask them once.

**What this costs.** The landing repository and this one now both describe a launched product,
so I1's cost gets worse before it gets better: two copies of the argument in two repositories,
and the app's door page is still the one nobody will remember to update. And a page that
invites people in is a guardrail 7 surface in a way a waiting list never was, because copy that
promises a coherent canon is a defect and it is much easier to write that sentence when you are
selling than when you are explaining.

Tracked as `canonry-landing#9`, with `canonry-landing#8` for the consent record, and gated on
#151 and #154 in this repository.

## Round nine, decided 2026-08-19

| Id | Question | Chosen |
| --- | --- | --- |
| N1 | The propagation cap was a hardcoded ~10 with no arithmetic behind it. Does it become a per-universe setting, and what happens at the edges - no limit, and a GM who already said a plan was "too much"? | **A per-universe setting, 25 by default, with an explicit no-limit option.** Null means no limit, a real value rather than a sentinel, and the reject signal's floor of 3 never applies once the limit is off |

**The old number was a guess, and I could tell because nobody could point at the
arithmetic behind it.** SPEC 5.1 has said "~10 entries per plan" since the first draft,
cited only to the suggestion-fatigue research (`07`), which argues for *some* ceiling
and says nothing about which one. The right number depends on how connected a world is
and how much a GM wants to review in one sitting, which is what a setting is for rather
than a constant every universe inherits whether it fits or not.

**Nullable, not a sentinel.** `universe.propagation_cap` is a nullable integer: null
means no limit. I considered 0 and a very large number first, and both are worse. 0
collides with "cap the plan at nothing", a state `effectiveCap`'s own floor already
refuses to produce, so 0 could never safely mean two different things at once. A very
large number is a lie the moment somebody reads the column and asks what it means, and
it leaks into `planPropagation`'s `ranked.slice(0, cap)` as a real slice bound that
happens to never bind, rather than no slice at all - a distinction that matters the day
a candidate pool legitimately grows past whatever number was chosen as "basically
infinite". Null costs one extra branch everywhere the cap is read and buys a real value
for "no limit" that means the same thing in the column, in `effectiveCap`, in the
stored plan's own `candidate_cap`, and on screen.

**25, from what a plan actually costs.** `propagate.plan` is 1 credit, `propagate.diff`
is 1 credit per surviving candidate (migration 0004), so a plan is really a statement
about how many diffs the GM is agreeing to pay for if they generate all of them: a cap
of 25 bounds one save's worst case at 26 credits. Against the included tier's 5,000
credits per period (`packages/db/src/queries/subscriptions.ts`), that is 0.52% of a
period for the single largest plan one save could produce - generous enough that a
well-connected entity's real two-hop neighbourhood rarely gets truncated, and still a
real ceiling rather than a number nobody will ever hit. The old 10 bounded the same
worst case at 11 credits, 0.22% of a period: conservative enough that it was never
checked against anything, which is what made it a guess rather than a decision.

**The reject signal's floor stops applying when there is no cap.** `effectiveCap`
tightens the cap by one for each recent "too much", down to a floor of 3, so a plan
gets smaller as a GM says the copilot is too noisy but never disappears entirely. That
floor is a floor on tightening a real cap, not a minimum plan size the product owes
every GM regardless of what they asked for: a GM who explicitly turned the limit off
does not silently get three candidates back because they also rejected a few plans as
"too much" in the past. `effectiveCap(null, ...)` returns null, and `planPropagation`
reads that as no truncation at all, never a fallback number.

**What it costs.** The GM now sees a control that previously was not a control at all,
so a wrong number becomes a support conversation instead of a line in `SPEC.md`
somebody edits. `proposal_plan.candidate_cap` drops its `NOT NULL` for the same reason
`universe.propagation_cap` is nullable: it records the cap that was actually in effect
when a plan was written, and a plan written with no limit has to be able to say so
rather than lying with a number. `PlanChecklist.svelte`'s "3 of 3 kept, cap 10" becomes
"3 of 3 kept, no cap" rather than "cap null" when the setting is off.

Touches #50 and #56, and the migration is `packages/db/migrations/0038_special_enchantress.sql`.

## Round ten, decided 2026-08-19

Same direction as round four, from the shipped product back to the decisions rather than the
other way: I opened the preview, disliked four things, and drew the options instead of settling
any of them inside a component. Drawn in the morning, answered the same day, which is the whole
argument for drawing them.

| Id | Question | Chosen |
| --- | --- | --- |
| O1 | The world home is four small cells over a flat list. Is it big editorial sections, a browser that grows up, or two surfaces? | **C, two surfaces, honestly split.** A world home at `/w/<slug>`, and the browser as a dense table at `/w/<slug>/entries` |
| O2 | An entry has no cover image and a five-tab aside that clips its own last label at 256px. Where does the cover live, and what carries the structured layer? | **A, a cover band above the title, and the aside loses its tabs** for stacked collapsible sections. Amended round eleven: there is a placeholder after all, for a writer only, see P6 |
| O3 | Ask has three doors, all of which navigate away, and it remembers nothing. Does the copilot get a floating composer on every page, and what does the dedicated page become? | **A, a floating pill that expands in place.** Amended: the theme's own colours rather than the copilot's violet, and an icon to close rather than the word |
| O4 | Which control replaces a native select, and does one control fit both a two-option toggle and every entity in the world? | **B, three controls, chosen by what the list is** |

**Every one of the four took the recommendation**, which has not happened in any earlier round
and is worth reading as evidence about the questions rather than about the answers: these were
four surfaces I had already used and disliked, so the options were drawn knowing what was wrong
with what shipped, where rounds one to three were drawn before there was anything to be wrong.

### O1 amends I7, and this is where that is written down

I7 = C said the universe home is one page in two modes, the entry browser with a collapsible
overview strip above it. That is **no longer the decision.** `/w/<slug>` becomes a world home,
the browser moves to `/w/<slug>/entries`, and I7's row in round four now reads as superseded
rather than as taken. The reason is not that I7 was wrong on its own terms: it was answered
when there was no browser at all and one page was more than zero. Having used it, the strip is
too small to be a home and the list is too plain to be a browser, and the compromise landed as
neither.

Three things follow, and none of them is optional:

- **The sidebar and the world switcher have to pick a target.** Today's `Entries` item and the
  switcher both point at `/w/<slug>`, which now means the home. `Entries` points at
  `/w/<slug>/entries` and the switcher keeps the home, so a world switch lands on the home.
- **The table needs real pagination**, which the loader does not have: `+page.server.ts:76`
  takes up to 500 entries with no pages behind it. That is already a bug for a real world and it
  becomes a visible one the moment the page draws a footer that says "page 1 of 3".
- **The home's card thumbnails wait on O2.** They read `entity.cover_asset_id`, so the home
  ships its sections before its thumbnails if O2's migration has not landed yet, rather than
  inventing a second way to pick an image.

### O2, and the two amendments the artifact already carried

A as recommended, so the amendments in its own recommendation stand: the band is capped so it
never takes more than about a fifth of the first screenful, there is **no dashed placeholder**
for somebody who cannot write to that world, and the crop ratio follows the entity type the way
option B drew it, wide for a place, closer to square for a person, positioned rather than
stretched.

**The column is `entity.cover_asset_id`, nullable, `on delete set null`**, and not a `role`
column on `media_asset`. One cover per entity is a single fact about the entity, and a role
column invites two rows claiming it at once with nothing in the schema to stop them. The Images
panel grows a **use as cover** action, and that action is the accept: a generated image becomes
a cover because a person clicked something that says so, which is guardrail 1 holding without a
second mechanism. `published_to_players` still gates whether the cover appears on `/p/<slug>`,
because guardrail 6 has no exception for images and a cover is not a special case of one.

**The aside stops being a tab strip.** Five collapsible sections, each with its count in the
header, Relations open and Facts closed per B4, the column sticky with its own scroll. The
clipping at `EntryTabs.svelte:92-96` is fixed by there being no strip to clip, rather than by a
`truncate` that would still depend on how long a translated word happens to be. B1 = C is not
amended: the page is still a document plus a switching right column, and what changes is the
switch.

### O3, taken with four amendments from the recommendation and two of Lorenzo's own

The four the artifact recommended stand. **The pill mounts the palette's own input in a docked
placement**, so there is one input implementation with two positions rather than a second
composer beside A3 = C's one box; #149 grows that placement as a requirement and O3 is not built
by copying the palette's input into a new component. **It hides in table mode**, where E3 = C's
two-tier dock owns that corner. **It becomes a tab in the phone's bottom bar**, which E4 = A and
I10 = B already ship, rather than a circle drawn over the content. And **"keep" is the only
write**, which is what lets the dedicated page be called a history honestly: everything typed
and abandoned stays abandoned, exactly as closing the palette already loses it.

The two added on the pick are both about how it looks, and one of them cuts against a
convention, so it is written here rather than left to a component:

- **The pill and its panel wear the theme's own colours, not the copilot's violet.** The mock
  drew them in `--ai`, `--ai-bg` and `--ai-line`, and in the warm paper of the reading room that
  reads as a cold purple blob stuck to the corner. Warm paper, `--line`, `--ink`, umber accent,
  in both palettes per G1. **This does not repeal C1.** Violet stays reserved for AI text that
  nobody has accepted yet, and the answer streaming inside the panel keeps its violet marking:
  what loses the violet is the furniture, the button and the panel chrome, which was never AI
  text in the first place. The cost is real and accepted: the launcher no longer announces
  itself as the copilot by colour, so the name and the icon carry that job alone. Nobody should
  "fix" this back to violet later without reading this paragraph first.
  **Round eleven overtook the second half of this.** The furniture amendment above stands and was
  in fact under-applied, which P2 finished. What no longer holds is "violet stays reserved": P1
  re-derived that hue to `oklch(0.479 0.140 325)` because the marked text had the same problem as
  the pill, in the middle of the reading surface instead of in a corner. Read this paragraph for
  why the furniture lost the hue, and P1 for which hue it is now.
- **An icon closes the panel, not the word "Close".** The mock's text button is the only control
  in that corner competing with the answer for attention, and a close affordance is the one
  control a reader never needs a label for. It keeps an accessible name, so the label moves to
  `aria-label` rather than disappearing.

**What O3 still does not answer**, and what is therefore filed separately: what a kept answer is
stored in, how long it is kept, and what the guardrail 5 sentence beside it says. There is no
ask, answer or conversation table anywhere in `packages/db/src/schema` today, and
`ask/+server.ts:42-87` streams an answer and writes none of it, so "history" is new persistence
rather than a move. The word does not appear in any label until that issue lands.

### O4, and the rule that replaces a threshold

B, and the boundary is drawn by **what the list is rather than how long it is**, which is what
kills the argument before it starts: a binary or ternary state gets a segmented control, a
vocabulary the product itself ships gets a Select, and a list drawn from the GM's own data gets
a Combobox with search. No number to argue about at a review, and the unbounded case, the quick
note target and the precedence entry behind it, actually gets solved rather than surviving as
the worst call site under a nicer skin.

It is more code than one control everywhere, and the extra code is exactly where the pain is
today. Two obligations ride along: each of the ten call sites decides explicitly whether it
keeps working without JS or stops being progressive, since a native `<select>` posts and a
popover does not, and all three controls arrive with their dark pass (G1) rather than after it.
This closes #155's select half rather than opening a new direction, because I9 = C already made
shadcn-svelte the control layer.

### Where round ten lands

Epic [#282](https://github.com/fiorelorenzo/canonry/issues/282), with #283 (O1), #284 (O2),
#285 (O3), #286 (O4) rewritten from questions into tasks now that each has an answer, and #290
filed for the persistence O3 deliberately did not settle. The artifacts keep their options and
their rejected sections, as every artifact in this set does, because the reasoning behind an
option that lost is what stops it being reopened in six months.


## Round eleven, decided 2026-08-20

Round eleven has no artifacts, and that is the one thing to say about it before the
answers. Every earlier round drew two or three options per question and then picked one.
Here Lorenzo used the deployed preview, listed nine things he disliked, and said what he
wanted instead. Drawing options to justify answers already given would be theatre, so this
round is prose only and the register in `docs/ux/assets/ux.js` keeps no rows for it: every
row there is keyed to an artifact, and inventing artifact-less rows would make the register
lie about how these were decided. What the register does get is O2's amendment, because a
reversal has to be visible where the original is.

Two of the nine reverse a recorded decision, four are defects against one, and three were
never decided at all. Separating those was most of the work, because "I do not like it" and
"this contradicts what we wrote down" want different answers.

| Id | Question | Chosen |
| --- | --- | --- |
| P1 | The copilot's hue reads as a cold blue against warm paper. Does the marking keep violet? | **No.** C1's mechanism stands, its hue is re-derived onto the palette's own warm axis |
| P2 | Nine surfaces wear the copilot's colour as furniture. Does O3's amendment reach them? | **Yes.** O3 was applied to one component and it was always a rule, not a patch |
| P3 | C4 never named the diff's colours and the diff inherited the marking's. Same colour or two? | **Two.** "This clause changed" and "nobody has accepted this wording" are different claims |
| P4 | The floating panel is 352px wide. Is that the size? | **No.** It grows, most of all horizontally, and the width is stated rather than inherited |
| P5 | Where does a history of kept answers live, given A2's cap of seven? | **In the account menu's own surface**, not as a tenth thing shouting above the nav |
| P6 | Does an entry with no cover show a placeholder? | **Yes, for somebody who can write to that world**, and it is the affordance that starts a generation. Amended next day by Q5: it offers upload or generate where it stands, rather than pointing at the Images panel |
| P7 | The world home opens on three figures nobody needed. What goes there? | **Nothing that is already in the shell.** The masthead earns its space or loses it |

### P1, and why this is A1's amendment rather than C1's

The complaint was "a blue that has nothing to do with the rest", and it is measurable rather
than a matter of taste. `--color-ai` is `#6b4ee6`, which is oklch hue **285.3°**. Every other
colour in the reading room sits on a warm axis: paper `#f4efe4` at **86.4°**, the burnt umber
accent `#7a4a1f` at **59.5°**, and eleven of the palette's twenty tokens between them. Paper
and accent are 27 degrees apart, and every neutral plus `warn` lies in that span, so the warm
axis is where the palette lives rather than a coincidence between two tokens. The copilot's
hue is 161 degrees from paper, most of a quarter turn across the wheel, at nearly double the
accent's chroma. It does not read as "the copilot's colour" in this palette, it reads as the
one element that came from a different design.

**Those three figures were wrong when this section was first written**, and the correction is
recorded rather than quietly applied: a read-only scout reported paper at 36°, the accent at
30° and `--color-ai` at 294°, which are HSL hues for the first two and not oklch at all, and
they went into #344 and into this file unchecked. #344's own implementation recomputed them
from the hex values before deriving anything. The chromas quoted (0.0156, 0.0867, 0.218) were
always right, and the argument survives the correction and gets stronger, since "six degrees
apart" understated how much of the wheel the warm axis actually owns.

O3 already found this and only half-fixed it. Its own amendment says the pill drawn in `--ai`
"reads as a cold purple blob stuck to the corner", and it moved the furniture off the hue
while explicitly keeping it on the marked text. That was the right call for the furniture and
the wrong stopping point: the text has the same problem, in the middle of the reading surface
rather than in a corner.

So **C1 is not repealed and is not even amended in substance**. Unaccepted AI wording still
gets a dashed underline and a margin marker, and still never enters the entry's own reading
flow. What changes is which hue does that, and that belongs to A1, which is the row that spent
violet on the copilot in the first place. The replacement has to satisfy three things at once,
which is why it is a measurement and not a swatch: it must be unmistakably not-canon at a
glance, it must not be confusable with the umber accent that means "interactive", and it must
hold at AA on paper and on ink both, since G1 made dark half the design system.

**What that derivation landed on (#344), so nobody re-picks a hue by eye.** `--color-ai` is
`oklch(0.479 0.140 325)`, `#833c88`, a mulberry, with the dark palette's counterpart at
`oklch(0.746 0.129 325)`. It passes four measured tests: 121.4 degrees from paper and 111 to
120 from every neutral, so it is unmistakably not canon; 94.5 degrees from the accent, 69.5
from `danger` and 116.9 from `warn`, so it collides with no other meaning; chroma 0.140, which
is 1.6 times the accent's rather than the old value's 2.51 times, so it no longer shouts; and
6.17:1 on paper with 7.69:1 on ink, so AA holds in both palettes at the sizes it is used. In
oklab the old value was blue-dominant (a +0.058, b −0.210) and this one is red-dominant
(a +0.115, b −0.080), which is the whole of "it stopped being a blue" as a number.

**Hue alone cannot carry this marking, and that is why C1's shape signals had to be
strengthened rather than the wash retinted.** At L 0.95, which is where `--color-ai-bg` has to
sit to hold ink text on paper, chroma is bounded to about 0.026 whatever hue is chosen, so the
tint measures **1.03:1** against paper: the old one was 1.01:1. The wash never marked anything
and no hue could have made it. What carries C1 is the dashed underline at full token strength
(6.17:1 on paper, 7.69:1 on ink, both clear of the 3:1 a non-text mark needs) and the numbered
margin marker, whose glyph was a hardcoded `#fff` measuring **2.18:1 at 9px bold** on the dark
palette until #344 moved it to `--color-paper`. Retinting a wash is not an answer to this
question, and a future round proposing one should read this paragraph first.

### P2, and the rule O3 was always making

O3 said the furniture loses the violet "because it was never AI text in the first place". That
is a rule about what the hue means, not an instruction about one component, and it was applied
to `QuickAsk` and nowhere else. Nine other sites still tint chrome with it: the pending-proposal
band on an entry, the import review status, the proposal inbox card, two chips on the Ask page,
one on the kept page, the settings AI toggle, table mode's proposal badge, and the derived-universe
badge in the switcher. None of them contains a word a model wrote. A count and a link are not
AI text.

The cost of leaving them is the thing worth naming: a hue that marks nine kinds of furniture and
one kind of text marks nothing. C1's marking only works if the colour appears exactly where a
human has not yet agreed to something.

### P3, the collision nobody chose

C4 picked "in place with a toggle" and never named a colour. G1 later refers to "C1's marking
and C4's diff colours" as though both had been decided, and the diff quietly ended up using
`--color-ai-bg`, the same tint as the marking and as all nine pieces of furniture above. The
result is that a reader cannot distinguish *this clause is what changed* from *nobody has
accepted this wording*, which are two different claims about the same sentence and the whole
point of showing a diff before an accept.

The diff gets its own treatment, derived from the palette rather than borrowed. Guardrail 3 is
what makes this more than tidiness: a proposal has to show its evidence, and a reader who cannot
tell the two signals apart cannot read the evidence.

**How it was answered (#344): two channels, not two hues.** The diff moves only in
**lightness** and the marking only in **hue**, which is what makes them unconfusable when both
land on one sentence, the normal case. `--color-diff-bg` is paper's own hue and paper's own
chroma at 0.874 lightness instead of 0.953, the same paper in shadow, carrying no hue of its
own; `--color-diff-line` is the printers' change bar and does the work the wash cannot, at
4.05:1 against paper. C1's dashed underline sits on top of that wash at 4.84:1 in light and
5.43:1 in dark, 121 degrees away in hue. A changed clause therefore says "this is what changed"
and "nobody has accepted this wording" at the same time, and a reader can read either without
decoding the other.

### P4, P5, P6 and P7, briefly, because none of them is contested

**P4.** The panel is `md:w-88`, 352px, with a 70vh cap, inheriting its width from nothing in
particular. An answer with source chips in a 352px column wraps into a ribbon. It gets wider,
the width is written down with the reason, and it is checked at both ends of the range rather
than only at the desktop default, since E4 and I10 already put it in the phone's bottom bar.

**P5.** The kept-answers row currently sits between the universe switcher and the nav, outside
`NAV_ITEMS`, which is how it dodged A2's cap of seven while taking more visual weight than any
item that respected it. A2 is not amended: the answer is that a history of what the copilot said
is not navigation, it belongs with the account's own things, and the pill is how you reach the
copilot from anywhere anyway.

**P6 reverses O2, and reverses it narrowly.** O2 refused a placeholder because "an empty slot on
every entry is worse than no slot", and the reason given was a reader who cannot write to that
world being shown an invitation they cannot accept. That reason is sound and survives: the
placeholder appears **only for somebody who can write**, so a reader still sees no slot at all.
For a writer it is not decoration, it is the affordance that starts a generation, which is why it
is worth the space O2 denied it. Guardrail 1 is untouched, because starting a generation produces
a proposal and the accept is still the accept.

**P7.** The three figures are entries, pending proposals and credit. Credit is already a meter in
the shell footer, pending is already a count on the nav's Proposals row, and entries is already
the count on the Voci row. The masthead's whole content is a third copy of the sidebar. Whatever
replaces it has to say something the shell does not.

### What round eleven does not answer

Two things Lorenzo raised are defects rather than questions, and they are filed as defects so
nobody looks for a decision that was never needed. The language control on the entry page
contradicts **I5**, which put it in the account menu; it is on the reading surface by mistake.
And Ask's citations are what retrieval returned rather than what the answer used: the own-canon
layer takes its top six by lexical overlap with **no threshold at all**, so on a broad question
about a seventeen-entry world it returns six sentences of noise and the panel presents them as
sources. That is #270's rule, "an evidence field that is always populated is not evidence, it is
decoration", applied to proposals and never to answers.

## Round twelve, decided 2026-08-20

Six more from using the preview, the day after round eleven landed. Same shape as round
eleven and for the same reason: the answers came from working in the thing, so there are no
artifacts and the register keeps no rows. Two amend a decision, one amends a decision taken
**yesterday**, one is a defect against what a decision claimed, and two are new.

| Id | Question | Chosen |
| --- | --- | --- |
| Q1 | The diff hides half of itself behind a toggle. One wording at a time, or every changed part at once? | **Every changed part, with its context, and the toggle goes.** C4's toggle is repealed |
| Q2 | The entry's right column stops where its content stops. Does it run the page? | **Full height.** B1's switching column becomes a column, not a box |
| Q3 | A mention is a link and nothing else. Does it preview? | **Yes, on hover and on focus**, through the same filter that decides whether it resolves at all |
| Q4 | The editor's controls are text buttons and there is no preview. | **Icon buttons with a tooltip each, and a preview.** No control in this product ships an unlabelled icon |
| Q5 | The cover placeholder points at another panel, and no entity type is portrait. | **The placeholder offers upload or generate where it stands**, and the ratios gain portrait |
| Q6 | There is no motion system and `prefers-reduced-motion` is honoured in one place. | **A motion system, with reduced motion as a first-class preference**, the way G1 made dark one |

### Q1 repeals C4's toggle, and the data was always there

C4 chose "in place with a toggle" and `ProposalDiffCard.svelte:117` implements it as
`showOld`, a boolean that swaps the whole card between the old wording and the new. So half
the information is always hidden, and the reader has to remember what they just saw in order
to compare it. That is the wrong shape for the one decision this product exists to support.

**Every changed part is shown at once, with enough unchanged text around it to read**, which
is the arrangement anybody who has reviewed a pull request already knows. The toggle goes
rather than gaining a third state.

That this is a rendering change and not a schema one is worth writing down, because the first
instinct is that it needs new data: `proposal.patch` is `{ summary, before, after }` and has
been since migration 0005, so **both whole bodies are already persisted**. The per-clause list
the card renders today is derived at render time, not stored. A diff with context is derived
from the same two strings, exactly as a forge diffs two blobs. Nothing new is written and no
migration is needed.

P3 is untouched and is the constraint on how this looks: the diff moves in lightness and C1's
marking moves in hue, so a sentence that is both changed and unaccepted still reads as both. A
unified diff colouring removals red and additions green would throw that away and import a
palette from a different product; the change bar and the wash already say it.

### Q2, and why this is not a new decision about the entry page

`EntrySections.svelte:129` is `md:sticky md:top-0 md:max-h-[calc(100vh-4rem)] md:w-64`, so the
column is capped at the viewport and 256px wide, and with its five sections closed it is a
short box with a lot of paper underneath. B1 said "document plus a switching right column", and
a column that stops a third of the way down is not what that describes. It runs the height of
the page. #148's mobile sheet keeps its own 85vh, because a phone is not a second column, and
nothing here reaches it.

### Q3, and the one thing that makes it dangerous

A preview on a mention is worth it because following a link costs you your place, and half the
time you only wanted to remember who somebody was. On hover **and on focus**, so it is not a
pointer-only feature.

`MentionTarget` is `{ name, slug, aliases }` (`apps/web/src/lib/markdown.ts:24-28`), so the
renderer does not have enough to preview with and the data has to come from somewhere. That is
the easy half. The dangerous half is that **a preview is a second way to read an entry**, and
every rule about who may read what has to hold inside it exactly as it holds on the page:
`publicMentionTargets` already decides what resolves on `/p/**` and a preview goes through that
same filter rather than a new query, and `isPlayerVisibleSpan` from #322 applies to whatever
text a preview shows, or #355 recurs inside a tooltip. A preview that leaks is worse than no
preview, because nobody thinks to audit a hover.

### Q4, and the rule that comes with it

B2's graphical menu shipped as `FormattingToolbar.svelte` and it works; the request is about
what it looks like. Icons, and **a tooltip on every one of them**, which is the part that is a
rule rather than a restyle: an unlabelled icon is a guess, and this product already vendors a
tooltip primitive under `ui/tooltip/` that nothing uses. So the rule is that a control whose
label is an icon carries its name in a tooltip and in `aria-label`, everywhere, not only here.

The editor also gains a **preview**. Live decoration is not a preview: it shows styled markdown
while you type, and it cannot show a resolved mention, an inserted image at its real size, or a
heading in the reading room's own serif. Markdown stays the stored form, so F4's lossless
export is untouched.

### Q5 amends P6 a day after it was taken, and fixes a ratio table that never matched its own decision

**The placeholder.** P6 made it "the affordance that starts a generation", and #347 built it as
a pointer: it opens the Images section, from where a cover costs four clicks to generate or
three to upload. Pointing at another panel is not an affordance, it is a signpost, which is the
same mistake round eleven's P8 took out of the review flow. Clicking the placeholder now asks
the only question worth asking, upload or generate, and asks it where you clicked.

O2's "use as cover is the accept" survives and is why this is safe: a generated image still
becomes the cover because a person chose it. **Upload and generate are not the same act** and
the record has never said so out loud: an upload is a human handing over a file, which needs no
accept beyond the choosing, while a generation is a model producing something a human then
keeps. Guardrail 1 governs the second and has nothing to say about the first.

**The ratios.** O2 said "wide for a place, closer to square for a person", and `COVER_RATIO`
gives a character `3 / 2`, which is landscape and barely closer to square than a faction's
`16 / 9`. **No entity type is portrait today.** A person's portrait being landscape is a defect
against O2's own words rather than a change of taste, and it is why the request arrived as
"landscape or portrait depending on the type". The table is re-derived so a character and an
item read as portrait, a faction sits between, and a place, an event and a session stay wide.

That reaches further than a constant, and the part to get right is where the shape is decided.
#332 put `aspectRatio` on the `image_model_config` row, one per feature, because a model that
cannot honour a ratio must fail on save rather than silently return 16:9. A ratio that varies by
entity type cannot live on a per-feature row. However that is resolved, the two must not end up
disagreeing: the shape a cover is *generated* at and the shape it is *displayed* at being
different is how an image arrives pre-cropped wrong.

### Q6, and why reduced motion is in the decision rather than in a review comment

There is no motion system: `tw-animate-css` is a dependency, the vendored popover, dialog and
sheet animate their own open and close, and nothing else moves. Motion is worth adding where it
explains a change of state and worth refusing where it only decorates one.

`prefers-reduced-motion` appears **once in the whole application**, in `ModelRunning.svelte`'s
spinner, and the vendored components that animate do not honour it at all. So the decision is
not "add animations", it is: motion arrives with reduced motion honoured at the system level,
in the same breath, the way G1 made dark a whole-app preference rather than a table-mode skin.
A surface that animates without checking is an accessibility regression that ships looking like
polish.

What earns motion: a thing arriving or leaving, a panel expanding in place per O3 and G5, a
section opening per O2, a proposal being accepted or rejected, a state that changed where a
reader would otherwise wonder whether their click registered. What does not: text on load,
anything on a canon reading surface, anything that delays an action behind its own animation,
and anything that moves while a model is already making the reader wait.

### Where round twelve lands

Epic [#360](https://github.com/fiorelorenzo/canonry/issues/360), one issue per question. Q5
carries the only change that may need a migration, so it owns that slot.

## Round thirteen, decided 2026-08-20

Twelve more from the same preview, the same evening as round twelve. Same shape and the
same reason: these came out of using the thing, so there are no artifacts and the register
in `docs/ux/assets/ux.js` keeps no rows. What is different is how many of them are defects
rather than taste. Four are a page or a control doing something nobody chose (a modal in
the top-left corner, two navigation items pointing at a 404, a search that reads names and
not prose, a control that O4 already ruled on), one reverses a decision taken three days
ago, and the rest are the product's answer being incomplete rather than wrong.

I checked each of the four defects rather than trusting the screenshot, because a defect
and a dislike want different answers and because two of them turned out not to be what the
symptom said. The evidence is in each section.

| Id | Question | Chosen |
| --- | --- | --- |
| R1 | A portrait cover sits in a band above the title, where its own ratio makes it small. Where does a portrait go? | **Beside the title, as a margin figure.** The band stays for the wide ratios |
| R2 | The generate modal opens in the top-left corner of the window. | **The three native `<dialog>`s become the vendored Dialog.** Tailwind's preflight zeroed the margin the browser centres a modal with |
| R3 | The generate modal says "style: none set" and there is nowhere to set one. | **The universe's image style and the Loremaster's voice become settable**, and the voice reaches the prompt it was written for |
| R4 | A setting that changes what the product does is unset, and only one surface says so. | **One checklist, said twice**: at the point of use, and once in the shell |
| R5 | The dock throws the conversation away on every navigation. | **It keeps it. Only the context changes.** O3's "abandoned stays abandoned" is repealed for the panel |
| R6 | The pill sits in the bottom-right corner, small, and says nothing about what it can do. | **Bottom centre, bigger, with three suggestions** drawn from where the GM is standing |
| R7 | A generated cover is still "private", and publishing it is a second click nobody asked for. | **An image's audience follows its entry.** Attaching is the accept, and `published_to_players` becomes `gm_only` |
| R8 | The GM/player view is a label beside a button, and the language switch is a row of buttons that will not scale. | **A switch for the view, a Select for both languages.** O4 applied rather than reopened |
| R9 | An inserted image has one size, and write and preview are two different heights. | **The image carries a width**, and the two modes share one box |
| R10 | The entry's images live in three places with three different rules, and the insert modal lists them in a 448px column. | **One media surface per entry**, reached from the rail, the placeholder and the editor |
| R11 | Players and Import are in the sidebar and both 404. | **Both become real pages.** A nav item that cannot be reached is not a nav item |
| R12 | Search on the entries page looks broken. | **It reads bodies too, and says what it did.** It was never broken, which is the finding |

### R1, and why the band was right and still is

O2 = A put a cover band above the title and Q5 gave the ratio table a portrait, both of
which I still want. What Q5 did not think about is that a 3:4 image in a band whose height
is capped at 20vh is 135px wide on a 900px window, which is a thumbnail with a lot of
ceremony around it. The band is a band: it works for 16:9 and it cannot work for 3:4,
because the two shapes want opposite things from the same slot.

So the slot goes by ratio rather than by decision. A wide cover keeps the band. A portrait
cover becomes a figure in the margin beside the title, at the head of the article, about
200px wide, and the prose never wraps around it: the article stays a single column at
`--container-measure` and the figure sits outside it, which is the one shape that adds an
image without moving a line of the text. Below the breakpoint where that margin does not
exist, a portrait goes back to being a band, because a 200px figure floated into a 390px
screen is worse than either.

The reason to be careful here is that the entry page is a reading surface, and the thing I
keep refusing on it is text that moves. A figure the prose flows around reads better in a
magazine and worse in a wiki, where the same page is read twice and edited once.

### R2 is a defect, and its cause is one line in a stylesheet nobody wrote

The generate modal opens against the top-left corner of the window. So do the cover dialog
and the editor's image dialog, because all three are a native `<dialog>` and the cause is
shared: a modal `<dialog>` is centred by the user-agent stylesheet's `margin: auto`, and
Tailwind 4's preflight sets `margin: 0` on `*`, `::before`, `::after` and `::backdrop`.
Measured rather than reasoned: a bare `<dialog>` with the same classes, opened with
`showModal()` on the entry page, reports `margin: 0px` and a rect at `x: 0, y: 0`.

That makes the fix a choice rather than a patch. Adding `m-auto` three times fixes the
symptom and leaves three hand-rolled modals in a product whose control layer is
shadcn-svelte (I9 = C), each with its own scrim, its own escape handling and no focus trap
at all. All three move to the vendored Dialog, which is centred, traps focus, locks the
scroll, animates on the round twelve tokens and is already in `/dev/ui`. The native element
was the right first move when the alternative was writing a modal by hand; it stopped being
that the moment I9 landed.

### R3, and a column the spec has always had and nothing has ever read

The modal says `Stile: nessuno impostato` and offers a `modifica` link, and that link edits
the *entry's* override (`entity.image_prompt_modifier`). The universe's own style,
`universe.image_style_id` and the `image_style` row behind it, has no interface anywhere in
the product. F1 said style is shared at the universe level and overridable per entry, and
only the override was ever built, so the shared half has been unreachable since #65. The
first thing every generated image in a new world inherits is nothing.

Next to it, `universe.loremaster_description` is in the schema, is in SPEC.md §4.1's own
table as "the voice the Loremaster uses for this world", is written by three fixtures, and
is read by no code at all. A field that exists, is documented, and does nothing is worse
than a missing one, because the seed makes it look done.

Both become sections on the universe settings page, and the voice reaches the two prompts
it was written for: `runAsk`'s system prompt and the completion path's. It is the GM's
description of how their Loremaster talks, so it goes where `speechInstruction` already
goes, and it changes no guardrail: a voice does not make the copilot write canon, it makes
the sentences it proposes sound like the world they are for.

### R4, and what "everywhere" is allowed to mean

"Tell me a bit everywhere that I have not set this" is right about the problem and dangerous
as an instruction, because the version of it that ships is a banner on every page that
everybody learns to ignore in a week. Two placements, and a rule for what earns a place on
the list.

A setting is on the checklist when it changes what the product does and has no sensible
default. Today that is exactly two, the image style and the Loremaster's voice, both of
which R3 makes settable, and the list is built to be read rather than counted: it is a
function in one place, so a third setting joins it by being added there instead of by
growing a third warning somewhere else. `ai_enabled` and `propagation_cap` are not on it:
they have real defaults, and a default is an answer.

Where it shows: at the point of use, which is the generate surface already saying "none
set" and now saying it with the link that fixes it, and once in the shell, as a quiet row
under the navigation with a count. Not a toast, not a modal, not a per-page banner, and
never on a canon reading surface, which is the same rule motion got in Q6. The settings
page itself grows the same list at the top, because that is where somebody who followed the
link arrives.

### R5 repeals half of O3, and I am the one who asked for the half being repealed

O3's fourth amendment reads "keep is the only write. Closing this loses everything, exactly
as closing the palette already does, which is what lets `ask/kept` be a history rather than
a transcript." `QuickAsk.svelte` implements it twice over: `close()` calls `reset()`, and an
effect watching `page.url.pathname` closes the panel on any navigation, with the comment
that a panel left open would be "talking about somewhere else".

Having used it, that argument is exactly backwards. The reason to ask the copilot from
inside the page is that the next thing you do is *go and look*, and going to look is a
navigation. Losing the answer at the moment it becomes useful is the worst possible time to
lose it. And the panel is not talking about somewhere else: it is talking about what I
asked, which does not stop being true because I clicked a source chip.

So: the panel stays open across a navigation, the turns stay, and the context line follows
the page. What does not change is the write. Keep is still the only thing that records
anything, `ask/kept` is still a history of kept answers and not a transcript, and closing
the panel still throws the conversation away, because the alternative is a copilot that
remembers something the GM never chose to keep. Nothing is persisted server-side and
nothing survives a reload. That is the whole of the reversal: from "dies on navigation" to
"dies when you close it".

It follows that the dock becomes a conversation rather than a question and an answer. The
turns are held in the same rune module the open flag lives in, the panel renders them in
order, and each new question carries the previous turns plus the page the GM is standing on
into the request. Both are capped, because a prompt that grows without bound is a bill that
grows without bound: the last few turns, and the entry's name and type rather than its body.

### R6, and why the corner was the wrong corner

E3 = C gave table mode a two-tier dock in the bottom-right and O3 put the pill in the same
corner for the same reason, that it is out of the way. Out of the way is right for a thing
you already know is there and wrong for the front door of the feature the product is named
after. Bottom centre, wider, with the shortcut visible on it and a line saying what it can
be asked, is the same affordance every command bar of the last five years has trained
people to look for.

The suggestions are the part I want to be careful about. Three, deterministic, drawn from
the route and the entity type, never from a model: they cost nothing, they arrive before the
panel finishes opening, and they cannot be wrong in the way a generated suggestion can. On
an entry they are about that entry, on the browser they are about the world, in the review
queue they are about what is pending. They are chips, they fill the composer rather than
sending it, and they disappear once there is a conversation, because a suggestion is for
somebody who does not know what to type and not for somebody mid-thought.

The animation is the one Q6 already specifies and does not need a new token: the panel is a
thing expanding in place, so it arrives on `duration-move` with `ease-arrive` and it leaves
at once.

### R7, and the state that has never made sense

Generate an image, use it as the cover, and the panel says `Privata.` with a `Pubblica`
button under a `COPERTINA` badge. Both things are true and together they are nonsense: the
cover of the entry is not shown to the people the entry is shown to, and the only way to
find that out is to notice a word in a narrow column.

The two-switch model came from guardrail 6, and it is worth saying precisely which part of
it is real. Guardrail 6 says nothing unreviewed is ever published to players. It does not
say every image needs its own publish click; it says a human has to have looked. And a
human has looked: generation puts an image in `media_asset` with `entity_id` null, and
nothing shows it anywhere until the GM picks it out of the candidate grid and attaches it.
That act is the review. Q5 already said this out loud for the cover, "use as cover is the
accept", and then left the second gate standing next to it.

So an image's audience follows the entry it is attached to. `published_to_players` becomes
`gm_only`, default false, and the player-side gate becomes: the entry is not `gm_only`, the
entry has been revealed, and the image is not marked `gm_only`. Three legs instead of four,
and the leg that goes is the one that was always redundant with attaching. The flag that
stays is a real product need pointed the other way: the villain's true face, illustrated on
an entry the party can read.

The migration writes `gm_only = not published_to_players` for every existing row, so
nothing that is invisible today becomes visible on deploy. New attachments are visible,
old private ones stay private, and the difference is legible in one line of SQL rather than
in a paragraph explaining what changed under people's feet. The leak test keeps its
unpublished-image needle and gains the case this creates: an attached, not-`gm_only` image
on an unrevealed entry stays out of the payload.

What the panel says changes with it. No `Pubblica` button, no `Privata.` on an image that
is in the entry, one `Solo GM` toggle for the exception, and one sentence saying that the
party sees an entry's images when the entry itself is revealed.

### R8, which is O4 arriving where it already applies

O4 = B drew the boundary by what the list is: a binary or ternary state gets a segmented
control, a vocabulary the product ships gets a Select, and the GM's own data gets a
Combobox. Two call sites never got the memo. The interface locale is a row of native
buttons in `LocaleSwitcher.svelte`, one per locale, which is a shipped vocabulary rendered
as neither of the three and which stops fitting the moment there is a third language. The
entry's own language control is a four-option segmented control, which is a shipped
vocabulary too, and grows by one every time a locale is added. Both become Selects, and
both keep posting a form, because I5 = B put the interface switch in the account menu and a
`<select>` in a form still works with no JavaScript.

The GM/player view is the different one, and it is not an O4 case at all: it is not choosing
a value out of a list, it is turning one lens on. That gets a switch, which the control
layer does not have yet and which is worth having once rather than five times. It replaces
the label-and-button pair on the entry page and in the editor's preview, and it reads the
same way in both: off is the GM's view, on is what the party sees.

### R9, and where a width is allowed to live

An inserted image is `![image](/w/.../media/<id>)` and renders at whatever width the prose
column gives it, which for a portrait means an image taller than the screen in the middle of
a paragraph. The width has to live in the body, because the body is the whole record of the
entry: anything kept beside it is a second source of truth about a document a model also
reads and writes.

So the markdown carries it, as a percentage of the measure appended to the URL in the shape
markdown-it's own size convention already uses: `![alt](/path =50%)`. Three widths offered,
a third, two thirds and full, rather than a number to type, because the measure is
responsive and a pixel value is a promise the layout cannot keep. Chosen when the image is
inserted, and changeable afterwards from the preview, where hovering an image shows the same
three.

The jump between write and preview is the other half of the same complaint and has a duller
cause: the two modes share their padding and their minimum height but not their content, so
one line of image markdown in write mode becomes 400px of image in preview and the box
resizes under the cursor. Both modes get the same floor, tall enough that a short entry does
not move at all, and an image in preview gets a maximum height so a portrait cannot blow the
box open. This is spacing, not a new surface: nothing about Q4's toolbar or the preview
toggle changes.

### R10, and the three-headed feature underneath the complaint

The insert modal lists the entry's images as a three-column grid of thumbnails inside a
448px box, under a heading, above an upload button, above a generate block. It is not that
the list is ugly. It is that it is the third place the same images are managed, and the
three disagree: the rail's Images section can publish and set a cover but not insert into
the body, the insert dialog can insert and generate but knows nothing about covers or
visibility, and the cover dialog does one image for one purpose. None of the three can
delete an image, which is why there is no delete endpoint: nobody had a place to put the
button.

One surface, then. An entry's images are a gallery wide enough to see them in, with every
action on the image it applies to: use as cover, insert into the body, hide from the party,
regenerate, delete. Two ways in at the top, upload and generate. The rail keeps a compact
preview, a count and a few thumbnails, and opens it. The placeholder opens it. The editor
opens it in a pick-one mode that returns a URL and a width to the caret, which is R9's other
end. Delete is a real delete, of the row and the stored file, refused while the image is the
cover or referenced in the body, because a body pointing at a missing image is worse than a
cover somebody has to remove first.

### R11, and the two pages the sidebar promises

`NAV_ITEMS` carries a `built` flag, and the two items where it is false, Players and Import,
render as ordinary links with a `title` attribute nobody reads and 404 when clicked.
Confirmed against the dev server on the seeded world: both return 404 while Table, Works and
Proposals return 200. A `built: false` flag that still draws a link is not a guard, it is a
comment.

The flag goes, because the answer is the pages. Import for an existing world is the one that
matters most: the import engine, the playbooks, the review surface and the job status route
all exist, and the only thing missing is a door for a world that already exists rather than
one being created, so `/w/<slug>/import` starts a job into this universe and lists the jobs
it has already run with their review links. Players is what the party can see: the wiki's
own address, what has been revealed and when, and what is still behind the screen. Neither
invents a product decision. E7 already settled what an unrevealed entry looks like to a
player, and this page is the GM's side of exactly that list. Invitations are not in it,
because there is no membership invitation anywhere in the product yet and inventing one on a
nav-fix is how a page ends up with a button that writes nothing.

### R12, and a search that works being the actual finding

"Search on the entries page does not seem to work" turned out to be three things, and the
one it sounds like is not among them. It works: typing a name and pressing Enter navigates
to `?q=` and the table narrows, which I checked in a browser rather than reading the code.

What is wrong is that nothing says so. The field has no button, no icon and no hint, so the
only way to discover that Enter is the trigger is to try it; there is no line saying how
many rows matched what, and no way to clear the search except emptying the field and
pressing Enter again. And the substance: it matches names and aliases only, so a word from
the prose finds nothing. `payroll` and `freeze` both appear in the seeded world's bodies and
both return an empty table under an empty-state sentence that says the filter matched
nothing, which is exactly what a GM reads as "search is broken".

So the field gets a visible submit and a clear, a result line naming the query and the
count, and the query reads bodies as well as names and aliases. It stays a filter and not a
ranking: O1's table is sorted by the column the reader chose, and a relevance order hiding
behind a caret that says "changed" would be a lie in the header. Ranked "who is this" search
is the palette's job and stays there.

### Where round thirteen lands

Epic [#375](https://github.com/fiorelorenzo/canonry/issues/375), one issue per decision, in
two waves because twelve is more than the eight an agent wave holds and because R10 needs
R7's column and R2's dialog to exist first. R7 owns the first wave's migration slot and R10
the second's.

## Round fourteen, decided 2026-08-20

Eleven, from using what round thirteen shipped, an hour after it deployed. That is the
shortest gap between a round and the round that corrects it so far, and the reason is worth
writing down: three of these are surfaces round thirteen touched and did not finish, two are
choices I made inside a component that Lorenzo has now looked at and rejected, and one is a
decision I applied to the wrong surface. A round that lands in the morning and is amended in
the evening is the process working, not failing, so long as the amendment says which line it
replaces.

| Id  | Question                                                                             | Chosen                                                                                                               |
| --- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| S1  | The universe settings page is six stacked cards and I do not like any of it.         | **The two-pane shape the account settings already have**, with named groups and one sentence per setting             |
| S2  | A universe's image style is a name and a prompt nobody can picture.                  | **A catalogue of shipped styles with an example image each**, plus one custom style per universe                     |
| S3  | With no style set, generation still runs and inherits nothing.                       | **No style, no generation.** A refusal with the link that fixes it, not a warning beside the button                  |
| S4  | The GM/players switch changes the page's layout when you use it.                     | **A two-option control at the head of the article**, the editor's own write/preview shape, fixed size in both states |
| S5  | A portrait cover stands beside the title and looks like it landed there by accident. | **Every cover goes to the top of the aside**, whatever its ratio. R1's margin figure is repealed                     |
| S6  | A mention popover names an entry and never shows its face.                           | **The cover rides along**, through the same filter that decides whether the mention resolves                         |
| S7  | The editor gives the writing area 384px and the page 900.                            | **The writing area takes the page**                                                                                  |
| S8  | A suggestion chip fills the box and then asks for a second click.                    | **The chip asks.** Its own words are the confirmation G11 wants                                                      |
| S9  | The dock's answer wears a dashed underline and a numbered marker.                    | **An answer is not proposed canon, so it stops wearing C1's mark.** The Ask route already did this                   |
| S10 | Open in Ask navigates to a full page and leaves the panel floating over it.          | **It closes the panel**                                                                                              |
| S11 | The composer is a command palette wearing a chat's job.                              | **It becomes a composer**: a send control, no palette furniture, entry rows only when there are any                  |

### S1, and what is actually wrong with that page

It is not ugly, it is unstructured. Seven sections in source order, each a `rounded-lg border
p-4` card with a heading and a sentence: a setup checklist, an AI kill switch, a numeric
propagation cap, an image style, a Loremaster voice, a link to the relation catalogue, and a
precedence list that only exists for a derived world. Nothing groups them, nothing ranks
them, and the two most consequential controls in the product (turn the copilot off, cap what
a save may touch) sit in the same visual box as a link to another page. It grew by accretion,
one issue at a time, which is exactly what it looks like.

I6 = B already decided the shape for the account: "an account menu in the shell plus one
two-pane settings page, with a real Account pane." The universe's own settings never got that
decision and should have. So it takes the same shell: a left rail of named groups, a right
pane, one group open at a time, with the groups being **Images** (the style), **The
Loremaster** (voice, the generation switch, the propagation cap), and **Canon** (the relation
catalogue, and precedence where a world is derived). The setup checklist stops being a
seventh card and becomes a mark on the rail's own rows, which is where somebody looking for
what is unfinished will look.

Two consequences to hold on to. The first is that grouping is not decoration here: "stop
writing" and "cap a propagation" are both about how much the copilot is allowed to do, and a
GM who wants to turn the volume down should find them together rather than three cards apart.
The second is that this page and the account's pages are now the same component in two
places, so a change to the shell lands on both, which is the point.

### S2, and borrowing a shape that already works

"Style: none set" with a name field and a prompt textarea asks the GM to imagine what a
sentence of prompt will do to an image. Nobody can. ai-game solved this two products ago and
the shape is worth copying rather than reinventing: `image_styles` there carries a name, a
description, a `prompt_modifier`, an `example_images` array and a sort order, and the picker
shows the example, the name and the description, so choosing is looking rather than guessing.

Canonry's own `image_style` is most of the way there by accident: `universe_id` is already
**nullable**, which is exactly the split this needs. A shipped preset is a row with no
universe, a custom style is a row that belongs to one, and `universe.image_style_id` points
at whichever the GM chose. What the table lacks is a stable slug so a re-seed updates rather
than duplicates, a description, an example image and an order. The picker becomes a grid of
cards, and "Custom style" is the last card, with the prompt textarea behind it, so the escape
hatch is there without being the first thing anybody sees.

**The example images are generated once and committed**, as static files under
`apps/web/static`, through the product's own `variants` model. That is a paid action, about
three credits per image and six presets, and I am authorising it here rather than leaving a
placeholder in the interface: a style catalogue whose examples are grey boxes is worse than
the textarea it replaces. They are committed rather than generated per universe because every
world sees the same six presets, and paying six times per world for an identical picture is
the kind of spend G11 exists to prevent.

### S3, and a refusal rather than a nudge

R4 put "the image style is not set" on a checklist and R3 made the style settable. Generation
still runs regardless and silently inherits nothing, which means the first images a new world
produces are the ones least likely to match it, and the GM finds out after paying for four of
them.

So: with no style set, every generate control refuses, everywhere it appears, and says where
to set one. Not disabled-with-a-tooltip; a short sentence with the link, in the place the
button was. **Upload is unaffected**, and that distinction is the same one Q5 drew: an upload
is a human handing over a file, which needs no style, no model and no AI at all (guardrail 4).
A world with the copilot switched off keeps a working images feature, and a world with no
style keeps a working upload.

### S4 amends R8 for one control, and the reason is measurable

The switch works and the layout moves when you use it. The label beside it swaps between
`Vista GM` and `Anteprima giocatori, quello che vede il tavolo`, which is 4.5 times longer,
wraps to two lines at the article's width, and pushes the body down; the switch's own label
wraps too. Every state change in that row costs the reader their place in the text, on a
reading surface, which is the one place this product is supposed to hold still.

A binary state gets a segmented control (O4 = B) and the editor already ships the shape,
`Scrivi | Anteprima`, two fixed labels in a fixed box. The view control becomes that, with
`Vista GM | Vista giocatori`, at the head of the article, and the explanatory sentence stops
being a label that changes size: it moves to a single fixed line under the control, present in
both states. R8's Switch primitive stays in the layer and stays used, by the media gallery's
`Solo GM` toggle, which is a real on/off on one object rather than a choice between two views
of a page.

### S5 repeals R1, one day later, and takes O2's band with it

R1 moved a portrait cover out of the band and into the margin beside the title, #399 stopped
it pushing the body down, and the result is a picture floating in a gutter that belongs to
nothing: aligned with the title on one side, with the aside's own edge on the other, in a
column that exists only for it. "It looks like it was put there at random" is a fair reading
of a figure whose column has no other content.

The aside is where this belongs and it was there all along. It is the entry's structured
column, it already runs the full height of the page (Q2), it is 256px wide, and everything
else that describes the entry rather than narrating it already lives there: relations, facts,
images, history, audit. A cover at the top of that column is a wiki infobox, which is a shape
every reader of this kind of page already knows, and it touches the prose measure not at all.

So **every cover goes there, whatever its ratio**, at the aside's own width and its own
natural height: tall for a character, short for a place. That gives the two ratios one home
instead of two, which is the part R1 got wrong and O2 got wrong before it. Below `md`, where
the aside is a bottom sheet rather than a column, the cover stays a band above the title,
because a sheet the reader has to open is not where a page's own picture goes.

What this costs: the cover is smaller than the band was at the top of a wide page, and it is
no longer the first thing on the page. I am taking that trade because the entry page is a
reading surface first, and the picture has never been the reason anybody opens it.

### S6, and the one thing to be careful about

A mention popover already resolves a name, a type, a status and an excerpt through two
endpoints, a GM one and a public one, and the public one goes through `loadPublicEntity` so
that an unrevealed entry answers as a gap. The cover joins that payload as an optional field,
which means it must pass the same gate on the public side: the cover of an entry a player may
read, that is not `gm_only`, served by the public media route (R7's chain, #382). On the GM
side there is no such filter to satisfy because the GM may see everything in their own world.

### S7, and where the space went

The edit route is `max-w-3xl px-6 py-8`, and inside it a title, a breadcrumb, a toolbar, an
editor box with a 384px floor, a save row and a language row. At 900px of viewport the writing
area gets 384 of it and the rest is spent on furniture and empty paper below. Writing is the
main interaction on that page and it should have the page: the editor becomes a full-height
column, the box grows to fill what is left after the toolbar and the two rows, and the title
shrinks to the breadcrumb that is already there. #384's floor stays as a floor for a short
viewport, not as the height.

### S8 reverses a call I made yesterday

I built the chips to fill the composer without sending, and #401 then moved the caret so the
text was somewhere you could type. Both were wrong in the same way: the chip is already an
explicit act naming exactly what will be asked, so a second click adds a step and confirms
nothing. G11's "confirm every paid action" is about not spending silently, and a button whose
label is the question is not silent. The chip asks.

### S9, and applying C1 to the wrong thing

C1 gives AI text that nobody has accepted a dashed underline and a numbered margin marker,
and guardrail 2 requires exactly that. The dock renders its answer through it, with
`proposed: true`. The Ask route, rendering the same answer, does not.

The route is right. An Ask answer is not proposed canon: it is not in an entry, it cannot be
accepted, and nothing about it is waiting for a decision. What can become canon from the dock
is a proposal, and a proposal's own summary keeps its marking there and on the route. The
numbered marker is worse than redundant on an answer, because the number points at a sequence
that does not exist while the sources sit two lines below it, which is what "I do not
understand what that 1 is for" is telling us.

**The hue is not what changed.** Round eleven P1 measured mulberry against paper, ink, the
accent and danger specifically for this mark and wrote the numbers down; the complaint arrived
about a surface that should never have carried the mark at all. The mark stays as it is where
it belongs, which is a sentence of canon somebody has not accepted yet.

### S10 and S11, the two smallest and the two most obvious in use

Open in Ask hands the answer to the route and navigates there. R5 kept the panel open across
a navigation on purpose, and this is the one navigation that makes the panel redundant, since
the thing it holds is now the page. It closes.

And the composer is a command palette with a chat's job, which is visible the moment you type
a question into it: it offers a `Chiedi "..."` row for something Enter already does, and under
it a `Voci` section that says "no entry matches" about a sentence that was never a name. O3
mounted the palette here to get the "in case a name was meant" behaviour for free, and free is
the right price for the entry rows and the wrong one for the rest. In the docked placement:
the palette's ask row goes, the empty entry state goes, entry rows appear only when there is
at least one match, and the input becomes a composer with a send control on it, in the panel's
own paper rather than the palette's chrome.

### Where round fourteen lands

Epic [#405](https://github.com/fiorelorenzo/canonry/issues/405), one issue per decision, and
S2 owns the wave's migration slot because the style catalogue is the only schema change.
