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
    d: 'B', dn: 'Popover on the changed text' },
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
    w: 'now', i: [3, 104] },
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
