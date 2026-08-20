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
| B2 | Editor and mentions | **C, markdown with live decorations.** Amended: a graphical menu for anyone who does not want to type markdown |
| B3 | Relations and inference | **A, in the margin**, with one-click confirm and retype |
| B4 | Facts and provenance | **B, on demand.** Facts closed by default, a permanent non-violet human against ai-accepted badge in history |
| B5 | Works and scenes | **A, tree beside a scene editor**, with the affected-scene signal read only |

### The copilot loop

| Id | Decision | Chosen |
| --- | --- | --- |
| C1 | AI text marking | **B, underline and margin marker.** Unaccepted wording never enters the entry's own reading flow. The mechanism is unamended; only its hue moved, see P1 |
| C2 | Proposal routing | **A, an inbox**, with a quiet arrival signal and never a modal |
| C3 | The plan | **A, flat checklist** ordered by relevance, entries droppable before any diff is written |
| C4 | Diff layout | **C, in place with a toggle.** Amended round eleven: the diff has its own colour, distinct from C1's marking, see P3 |
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
- **The brand spends the accent and nothing else.** C1 reserves violet for the copilot,
  so the mark never borrows it: a logo in the copilot's hue makes every marked proposal
  mean slightly less. Burnt umber on paper, amber on ink, and the favicon carries a
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
| P6 | Does an entry with no cover show a placeholder? | **Yes, for somebody who can write to that world**, and it is the affordance that starts a generation |
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