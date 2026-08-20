/* Canonry UX decision artifacts, shared runtime.
   Owns three things so no page has to repeat them:
   1. UX_REGISTER, the single list of decisions, now carrying the decision itself;
   2. page head, breadcrumb and prev/next, injected from that list;
   3. the recorder, which records a pick for a still-open decision in localStorage.

   The first 38 decisions were taken on 2026-08-13 and live in the register as `d`
   (the letter), `dn` (the option name) and, where Lorenzo amended the option rather
   than taking it as drawn, `dnote`. That makes the register, not a browser's storage,
   the thing a fresh reader sees. `docs/ux/DECISIONS.md` is the same record in prose.

   Everything degrades to plain HTML if this file fails to load: the mocks and the
   prose are markup, not JS. */

const REPO = 'https://github.com/fiorelorenzo/canonry/issues/';
/* Rounds one and two were taken in one sitting; H1 came a day later and carries its own
   `dt`, so nothing here claims a single date for the whole set. */
const DECIDED_ON = '2026-08-13';
const decidedOn = (d) => d.dt || DECIDED_ON;

const UX_REGISTER = [
  { s: 'Foundations', id: 'A1', f: 'a1-visual-language.html', t: 'Visual language and density',
    q: 'Which skin does a wiki that runs at a table wear?', w: 'now', i: [104, 3],
    d: 'B', dn: 'Reading room',
    dnote: 'Taken against my recommendation of A, which is why the whole set now renders in it. The two things A bundled and B does not, a dark theme and a density that suits review queues, come back as G1 and G2 rather than being assumed.' },
  { s: 'Foundations', id: 'A2', f: 'a2-information-architecture.html', t: 'Information architecture and navigation',
    q: 'What are the top-level places in the app, and how does the GM move between them?', w: 'now', i: [104, 19],
    d: 'A', dn: 'Fixed sidebar, universe switcher on top' },
  { s: 'Foundations', id: 'A3', f: 'a3-palette-and-keyboard.html', t: 'Command palette and keyboard vocabulary',
    q: 'One palette for search, navigation, actions and Ask, or separate surfaces?', w: 'soon', i: [104, 75, 53],
    d: 'C', dn: 'One box, routes to the surface that fits',
    dnote: 'Amended: the shortcut vocabulary has to be cross platform, so the modifier map and the bare-key question are pulled out into G3 instead of being settled per component.' },

  { s: 'Canon', id: 'B1', f: 'b1-entry-anatomy.html', t: 'Entry page anatomy',
    q: 'Is an entry a document, a record, or a document with a spine of fields?', w: 'now', i: [15, 105],
    d: 'C', dn: 'Document plus a switching right column' },
  { s: 'Canon', id: 'B2', f: 'b2-editor-and-mentions.html', t: 'Editor model and typed mentions',
    q: 'What does writing feel like, and how does a mention become a relation?', w: 'now', i: [105, 15, 21],
    d: 'C', dn: 'Markdown with live decorations',
    dnote: 'Amended: markdown stays the stored form, and a graphical menu covers everyone who does not want to type it. Which shape that menu takes is G4.' },
  { s: 'Canon', id: 'B3', f: 'b3-relations-and-inference.html', t: 'Relations, inverse labels and one-click typing',
    q: 'How is a typed relation created and confirmed without becoming a form to fill in?', w: 'now', i: [16, 15],
    d: 'A', dn: 'In the margin' },
  { s: 'Canon', id: 'B4', f: 'b4-provenance-and-history.html', t: 'Facts, spans and revision provenance',
    q: 'How much of the extracted layer does the GM see, and how is authorship shown after accept?', w: 'now', i: [17, 18],
    d: 'B', dn: 'On demand' },
  { s: 'Canon', id: 'B5', f: 'b5-works-and-scenes.html', t: 'Works, nodes and affected scenes',
    q: 'How is a campaign edited next to the canon it draws on?', w: 'soon', i: [20],
    d: 'A', dn: 'Tree beside a scene editor' },

  { s: 'The copilot loop', id: 'C1', f: 'c1-ai-text-marking.html', t: 'How unaccepted AI text looks',
    q: 'What makes AI text unmistakable without making the entry unreadable?', w: 'now', i: [106, 66],
    d: 'B', dn: 'Underline and margin marker' },
  { s: 'The copilot loop', id: 'C2', f: 'c2-proposal-routing.html', t: 'Where proposals live',
    q: 'Inline in the entry, a side drawer, or a queue the GM visits?', w: 'now', i: [47, 51],
    d: 'A', dn: 'Inbox' },
  { s: 'The copilot loop', id: 'C3', f: 'c3-propagation-plan.html', t: 'The plan before any diff',
    q: 'How is "this change touches four entries, here is why" shown and edited?', w: 'now', i: [50, 49],
    d: 'A', dn: 'Flat checklist' },
  { s: 'The copilot loop', id: 'C4', f: 'c4-diff-presentation.html', t: 'Per-entry diff layout',
    q: 'Split, unified, or prose with the change marked in place?', w: 'now', i: [51, 48],
    d: 'C', dn: 'In place, with a toggle' },
  { s: 'The copilot loop', id: 'C5', f: 'c5-evidence-display.html', t: 'Evidence on every proposal',
    q: 'Where does the source sentence sit, and what replaces a confidence score?', w: 'now', i: [47, 51],
    d: 'B', dn: 'Popover on the changed text',
    dnote: 'Amended (#270): the popover is forced open whenever nothing but weak evidence backs a candidate, which is embedding similarity or, for a proposal the GM asked for in Ask, their own request. It names which of the two at the top, because a header reading "embedding similarity only" over a quote of the GM\u2019s own sentence is its own small lie.' },
  { s: 'The copilot loop', id: 'C6', f: 'c6-accept-and-reject.html', t: 'The accept interaction, and where bulk is allowed',
    q: 'How does a careful review of ten entries stay fast without an accept-all?', w: 'now', i: [51, 42],
    d: 'B', dn: 'Keyboard queue' },
  { s: 'The copilot loop', id: 'C7', f: 'c7-reject-reasons.html', t: 'Capturing a reject reason',
    q: 'One word, and how is it asked for without becoming a survey?', w: 'soon', i: [56],
    d: 'A', dn: 'Chips with a free text escape' },
  { s: 'The copilot loop', id: 'C8', f: 'c8-ask-mode.html', t: 'Ask mode, sources and detail levels',
    q: 'Where does Ask live, and how are its sources and five detail levels presented?', w: 'soon', i: [53, 60],
    d: 'B', dn: 'Command palette',
    dnote: 'Amended: the palette launches the flow, the answer can be moved into a dedicated page, and clicking a source goes to that entry. What the page is for and what a source click does to the answer you are reading is G5.' },
  { s: 'The copilot loop', id: 'C9', f: 'c9-audit-flags.html', t: 'Audit flags and their exact words',
    q: 'Where do flags surface, and what copy stays inside guardrail 7?', w: 'soon', i: [55],
    d: 'B', dn: 'A badge on the entry' },
  { s: 'The copilot loop', id: 'C10', f: 'c10-ai-off.html', t: 'The product with the AI off',
    q: 'What disappears, what stays, and at which scope is the switch?', w: 'now', i: [107],
    d: 'B', dn: 'Per-universe switch' },

  { s: 'Import and onboarding', id: 'D1', f: 'd1-source-selection.html', t: 'How an import starts',
    q: 'One dropzone that detects the source, or a source chosen first?', w: 'now', i: [41, 43, 44],
    d: 'C', dn: 'Detect, then confirm' },
  { s: 'Import and onboarding', id: 'D2', f: 'd2-estimate-and-progress.html', t: 'Estimate, queue and run',
    q: 'What does the GM watch for nine minutes, and how is consent to spend taken?', w: 'now', i: [26, 30, 27],
    d: 'B', dn: 'Live feed of proposals' },
  { s: 'Import and onboarding', id: 'D3', f: 'd3-dry-run-plan.html', t: 'The dry run',
    q: 'How is "142 unchanged, 19 to update, 4 conflicts, 31 new" made walkable?', w: 'now', i: [37, 36],
    d: 'A', dn: 'Four buckets, one card each' },
  { s: 'Import and onboarding', id: 'D4', f: 'd4-import-review.html', t: 'Reviewing a batch of import proposals',
    q: 'Two hundred proposals, guardrail 1 intact, and a GM who will not spend an evening', w: 'now', i: [42],
    d: 'B', dn: 'One queue, C6 vocabulary, filtered' },
  { s: 'Import and onboarding', id: 'D5', f: 'd5-field-conflicts.html', t: 'Field conflicts on re-import',
    q: 'Both versions side by side: which one, and what are the third and fourth choices?', w: 'now', i: [37],
    d: 'A', dn: 'Two columns' },
  { s: 'Import and onboarding', id: 'D6', f: 'd6-ambiguous-match.html', t: 'The one matching question',
    q: 'Same inn or new inn, asked once, with what shown?', w: 'now', i: [37],
    d: 'B', dn: 'Collected, answered before the dry run' },
  { s: 'Import and onboarding', id: 'D7', f: 'd7-onboarding.html', t: 'Signup to first accepted proposal',
    q: 'What is the shortest honest path to the moment the product proves itself?', w: 'now', i: [108, 5],
    d: 'A', dn: 'Import first' },

  { s: 'Table and players', id: 'E1', f: 'e1-table-layout.html', t: 'Table mode and declaring context',
    q: 'A mode, a screen, or a layer over the wiki, and how is "they entered Valdoria" said?', w: 'soon', i: [72, 73],
    d: 'B', dn: 'A mode the whole app switches into' },
  { s: 'Table and players', id: 'E2', f: 'e2-lane-latency.html', t: 'Communicating instant, fast and slow',
    q: 'What replaces a spinner when nothing at the table may wait on a model?', w: 'soon', i: [73, 77, 79],
    d: 'A', dn: 'Progressive arrival, quiet marker' },
  { s: 'Table and players', id: 'E3', f: 'e3-quick-actions.html', t: 'Quick actions at the table',
    q: 'Which actions earn a place, and where do they sit?', w: 'soon', i: [74, 80],
    d: 'C', dn: 'Two-tier dock' },
  { s: 'Table and players', id: 'E4', f: 'e4-table-on-phone.html', t: 'Table mode on a phone',
    q: 'One hand, a lit table, and a GM who cannot look down for long', w: 'soon', i: [81],
    d: 'A', dn: 'Bottom tabs' },
  { s: 'Table and players', id: 'E5', f: 'e5-reveal-interaction.html', t: 'Marking something revealed',
    q: 'Per entry, per fact, or per session log, and how much work is it during play?', w: 'soon', i: [82],
    d: 'C', dn: 'Session log, confirmed afterwards' },
  { s: 'Table and players', id: 'E6', f: 'e6-secrets-authoring.html', t: 'Writing secrets and previewing them',
    q: 'How does the GM see what the party sees without a second copy of the entry?', w: 'soon', i: [84, 85],
    d: 'A', dn: 'Inline block, typed in place' },
  { s: 'Table and players', id: 'E7', f: 'e7-players-wiki.html', t: 'The players wiki',
    q: 'Same skin or its own, and how is the undiscovered presented?', w: 'soon', i: [83, 85],
    d: 'C', dn: 'Shown as a gap' },

  { s: 'Media, money and meta', id: 'F1', f: 'f1-image-generation.html', t: 'Asking for an image, choosing one, marking it',
    q: 'Where does generation start, how many variants, and what does the badge say?', w: 'soon', i: [66, 71, 65],
    d: 'C', dn: 'One action, always confirm the spend' },
  { s: 'Media, money and meta', id: 'F2', f: 'f2-quota-and-cost.html', t: 'Quota, cost and the warm budget',
    q: 'How is spend shown so it is honest without being a dashboard nobody wants?', w: 'soon', i: [88, 89, 78],
    d: 'A', dn: 'A meter in the shell' },
  { s: 'Media, money and meta', id: 'F3', f: 'f3-privacy-and-keys.html', t: 'Provider transparency and BYO key',
    q: 'How is guardrail 5 said in plain words, and where does a key go?', w: 'soon', i: [90, 109],
    d: 'C', dn: 'Contextual, at the moment content leaves' },
  { s: 'Media, money and meta', id: 'F4', f: 'f4-export-and-lock-in.html', t: 'Export and the lock-in answer',
    q: 'What does markdown export look like, and where is it advertised?', w: 'later', i: [21],
    d: 'A', dn: 'Flat zip, in Settings, unadvertised',
    dnote: 'Taken against my recommendation of C. It settles the shape of export and leaves the marketing half open, because SPEC 13 ships export on day one precisely to answer the Realm Works objection, and an unadvertised feature answers nobody. That is G10.' },
  { s: 'Media, money and meta', id: 'F5', f: 'f5-metrics-dashboard.html', t: 'The metrics surface',
    q: 'Accept rate and time to first value: internal only, or shown to the GM?', w: 'later', i: [100, 101, 103],
    d: 'B', dn: 'An admin surface inside the product' },
  { s: 'Media, money and meta', id: 'F6', f: 'f6-landing-and-demo.html', t: 'Landing page and the propagation demo',
    q: 'How is the loop shown on a page that must never overpromise?', w: 'now', i: [3, 4],
    d: 'C', dn: 'The demo as the hero, no copy above it' },

  /* Round two: what the first 38 answers opened. All eleven decided 2026-08-13. */
  { s: 'Round two', id: 'G1', f: 'g1-dark-half.html', t: 'The dark half of the reading room',
    q: 'Does table mode get a warm dark palette, or does the reading room stay light everywhere?', w: 'now', i: [104, 72, 81],
    d: 'B', dn: 'Dark as a whole-app preference',
    dnote: 'Taken against my recommendation of A. Dark is a setting for the entire product, prep included, and table mode simply inherits whatever the preference already is rather than forcing it. So the dark palette is not a table-mode skin, it is half the design system, and every surface has to be checked in both.' },
  { s: 'Round two', id: 'G2', f: 'g2-where-serif-stops.html', t: 'Where serif stops',
    q: 'Which surfaces keep the serif measure, and which go back to sans because they are dense?', w: 'now', i: [104, 105, 51],
    d: 'C', dn: 'Serif everywhere, including tables',
    dnote: 'Taken against my recommendation of A, so there is no boundary rule to apply and no exception to argue about: serif goes all the way down to the number columns. Two implementation consequences follow and are not optional, since serif figures are proportional by default: numeric columns get tabular figures, and identifiers, hashes and code keep the mono face.' },
  { s: 'Round two', id: 'G3', f: 'g3-shortcuts-cross-platform.html', t: 'One shortcut map on three platforms',
    q: 'Which modifiers, which bare keys, and what happens where the browser already owns the combination?', w: 'now', i: [104, 75, 51],
    d: 'B', dn: 'Bare keys inside a review surface, modifiers everywhere else' },
  { s: 'Round two', id: 'G4', f: 'g4-formatting-menu.html', t: 'The formatting menu for people who do not type markdown',
    q: 'Toolbar, slash menu, selection bubble, or more than one of them?', w: 'now', i: [105],
    d: 'A', dn: 'Always-visible toolbar' },
  { s: 'Round two', id: 'G5', f: 'g5-ask-page-and-sources.html', t: 'The Ask page, and what clicking a source does',
    q: 'What is the dedicated page for, and does following a source leave the answer behind?', w: 'now', i: [53, 60],
    d: 'A', dn: 'Expand in place, sources in a side panel',
    dnote: 'Amended: the expand-in-place half of A stands, and the source click does not. No popover preview and no navigation: clicking a source opens a side panel holding that entry, with the answer still readable beside it. That is A for the page and C for the click.' },
  { s: 'Round two', id: 'G6', f: 'g6-silent-merge-bucket.html', t: 'Whether the update bucket needs an accept at all',
    q: 'Nineteen fields the GM never touched: informational, bulk acceptable, or one accept each?', w: 'now', i: [37, 42, 36],
    d: 'A', dn: 'Informational, no accept',
    dnote: 'Already reflected in the spec: guardrail 1 in SPEC 3 now names this as its one exception, and D3 loses the Accept all 19 control the old wording had permitted.' },
  { s: 'Round two', id: 'G7', f: 'g7-reveal-lag.html', t: 'The players wiki between the session and the confirmation',
    q: 'Reveals are confirmed after the table breaks, so what do players see in the meantime?', w: 'now', i: [82, 83, 85],
    d: 'C', dn: 'Live for what is tapped, log for the rest' },
  { s: 'Round two', id: 'G8', f: 'g8-proposals-during-play.html', t: 'Proposals arriving during play',
    q: 'Does the inbox exist in table mode, and does propagation keep running while a session is open?', w: 'soon', i: [47, 72, 79],
    d: 'B', dn: 'Keeps running, silent, counted on the way out' },
  { s: 'Round two', id: 'G9', f: 'g9-meter-with-ai-off.html', t: 'What the meter shows when the AI is off',
    q: 'Per-universe off plus a shell meter: what does the meter say, and does retrieval count as AI?', w: 'soon', i: [107, 88, 19],
    d: 'A', dn: 'Generation stops, retrieval keeps reading',
    dnote: 'Taken against my recommendation of B, and it carries the cost the page itself named: a universe whose badge says off still spends the quota through search and retrieval, and its content still leaves for an embedding provider. That is defensible, because reading is most of what makes this a good wiki, but it makes the switch\'s name and the sentence beside it load-bearing rather than cosmetic, which is H1.' },
  { s: 'Round two', id: 'G10', f: 'g10-lock-in-answer.html', t: 'Where the lock-in answer is said out loud',
    q: 'Export sits unadvertised in Settings, so who ever hears that it exists?', w: 'soon', i: [21, 3, 109],
    d: 'A', dn: 'Landing, below the demo, plus a docs page' },
  { s: 'Round two', id: 'G11', f: 'g11-when-to-ask-before-spending.html', t: 'How often the product asks before it spends',
    q: 'Every paid action, above a threshold, or once and then a meter?', w: 'now', i: [66, 88, 30],
    d: 'A', dn: 'Confirm every paid action' },

  /* Round three: one question, opened by G9 and answered with a mechanism none of its
     options had. */
  { s: 'Round three', id: 'H1', f: 'h1-what-off-is-called.html', t: 'What the switch is called when off still spends',
    q: 'G9 keeps retrieval running with the AI off, so what is that switch named, what does the sentence beside it promise, and does reading count against the quota?', w: 'now', i: [107, 88, 109, 113],
    d: 'B', dn: 'Reading is free, and every price lives in a table', dt: '2026-08-14',
    dnote: 'Answered by removing the problem rather than by wording around it. Reading is free: embeddings, semantic search, mention suggestions and the retrieval behind an Ask never draw on the quota, so the meter no longer moves for a universe whose switch is off and B\'s half of the question is settled. The switch is named for what it stops, writing, which was A\'s half. The mechanism is neither option\'s: the credit price of every operation lives in an `operation_price` row an admin edits, a price of zero is how something becomes free, and an unpriced operation fails loudly. Free to the user is still recorded at full cost to us, because the margin question is answered from those rows. In SPEC 15 and guardrail 4, and built in #113.' },
  { s: 'Round three', id: 'H2', f: 'h2-brand-and-logo.html', t: 'The mark, the favicon and what the brand may spend',
    q: 'Both properties are public and wearing the browser\'s default icon: what is the mark, and what does it say?',
    w: 'now', i: [3, 104],
    d: 'C', dn: 'The tie: two entries and the link between them', dt: '2026-08-14',
    dnote: 'Recorded here late: DECISIONS.md carried this answer from the day it was taken and the register did not.' },

  /* Round four: not questions asked before the code, but what the shipped UI asked back.
     All ten live in one artifact, product-pass.html, which audits every surface rather
     than posing one question, so every entry below points at the same file. */
  { s: 'Round four', id: 'I1', f: 'product-pass.html#i1', t: 'The app root, signed out',
    q: 'The landing page ships from another repository, so what does the application itself serve at / to somebody signed out?', w: 'now', i: [138, 136], dt: '2026-08-15',
    d: 'B', dn: 'A door page',
    dnote: 'Taken against my recommendation of A, a redirect to sign-in. The app keeps a signed-out root, which is friendlier to a bookmarked domain and accepts the cost A avoided: the pitch now exists in two repositories, and the app\'s copy is the one nobody will remember to update. Its sentence is a guardrail 7 surface here too.' },
  { s: 'Round four', id: 'I2', f: 'product-pass.html#i2', t: 'Sign in and sign up',
    q: 'A left-aligned form with the language toggle louder than the product: what shape do the two auth pages take?', w: 'now', i: [139], dt: '2026-08-15',
    d: 'C', dn: 'Title page for sign-in, split for sign-up',
    dnote: 'Two answers, one layout: C is the title page, B is C with a right pane carrying the product\'s one trick, drawn static and with no accept control on it. The door is quiet and the screen where somebody decides to sign up carries the argument.' },
  { s: 'Round four', id: 'I3', f: 'product-pass.html#i3', t: 'The home page, and whether the shell reaches it',
    q: 'Signing in lands on a chrome-less page: does A2\'s sidebar frame the whole product or only a universe?', w: 'now', i: [141, 140], dt: '2026-08-15',
    d: 'B', dn: 'The shell reaches outside a universe',
    dnote: 'With C\'s redirect as the zero-universe behaviour, so the two compose. A2 is not amended, its seven items still describe a universe; what changes is that the frame belongs to the product. I5, I6 and half of I1 all resolve into this one piece of work.' },
  { s: 'Round four', id: 'I4', f: 'product-pass.html#i4', t: 'Creating a universe',
    q: 'Two rival creation routes exist and neither is linked: which one survives?', w: 'now', i: [142], dt: '2026-08-15',
    d: 'B', dn: 'One creation surface, three starts' },
  { s: 'Round four', id: 'I5', f: 'product-pass.html#i5', t: 'Where the language switch lives',
    q: 'The switcher exists only where there is no account to save it to: where does it go once there is one?', w: 'now', i: [144], dt: '2026-08-15',
    d: 'B', dn: 'A row in the account menu, endonyms',
    dnote: 'Not flags, and the second reason is the product rather than cartography: the entry\'s own canon language is a separate per-entry claim, so a flag in the chrome reads as "translate this page", which guardrail 1 forbids. If the top bar ever wants the control, it carries the endonym as text.' },
  { s: 'Round four', id: 'I6', f: 'product-pass.html#i6', t: 'The account, and five settings pages with no home',
    q: 'There is no account page and four of the five settings leaves cannot be reached by clicking: what holds them?', w: 'now', i: [143], dt: '2026-08-15',
    d: 'B', dn: 'An account menu plus one two-pane settings page' },
  { s: 'Round four', id: 'I7', f: 'product-pass.html#i7', t: 'The universe home and the entry browser',
    q: '214 entries, no list, no filter, no search: is the home a dashboard, a browser, or both?', w: 'now', i: [145, 283], dt: '2026-08-15',
    d: 'C', dn: 'One page, browser with a collapsible overview strip (superseded by O1)',
    dnote: 'Superseded by O1 on 2026-08-19, and the only round four answer the shipped version of itself argued out of. One page in two modes was more than the zero the product had at the time; having used it, the strip is too small to be a home and the list is too plain to be a browser. O1 = C splits them: a world home at /w/<slug> and the browser as a dense table at /w/<slug>/entries.' },
  { s: 'Round four', id: 'I8', f: 'product-pass.html#i8', t: 'Empty states, as a pattern',
    q: 'Ten hand-written sentences with no actions: one component, or nine deliberate one-offs?', w: 'now', i: [146], dt: '2026-08-15',
    d: 'A', dn: 'One component, three variants',
    dnote: 'Cold start gets a primary action, a settled state stays a plain sentence and never grows a button that invents work, and a derived absence explains what it waits on.' },
  { s: 'Round four', id: 'I9', f: 'product-pass.html#i9', t: 'Who owns the controls',
    q: '73 distinct button-shaped class strings and no component layer: extract our own, or adopt the one the spec already named?', w: 'now', i: [147], dt: '2026-08-15',
    d: 'C', dn: 'shadcn-svelte as the control layer',
    dnote: 'Taken against my recommendation of B, extracting six of our own. The argument that wins is the one C\'s costs understated: the six B would extract are the easy six, and the hard three, a dialog, a dropdown and a popover with real focus management, are exactly what B leaves hand-rolled. Four consequences are recorded in DECISIONS.md, checked against shadcn-svelte 1.5.0: a token mapping block from the reading room\'s names into theirs, its dark variant redefined against our [data-theme] attribute, the CLI copying source rather than adding a runtime dependency, and an icon set arriving as a dependency that is really a design decision.' },
  { s: 'Round four', id: 'I10', f: 'product-pass.html#i10', t: 'The phone',
    q: 'Seventeen responsive utilities in the whole app, six of them in table mode: is the phone a client?', w: 'now', i: [148], dt: '2026-08-15',
    d: 'B', dn: 'One responsive shell',
    dnote: 'E4\'s bottom tabs generalise past table mode. It is a pass over every route rather than a new screen, so it wants to land with the shell rather than after it.' },

  /* Round five: one question the shipped UI's own bug (#153) forced rather than a page of
     drawn options, so it has no artifact and points straight at DECISIONS.md. */
  { s: 'Round five', id: 'J1', f: 'DECISIONS.md', t: 'The URL namespace, now that profiles are certain',
    q: 'User profiles are coming rather than hypothetical: what do the top-level URL segments mean, and does that answer #153\'s uniqueness question or just move it?', w: 'now', i: [156, 153, 157, 158], dt: '2026-08-15',
    d: 'D', dn: 'A fourth way: /u/ a person, /w/ a world, /p/ stays the players\' wiki',
    dnote: '#153 was framed as a scoping question, global uniqueness or resolution scoped to the viewer, my own preference going in. J1 answers a different question instead and settles #153 as a side effect: /u/ was always going to mean a person once profiles were real (#158), so the GM-side app moves to /w/<slug> (#157) and world slugs become globally unique because a world\'s URL still carries no owner. No artifact for this one, recorded directly in DECISIONS.md rather than drawn as options first.' },

  /* Round six: the product had already answered this question twice, differently, in code
     rather than in a decision - free in the schema and the import tool, fixed in the shipped
     catalogue and invisible in the UI. No drawn options either, so like J1 this points
     straight at DECISIONS.md rather than an artifact. */
  { s: 'Round six', id: 'K1', f: 'DECISIONS.md', t: 'Relation types: fixed catalogue or free labels',
    q: 'Is the relation vocabulary between entities a fixed set the shipped catalogue closes, or can the Loremaster invent one and have it stick?', w: 'now', i: [188, 189, 190, 191, 192], dt: '2026-08-16',
    d: 'B', dn: 'Free labels, reconciled: propose any label, resolve it against what exists, a human accepts the type',
    dnote: 'The product was already both answers at once: relation_type is a free-text table scoped per universe and the import tool already lets a model mint one (findOrCreateRelationType, packages/db/src/queries/import.ts:728), while the shipped catalogue is ten migration-seeded labels RelationsPanel.svelte cannot even show. K1 picks free, then spends the decision on what makes free safe: a resolver (#189) that matches a proposed label against the universe\'s own types and the shipped catalogue before anything is written, normalised match first, then a type\'s own inverse label, then semantic with no similarity number ever shown to a GM (D6\'s rule again), then an allowed-type check that answers #191 by making allowed_from/allowed_to a real constraint instead of a column nothing reads. Only an existing-type match may act without a human; everything else is a proposal #190 turns into an import-review question, asked once per label rather than once per relation. #192 gives a GM the same accept by hand: a catalogue page to see every type, rename or merge a universe\'s own, and widen what it admits, with the ten shipped labels staying a migration\'s to change, not a settings control\'s.' },
  /* Round seven: what K1's free labels do when the interface changes language. */
  { s: 'Round seven', id: 'L1', f: 'DECISIONS.md', t: 'Relation labels when the interface changes language',
    q: 'A relation label reads as interface, so a language switch should change it. Which labels, and how, without making anybody wait?',
    w: 'now', i: [194, 195, 196, 197, 198], dt: '2026-08-16',
    d: 'A', dn: 'Identity moves off the label',
    dnote: 'The label was doing three jobs and only one was display: it was the unique key in Postgres, the value inside proposal.evidence paths, what reject-signal.ts compares, what db-graph.ts builds the traversal on, and what the model reads in a prompt. Translating it for the reader would have made all four vary by who was looking, which is invisible and degrades the copilot rather than announcing itself. So a stable `key` carries identity and survives a rename, the ten shipped labels ship in the i18n bundle in every locale the way entity type names already do, and a universe\'s own labels display as authored because SPEC 17 rule 3 keeps canon in its own language. Nobody waits because nothing is translated: the switch repaints from the bundle. It also fixed a bug no fixture could catch, since every fixture world is English: an Italian world could not use the shipped catalogue at all, forking eleven duplicates of it on first import.' },

  /* Round eight: the product shipped, so the page in front of it is answering the wrong question. */
  { s: 'Round eight', id: 'M1', f: 'DECISIONS.md', t: 'What the landing page is for once the product exists',
    q: 'The product is built and canonry.io still says "coming". What is the landing page for now?',
    w: 'now', i: [151, 154], dt: '2026-08-19',
    d: 'A', dn: 'A door, not a waiting list',
    dnote: 'F6 and G10 both still hold, the demo stays the hero and the export sentence stays under it: what changed is that there is now a product behind them. app.canonry.io serves the whole thing on a tagged release, so a page collecting addresses in front of it asks people to wait for something they could be using. The order is the part on the record rather than the layout: there is no password recovery and no account deletion yet, both blocked on a mail transport that is now bought and verified, so the sign-up call to action ships after those and the first version can point at a published players wiki, which is a real public surface a stranger can read without an account. And the waiting list becomes its own decision rather than a leftover, because waitlist_signup records an address and a timestamp and nothing about what was agreed, so it either becomes a named newsletter opt-in with consent recorded at the moment it is given, or it is retired: what it cannot do is quietly become a marketing list, since the people on it asked to be told when Canonry launched.' },

  /* Round nine: the propagation cap was a hardcoded ~10 in SPEC.md with no arithmetic
     behind it. No drawn options, like J1/K1/L1/M1, so this points straight at
     DECISIONS.md rather than an artifact. */
  { s: 'Round nine', id: 'N1', f: 'DECISIONS.md', t: 'The propagation cap becomes a per-universe setting',
    q: 'SPEC 5.1\'s cap was a hardcoded ~10 with no arithmetic behind it - does it become a per-universe setting, and what happens at its edges: no limit, and a GM who already said a plan was "too much"?',
    w: 'now', i: [50, 56], dt: '2026-08-19',
    d: 'A', dn: 'A per-universe setting, 25 by default, with an explicit no-limit option',
    dnote: 'universe.propagation_cap is a nullable integer rather than a sentinel: 0 collides with the state effectiveCap\'s own floor already refuses to produce, and a very large number lies about what "no limit" means the moment somebody reads the column, so null is the only value that means the same thing everywhere it is read. 25 is not a guess: propagate.plan costs 1 credit and propagate.diff costs 1 credit per surviving candidate (migration 0004), so a cap of 25 bounds one save\'s worst case at 26 credits, 0.52% of the included tier\'s 5,000 credits per period - generous enough that a real two-hop neighbourhood rarely gets truncated, still a real ceiling. The old 10 bounded the same worst case at 11 credits, 0.22% of a period, conservative enough that nobody had ever checked it against anything. effectiveCap keeps tightening a numeric cap by one per recent "too much", floored at 3, but a null cap has nothing to tighten and the floor never resurrects a limit the GM explicitly turned off - effectiveCap(null, ...) returns null, not 3. proposal_plan.candidate_cap drops its NOT NULL for the same reason: it records the cap actually in effect when a plan was written, and a plan written with no limit has to be able to say so.' },

  /* Round ten: the other direction again, like round four. I opened the deployed preview
     and disliked four things about it, so these four were drawn as options first and
     answered the same day. All four took the recommendation, which no earlier round did.
     Filed as epic #282. */
  { s: 'Round ten', id: 'O1', f: 'o1-world-overview.html', t: 'What a world\'s home page is for',
    q: 'The universe home is four small cells over a flat list. Is it big editorial sections, a browser that grows up, or two surfaces?',
    w: 'now', i: [283, 282, 145], dt: '2026-08-19',
    d: 'C', dn: 'Two surfaces, honestly split',
    dnote: 'Amends I7 = C, which is the part that had to be written down rather than shipped quietly: /w/<slug> becomes a world home, the browser moves to /w/<slug>/entries as a dense sortable table, and I7\'s row in round four now reads as superseded. Three consequences are not optional: the sidebar\'s Entries item points at the table while the world switcher keeps the home, the loader gets real pagination it does not have today (+page.server.ts:76 takes up to 500 entries with no pages), and the home\'s card thumbnails read O2\'s entity.cover_asset_id rather than inventing a second way to pick an image.' },
  { s: 'Round ten', id: 'O2', f: 'o2-entry-page-and-cover.html', t: 'The entry\'s cover image, and the aside that clips',
    q: 'An entry has no cover image and a five-tab aside that clips its own last label at 256px. Where does the cover live, and what carries the structured layer?',
    w: 'now', i: [284, 282, 105, 66], dt: '2026-08-19',
    d: 'A', dn: 'Cover band, aside loses its tabs',
    dnote: 'Taken with the two amendments the recommendation already carried: the band is capped at about a fifth of the first screenful, there is no dashed placeholder for somebody who cannot write to that world (amended round eleven, P6: there is one for somebody who can, and it is the affordance that starts a generation), and the crop ratio follows the entity type, wide for a place and closer to square for a person. The column is a nullable entity.cover_asset_id with on delete set null, not a role column on media_asset, because one cover per entity is a single fact about the entity and a role column invites two rows claiming it. The Images panel\'s "use as cover" is the accept, so guardrail 1 holds without a second mechanism, and published_to_players still gates the cover on /p/<slug> (guardrail 6). The aside\'s five collapsible sections fix EntryTabs.svelte:92-96 by having no strip to clip, rather than by a truncate that would still depend on how long a translated word is. B1 = C is not amended: what changes is the switch, not the document.' },
  { s: 'Round ten', id: 'O3', f: 'o3-loremaster-quick-ask.html', t: 'The copilot\'s front door',
    q: 'Ask has three doors, all of which navigate away, and it remembers nothing. Does the copilot get a floating composer on every page, and what does the dedicated page become?',
    w: 'now', i: [285, 282, 290, 149], dt: '2026-08-19',
    d: 'A', dn: 'A floating pill that expands in place',
    dnote: 'Six amendments, four from the recommendation and two taken on the pick. From the recommendation: the pill mounts the palette\'s own input in a docked placement so A3 = C keeps one box rather than growing a sibling (#149 grows that placement), it hides in table mode where E3\'s dock owns the corner, it becomes a tab in the phone\'s bottom bar rather than a circle over the content (E4, I10), and "keep" is the only write, which is what lets the dedicated page be a history rather than a transcript. Taken on the pick: the pill and its panel wear the theme\'s own colours instead of the copilot\'s violet, and an icon closes the panel instead of the word. That second pair does not repeal C1: violet stays reserved for AI text nobody has accepted, and the answer streaming inside the panel keeps its marking, so what loses the violet is the furniture. The cost is accepted rather than argued away, the launcher stops announcing itself as the copilot by colour and the name and icon carry that alone. The close control keeps its accessible name in aria-label. What O3 does not settle is what a kept answer is stored in, for how long, and what the guardrail 5 sentence says: nothing in packages/db/src/schema holds a question today, so that is #290 and the word "history" appears in no label until it lands.' },
  { s: 'Round ten', id: 'O4', f: 'o4-select-control.html', t: 'Ten controls that still open the browser\'s own select',
    q: 'Which control replaces a native select, and does one control fit both a two-option toggle and every entity in the world?',
    w: 'soon', i: [286, 282, 155], dt: '2026-08-19',
    d: 'B', dn: 'Three controls, chosen by what the list is',
    dnote: 'The boundary is what the list is rather than how long it is, which removes the threshold nobody could have defended at a review: a binary or ternary state gets a segmented control, a vocabulary the product ships gets a Select, and a list drawn from the GM\'s own data gets a Combobox with search. It is more code than one control everywhere and the extra code is exactly where the pain is. Two obligations ride along: every one of the ten call sites decides explicitly whether it keeps working without JS, since a native select posts and a popover does not, and all three controls arrive with their dark pass rather than after it (G1). Closes the select half of #155 rather than opening a direction, because I9 = C already made shadcn-svelte the control layer.' },
];

