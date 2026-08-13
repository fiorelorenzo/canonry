# Canonry UX decisions

The record of what was decided, when, and what each answer costs the issues that
depend on it. `docs/ux/index.html` is the audit and the register, one artifact per
question with the options drawn; this file is the answer set in prose, so it can be
read in a diff and quoted in an issue.

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

## Round two: what the answers opened

| Id | Question | Opened by |
| --- | --- | --- |
| G1 | Does table mode get a warm dark palette, or does the reading room stay light everywhere? | A1, E1, E4 |
| G2 | Which surfaces keep the serif measure, and which go back to sans because they are dense? | A1, C4, C6 |
| G3 | Which modifiers, which bare keys, and what breaks on a non-US layout? | A3 amendment, C6 |
| G4 | Toolbar, slash menu, selection bubble, or more than one? | B2 amendment |
| G5 | What is the Ask page for, and does following a source leave the answer behind? | C8 amendment |
| G6 | Do the 19 unchanged-field updates need an accept at all? | D3 against guardrail 1 |
| G7 | What do players see between the session and the confirmation? | E5 with E7 and guardrail 6 |
| G8 | Does the inbox exist in table mode, and does propagation keep running during a session? | C2 with E1 |
| G9 | What does the meter show with the AI off, and what does off cover? | C10 with F2 and guardrail 4 |
| G10 | Where is the lock-in answer said out loud? | F4 |
| G11 | How often does the product ask before it spends? | F1 with F2 and D2 |

## What these answers unblock

Every P0 issue with a screen behind it now has its gate answered, except where a
round-two question is genuinely in the way:

- **Ready to start:** #104 app shell (A1, A2; the dark palette is G1 but the light
  one is settled), #15 and #105 entry and editor (B1, B2, with G4 for the menu),
  #16 relations (B3), #17 and #18 facts and revisions (B4), #106 AI marking (C1),
  #47, #50, #51 the proposal model, the plan and the diff (C2, C3, C4, C5, C6),
  #107 the AI switch (C10, with G9 for what off covers), #41 to #44 the playbooks
  and #26, #27, #30, #36, #37 the import surfaces (D1, D2, D3, D5, D6), #42 the
  review screen (D4), #108 onboarding (D7), #3 and #4 the landing page (F6).
- **Blocked on a round-two answer:** #75 the palette shortcuts (G3), #21 how export
  is presented (G10), #82 and #83 the reveal timing and the players wiki (G7),
  #88 the quota meter's behaviour with the AI off (G9), #66 how often generation
  confirms (G11).
