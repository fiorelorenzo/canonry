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

**Round one: all 38 decided on 2026-08-13.** Round two, the eleven questions those
answers opened, is open and tracked on issue
[#112](https://github.com/fiorelorenzo/canonry/issues/112).

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

## Round three

| Id | Question | State |
| --- | --- | --- |
| H1 | What the switch is called when off still spends, what the sentence beside it promises, and whether reading counts against the quota | open, blocks #107, #88, #109 |

## What these answers unblock

Every surface in the inventory now has its gate answered. Nothing in the UI is waiting
on a decision except the copy of one settings row, which H1 owns and which blocks the
wording of #107 and the meter's behaviour in #88, not their construction.

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