const KEY = (id) => `canonry.ux.${id}`;

function readChoice(id) {
  try { return JSON.parse(localStorage.getItem(KEY(id)) || 'null'); } catch { return null; }
}
function writeChoice(id, value) {
  try {
    if (value === null) localStorage.removeItem(KEY(id));
    else localStorage.setItem(KEY(id), JSON.stringify(value));
  } catch { /* file:// with storage disabled: the page still works, it just cannot remember */ }
}
/* One accessor for both kinds of answer: a decision recorded in the register wins over
   anything a browser remembers, because the register is what a fresh reader sees. */
function decisionOf(d) {
  if (d.d) return { pick: d.d, name: d.dn, note: d.dnote || '', at: decidedOn(d), firm: true };
  const c = readChoice(d.id);
  return c ? { pick: c.pick, name: c.name, note: c.note || '', at: new Date(c.at).toISOString().slice(0, 10), firm: false } : null;
}

/* ---- page head, breadcrumb, prev/next ---- */
function injectHead() {
  const id = document.body.dataset.decision;
  if (!id) return;
  const idx = UX_REGISTER.findIndex((d) => d.id === id);
  if (idx < 0) return;
  const d = UX_REGISTER[idx];
  document.title = `${d.id} · ${d.t} · Canonry UX`;

  const top = document.querySelector('[data-ux-top]');
  if (top) {
    top.innerHTML = `<a href="index.html">Canonry UX audit</a><span>/</span><span>${d.s}</span>
      <span class="sp"></span><span>${idx + 1} of ${UX_REGISTER.length}</span>`;
  }

  const head = document.querySelector('[data-ux-head]');
  if (head) {
    const issues = d.i.map((n) => `<a href="${REPO}${n}">#${n}</a>`).join(', ');
    const state = d.d
      ? `<span class="badge done">decided ${d.d}: ${d.dn}</span>`
      : `<span class="badge ${d.w}">decide ${d.w}</span>`;
    head.innerHTML = `
      <div class="eyebrow"><span>${d.id}</span><span>·</span><span>${d.s}</span>${state}</div>
      <h1>${d.t}</h1>
      <p class="q">${d.q}</p>
      <div class="facts"><span><b>Blocks</b> ${issues}</span>
        <span><b>Sample world</b> <a href="SAMPLE-WORLD.md">Valdoria Reach</a></span>
        ${d.d ? `<span><b>Decided</b> ${decidedOn(d)}, see <a href="DECISIONS.md">DECISIONS.md</a></span>` : ''}</div>`;
  }

  const nav = document.querySelector('[data-ux-nav]');
  if (nav) {
    const prev = UX_REGISTER[idx - 1];
    const next = UX_REGISTER[idx + 1];
    nav.innerHTML = `
      ${prev ? `<a href="${prev.f}">&larr; ${prev.id} ${prev.t}</a>` : '<span class="muted">start of the set</span>'}
      <span class="sp"></span>
      <a href="index.html">All decisions</a>
      <span class="sp"></span>
      ${next ? `<a href="${next.f}">${next.id} ${next.t} &rarr;</a>` : '<span class="muted">end of the set</span>'}`;
  }
}

