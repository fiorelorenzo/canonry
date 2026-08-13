/* Canonry UX decision artifacts — shared runtime.
   Owns three things so no page has to repeat them:
   1. UX_REGISTER, the single list of decisions (order, titles, blocked issues);
   2. page head, breadcrumb and prev/next, injected from that list;
   3. the recorder: which option was chosen, kept in localStorage, exported as
      markdown from the index.
   Everything degrades to plain HTML if this file fails to load: the mocks and the
   prose are markup, not JS. */

const REPO = 'https://github.com/fiorelorenzo/canonry/issues/';

const UX_REGISTER = [
  { s: 'Foundations', id: 'A1', f: 'a1-visual-language.html', t: 'Visual language and density',
    q: 'Which skin does a wiki that runs at a table wear?', w: 'now', i: [104, 3] },
  { s: 'Foundations', id: 'A2', f: 'a2-information-architecture.html', t: 'Information architecture and navigation',
    q: 'What are the top-level places in the app, and how does the GM move between them?', w: 'now', i: [104, 19] },
  { s: 'Foundations', id: 'A3', f: 'a3-palette-and-keyboard.html', t: 'Command palette and keyboard vocabulary',
    q: 'One palette for search, navigation, actions and Ask, or separate surfaces?', w: 'soon', i: [104, 75, 53] },

  { s: 'Canon', id: 'B1', f: 'b1-entry-anatomy.html', t: 'Entry page anatomy',
    q: 'Is an entry a document, a record, or a document with a spine of fields?', w: 'now', i: [15, 105] },
  { s: 'Canon', id: 'B2', f: 'b2-editor-and-mentions.html', t: 'Editor model and typed mentions',
    q: 'What does writing feel like, and how does a mention become a relation?', w: 'now', i: [105, 15, 21] },
  { s: 'Canon', id: 'B3', f: 'b3-relations-and-inference.html', t: 'Relations, inverse labels and one-click typing',
    q: 'How is a typed relation created and confirmed without becoming a form to fill in?', w: 'now', i: [16, 15] },
  { s: 'Canon', id: 'B4', f: 'b4-provenance-and-history.html', t: 'Facts, spans and revision provenance',
    q: 'How much of the extracted layer does the GM see, and how is authorship shown after accept?', w: 'now', i: [17, 18] },
  { s: 'Canon', id: 'B5', f: 'b5-works-and-scenes.html', t: 'Works, nodes and affected scenes',
    q: 'How is a campaign edited next to the canon it draws on?', w: 'soon', i: [20] },

  { s: 'The copilot loop', id: 'C1', f: 'c1-ai-text-marking.html', t: 'How unaccepted AI text looks',
    q: 'What makes AI text unmistakable without making the entry unreadable?', w: 'now', i: [106, 66] },
  { s: 'The copilot loop', id: 'C2', f: 'c2-proposal-routing.html', t: 'Where proposals live',
    q: 'Inline in the entry, a side drawer, or a queue the GM visits?', w: 'now', i: [47, 51] },
  { s: 'The copilot loop', id: 'C3', f: 'c3-propagation-plan.html', t: 'The plan before any diff',
    q: 'How is "this change touches four entries, here is why" shown and edited?', w: 'now', i: [50, 49] },
  { s: 'The copilot loop', id: 'C4', f: 'c4-diff-presentation.html', t: 'Per-entry diff layout',
    q: 'Split, unified, or prose with the change marked in place?', w: 'now', i: [51, 48] },
  { s: 'The copilot loop', id: 'C5', f: 'c5-evidence-display.html', t: 'Evidence on every proposal',
    q: 'Where does the source sentence sit, and what replaces a confidence score?', w: 'now', i: [47, 51] },
  { s: 'The copilot loop', id: 'C6', f: 'c6-accept-and-reject.html', t: 'The accept interaction, and where bulk is allowed',
    q: 'How does a careful review of ten entries stay fast without an accept-all?', w: 'now', i: [51, 42] },
  { s: 'The copilot loop', id: 'C7', f: 'c7-reject-reasons.html', t: 'Capturing a reject reason',
    q: 'One word, and how is it asked for without becoming a survey?', w: 'soon', i: [56] },
  { s: 'The copilot loop', id: 'C8', f: 'c8-ask-mode.html', t: 'Ask mode, sources and detail levels',
    q: 'Where does Ask live, and how are its sources and five detail levels presented?', w: 'soon', i: [53, 60] },
  { s: 'The copilot loop', id: 'C9', f: 'c9-audit-flags.html', t: 'Audit flags and their exact words',
    q: 'Where do flags surface, and what copy stays inside guardrail 7?', w: 'soon', i: [55] },
  { s: 'The copilot loop', id: 'C10', f: 'c10-ai-off.html', t: 'The product with the AI off',
    q: 'What disappears, what stays, and at which scope is the switch?', w: 'now', i: [107] },

  { s: 'Import and onboarding', id: 'D1', f: 'd1-source-selection.html', t: 'How an import starts',
    q: 'One dropzone that detects the source, or a source chosen first?', w: 'now', i: [41, 43, 44] },
  { s: 'Import and onboarding', id: 'D2', f: 'd2-estimate-and-progress.html', t: 'Estimate, queue and run',
    q: 'What does the GM watch for nine minutes, and how is consent to spend taken?', w: 'now', i: [26, 30, 27] },
  { s: 'Import and onboarding', id: 'D3', f: 'd3-dry-run-plan.html', t: 'The dry run',
    q: 'How is "142 unchanged, 19 to update, 4 conflicts, 31 new" made walkable?', w: 'now', i: [37, 36] },
  { s: 'Import and onboarding', id: 'D4', f: 'd4-import-review.html', t: 'Reviewing a batch of import proposals',
    q: 'Two hundred proposals, guardrail 1 intact, and a GM who will not spend an evening', w: 'now', i: [42] },
  { s: 'Import and onboarding', id: 'D5', f: 'd5-field-conflicts.html', t: 'Field conflicts on re-import',
    q: 'Both versions side by side: which one, and what are the third and fourth choices?', w: 'now', i: [37] },
  { s: 'Import and onboarding', id: 'D6', f: 'd6-ambiguous-match.html', t: 'The one matching question',
    q: 'Same inn or new inn, asked once, with what shown?', w: 'now', i: [37] },
  { s: 'Import and onboarding', id: 'D7', f: 'd7-onboarding.html', t: 'Signup to first accepted proposal',
    q: 'What is the shortest honest path to the moment the product proves itself?', w: 'now', i: [108, 5] },

  { s: 'Table and players', id: 'E1', f: 'e1-table-layout.html', t: 'Table mode and declaring context',
    q: 'A mode, a screen, or a layer over the wiki, and how is "they entered Valdoria" said?', w: 'soon', i: [72, 73] },
  { s: 'Table and players', id: 'E2', f: 'e2-lane-latency.html', t: 'Communicating instant, fast and slow',
    q: 'What replaces a spinner when nothing at the table may wait on a model?', w: 'soon', i: [73, 77, 79] },
  { s: 'Table and players', id: 'E3', f: 'e3-quick-actions.html', t: 'Quick actions at the table',
    q: 'Which actions earn a place, and where do they sit?', w: 'soon', i: [74, 80] },
  { s: 'Table and players', id: 'E4', f: 'e4-table-on-phone.html', t: 'Table mode on a phone',
    q: 'One hand, a lit table, and a GM who cannot look down for long', w: 'soon', i: [81] },
  { s: 'Table and players', id: 'E5', f: 'e5-reveal-interaction.html', t: 'Marking something revealed',
    q: 'Per entry, per fact, or per session log, and how much work is it during play?', w: 'soon', i: [82] },
  { s: 'Table and players', id: 'E6', f: 'e6-secrets-authoring.html', t: 'Writing secrets and previewing them',
    q: 'How does the GM see what the party sees without a second copy of the entry?', w: 'soon', i: [84, 85] },
  { s: 'Table and players', id: 'E7', f: 'e7-players-wiki.html', t: 'The players wiki',
    q: 'Same skin or its own, and how is the undiscovered presented?', w: 'soon', i: [83, 85] },

  { s: 'Media, money and meta', id: 'F1', f: 'f1-image-generation.html', t: 'Asking for an image, choosing one, marking it',
    q: 'Where does generation start, how many variants, and what does the badge say?', w: 'soon', i: [66, 71, 65] },
  { s: 'Media, money and meta', id: 'F2', f: 'f2-quota-and-cost.html', t: 'Quota, cost and the warm budget',
    q: 'How is spend shown so it is honest without being a dashboard nobody wants?', w: 'soon', i: [88, 89, 78] },
  { s: 'Media, money and meta', id: 'F3', f: 'f3-privacy-and-keys.html', t: 'Provider transparency and BYO key',
    q: 'How is guardrail 5 said in plain words, and where does a key go?', w: 'soon', i: [90, 109] },
  { s: 'Media, money and meta', id: 'F4', f: 'f4-export-and-lock-in.html', t: 'Export and the lock-in answer',
    q: 'What does markdown export look like, and where is it advertised?', w: 'later', i: [21] },
  { s: 'Media, money and meta', id: 'F5', f: 'f5-metrics-dashboard.html', t: 'The metrics surface',
    q: 'Accept rate and time to first value: internal only, or shown to the GM?', w: 'later', i: [100, 101, 103] },
  { s: 'Media, money and meta', id: 'F6', f: 'f6-landing-and-demo.html', t: 'Landing page and the propagation demo',
    q: 'How is the loop shown on a page that must never overpromise?', w: 'now', i: [3, 4] },
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
    head.innerHTML = `
      <div class="eyebrow"><span>${d.id}</span><span>·</span><span>${d.s}</span>
        <span class="badge ${d.w}">decide ${d.w}</span></div>
      <h1>${d.t}</h1>
      <p class="q">${d.q}</p>
      <div class="facts"><span><b>Blocks</b> ${issues}</span>
        <span><b>Sample world</b> <a href="SAMPLE-WORLD.md">Valdoria Reach</a></span></div>`;
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

/* ---- the recorder ---- */
function injectRecorder() {
  const box = document.querySelector('[data-ux-record]');
  const id = document.body.dataset.decision;
  if (!box || !id) return;

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
  let html = `<table class="reg"><thead><tr><th>Id</th><th>Decision</th><th>The question</th><th>When</th><th>Blocks</th><th>Recorded</th></tr></thead><tbody>`;
  let section = null;
  for (const d of UX_REGISTER) {
    if (d.s !== section) {
      section = d.s;
      html += `<tr class="sect"><td colspan="6">${section}</td></tr>`;
    }
    const c = readChoice(d.id);
    html += `<tr>
      <td class="id"><a href="${d.f}">${d.id}</a></td>
      <td><a href="${d.f}">${d.t}</a></td>
      <td class="q">${d.q}</td>
      <td><span class="badge ${d.w}">${d.w}</span></td>
      <td class="small muted nowrap">${d.i.map((n) => `<a href="${REPO}${n}">#${n}</a>`).join(' ')}</td>
      <td class="small">${c ? `<span class="badge done">${c.pick}</span>` : '<span class="muted">—</span>'}</td>
    </tr>`;
  }
  host.innerHTML = html + '</tbody></table>';

  const counts = { now: 0, soon: 0, later: 0, done: 0 };
  UX_REGISTER.forEach((d) => { counts[d.w]++; if (readChoice(d.id)) counts.done++; });
  const tally = document.querySelector('[data-ux-tally]');
  if (tally) {
    tally.innerHTML = `<b>${UX_REGISTER.length}</b> decisions: ${counts.now} to take now,
      ${counts.soon} soon, ${counts.later} later. <b>${counts.done}</b> recorded.`;
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
      const c = readChoice(d.id);
      if (!c) continue;
      if (d.s !== section) { section = d.s; lines.push(`## ${section}`, ''); }
      lines.push(`- **${d.id} ${d.t}** — chose ${c.pick} (${c.name}).${c.note ? ` ${c.note}` : ''}`);
      lines.push(`  Blocks ${d.i.map((n) => `#${n}`).join(', ')}.`);
    }
    if (lines.length === 2) lines.push('_Nothing recorded yet._');
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
