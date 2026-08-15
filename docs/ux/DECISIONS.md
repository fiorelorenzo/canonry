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

**Four rounds, 61 answers.** Round one, 38, and round two, the 11 questions those answers
opened, were both taken on 2026-08-13; round three's 2 on 2026-08-14; round four's 10 on
2026-08-15. Rounds one to three answered questions asked before there was code. Round four
came out of the shipped UI and is recorded at the bottom of this file, with its audit in
[`product-pass.html`](product-pass.html).

To change a decision: edit this file and the `UX_REGISTER` entry in
`docs/ux/assets/ux.js`, and say so on the issues it blocks. The artifact keeps its
options and its rejected section either way, because the reasoning behind a rejected
option is what stops it being reopened in six months.

## Round one

### Foundations

| Id | Decision | Chosen |
| --- | --- | --- |
| A1 | Visual language and density | **B, reading room.** Warm paper, serif for canon prose and entry titles, burnt umber accent, violet spent only on the copilot |
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
| C1 | AI text marking | **B, underline and margin marker.** Unaccepted wording never enters the entry's own reading flow |
| C2 | Proposal routing | **A, an inbox**, with a quiet arrival signal and never a modal |
| C3 | The plan | **A, flat checklist** ordered by relevance, entries droppable before any diff is written |
| C4 | Diff layout | **C, in place with a toggle** |
| C5 | Evidence | **B, popover on the changed text**, forced open where the only evidence is embedding similarity |
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
| I7 | The universe home, and the entry browser that was never built | **C, one page two modes**: the browser, with a collapsible overview strip above it |
| I8 | Nine empty states, nine hand-written sentences | **A, one component, three variants**: cold start, settled, derived absence |
| I9 | Who owns the controls | **C, shadcn-svelte as the control layer**, with components of our own only where it has no answer |
| I10 | The phone | **B, one responsive shell**, E4's bottom tabs generalised past table mode |

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