/* ---- the recorder, or the record ---- */
function injectRecorder() {
  const box = document.querySelector('[data-ux-record]');
  const id = document.body.dataset.decision;
  if (!box || !id) return;
  const entry = UX_REGISTER.find((x) => x.id === id);
  if (!entry) return;

  if (entry.d) {
    box.innerHTML = `
      <div class="row"><span class="badge done">${entry.d}</span>
        <b>${entry.dn}</b><span class="muted">decided ${decidedOn(entry)}</span></div>
      ${entry.dnote ? `<p class="small" style="margin:12px 0 0;max-width:56em;">${entry.dnote}</p>` : ''}
      <div class="state">This is the record, not a browser's memory. To change it, edit
        <code>DECISIONS.md</code> and the register in <code>assets/ux.js</code>, and say so
        on the issues this blocks.</div>`;
    return;
  }

  const labels = [...document.querySelectorAll('.opt > header')].map((h) => ({
    letter: (h.querySelector('.ltr')?.textContent || '?').trim(),
    name: (h.querySelector('h3')?.textContent || '').trim(),
  }));

  const row = document.createElement('div');
  row.className = 'row';
  const note = document.createElement('textarea');
  note.placeholder = 'Why, in one line. This is the sentence that ends up in the issue.';
  const state = document.createElement('div');
  state.className = 'state';

  const paint = () => {
    const cur = readChoice(id);
    [...row.querySelectorAll('.btn[data-pick]')].forEach((b) => {
      b.classList.toggle('on', !!cur && cur.pick === b.dataset.pick);
    });
    if (cur) {
      note.value = cur.note || '';
      state.innerHTML = `Recorded <b>${cur.pick}</b> on ${new Date(cur.at).toLocaleDateString('en-GB')}.
        <button class="btn sm" data-clear>Clear</button>`;
      state.querySelector('[data-clear]').onclick = () => { writeChoice(id, null); note.value = ''; paint(); };
    } else {
      state.textContent = 'Nothing recorded yet. This is kept in your browser only, and the index can export the set as markdown.';
    }
  };

  labels.forEach((l) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.dataset.pick = l.letter;
    b.textContent = `Choose ${l.letter}: ${l.name}`;
    b.onclick = () => { writeChoice(id, { pick: l.letter, name: l.name, note: note.value, at: Date.now() }); paint(); };
    row.appendChild(b);
  });

  note.addEventListener('change', () => {
    const cur = readChoice(id);
    if (cur) writeChoice(id, { ...cur, note: note.value });
  });

  box.append(row, note, state);
  paint();
}

/* ---- the register table on the index ---- */
function injectRegister() {
  const host = document.querySelector('[data-ux-register]');
  if (!host) return;
  let html = `<table class="reg"><thead><tr><th>Id</th><th>Decision</th><th>The question</th><th>When</th><th>Blocks</th><th>Decided</th></tr></thead><tbody>`;
  let section = null;
  for (const d of UX_REGISTER) {
    if (d.s !== section) {
      section = d.s;
      html += `<tr class="sect"><td colspan="6">${section}</td></tr>`;
    }
    const c = decisionOf(d);
    const cell = c
      ? `<span class="badge ${c.firm ? 'done' : 'ok'}">${c.pick}</span> ${c.name}${c.firm ? '' : ' <span class="muted">(local)</span>'}`
      : '<span class="muted">open</span>';
    html += `<tr>
      <td class="id"><a href="${d.f}">${d.id}</a></td>
      <td><a href="${d.f}">${d.t}</a></td>
      <td class="q">${d.q}</td>
      <td>${d.d ? '<span class="muted small">done</span>' : `<span class="badge ${d.w}">${d.w}</span>`}</td>
      <td class="iss small muted nowrap">${d.i.map((n) => `<a href="${REPO}${n}">#${n}</a>`).join(' ')}</td>
      <td class="small">${cell}</td>
    </tr>`;
  }
  host.innerHTML = html + '</tbody></table>';

  const open = UX_REGISTER.filter((d) => !d.d);
  const openNow = open.filter((d) => d.w === 'now').length;
  const localPicks = open.filter((d) => readChoice(d.id)).length;
  const tally = document.querySelector('[data-ux-tally]');
  if (tally) {
    const parts = [`<b>${UX_REGISTER.length - open.length} of ${UX_REGISTER.length}</b> decided`];
    if (open.length) parts.push(`<b>${open.length}</b> still open, ${openNow} of them to take now`);
    else parts.push('nothing open');
    if (localPicks) parts.push(`${localPicks} picked in this browser but not yet written into the record`);
    parts.push('dates per decision in <a href="DECISIONS.md">DECISIONS.md</a>');
    tally.innerHTML = parts.join('. ') + '.';
  }
}

function injectExport() {
  const btn = document.querySelector('[data-ux-export]');
  const out = document.querySelector('[data-ux-exportout]');
  if (!btn || !out) return;
  btn.onclick = () => {
    const lines = ['# Canonry UX decisions', ''];
    let section = null;
    for (const d of UX_REGISTER) {
      const c = decisionOf(d);
      if (!c || c.firm) continue;
      if (d.s !== section) { section = d.s; lines.push(`## ${section}`, ''); }
      lines.push(`- **${d.id} ${d.t}** — chose ${c.pick} (${c.name}).${c.note ? ` ${c.note}` : ''}`);
      lines.push(`  Blocks ${d.i.map((n) => `#${n}`).join(', ')}.`);
    }
    if (lines.length === 2) lines.push('_Nothing new recorded in this browser. The decisions already taken are in DECISIONS.md._');
    out.value = lines.join('\n');
    out.hidden = false;
    out.select();
  };
}

/* ---- small helpers pages can use ---- */
/* Tab switcher: <div class="uxtabs" data-ux-tabs="groupname"> with buttons
   data-pane="x", panes <div class="uxpane" data-group="groupname" data-name="x">. */
function initTabs() {
  document.querySelectorAll('[data-ux-tabs]').forEach((bar) => {
    const group = bar.dataset.uxTabs;
    const panes = [...document.querySelectorAll(`.uxpane[data-group="${group}"]`)];
    const buttons = [...bar.querySelectorAll('[data-pane]')];
    const show = (name) => {
      panes.forEach((p) => { p.hidden = p.dataset.name !== name; });
      buttons.forEach((b) => b.classList.toggle('on', b.dataset.pane === name));
    };
    buttons.forEach((b) => { b.onclick = () => show(b.dataset.pane); });
    show(buttons[0]?.dataset.pane);
  });
}

/* Class toggle: <button data-ux-toggle="target-id" data-class="ai-off">. */
function initToggles() {
  document.querySelectorAll('[data-ux-toggle]').forEach((b) => {
    b.onclick = () => {
      const t = document.getElementById(b.dataset.uxToggle);
      if (!t) return;
      const on = t.classList.toggle(b.dataset.class);
      b.classList.toggle('on', on);
      const alt = b.dataset.altLabel;
      if (alt) { const keep = b.textContent; b.textContent = alt; b.dataset.altLabel = keep; }
    };
  });
}

/* Click-to-open evidence popovers, for touch and for keyboard. */
function initEvidence() {
  document.querySelectorAll('.ev > .q').forEach((q) => {
    q.tabIndex = 0;
    const wrap = q.parentElement;
    q.onclick = () => wrap.classList.toggle('open');
    q.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wrap.classList.toggle('open'); } };
  });
}

document.addEventListener('DOMContentLoaded', () => {
  injectHead();
  injectRecorder();
  injectRegister();
  injectExport();
  initTabs();
  initToggles();
  initEvidence();
  window.UX_REGISTER = UX_REGISTER;
});
