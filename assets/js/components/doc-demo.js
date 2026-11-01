// Home hero demo: stateless vs stateful reading.
//
// Four fictional documents (_data/demo.yml) arrive in date order. The page on
// the left shows the current document with its layout regions; the memory
// panel on the right shows what a stateless reader extracts (and forgets)
// next to what a stateful one carries forward: claims with a validity
// interval, provenance and a reconciliation outcome. State is replayed from
// scratch up to the current document (doc-demo-state.js), so every control is
// a deterministic jump.

import { h, s, $, $$, uid } from '../lib/dom.js';
import { replay, shortRef, FLAG_OUTCOMES } from './doc-demo-state.js';

const STEP_MS = 3000;   // dwell per document while playing
const STAGGER_MS = 90;  // between two regions appearing
const ENTER_MS = 70;    // a claim enters this long after its region
const NOTED = new Set(['scope-coexist', 'support', 'retain-conflict', 'escalate']);
const ROLE_LABEL = { closed: 'closed', coexists: 'coexists', 'in-force': 'in force' };

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const humanDate = (iso) => dateFmt.format(new Date(`${iso}T00:00:00Z`));
const lc = (text) => text.charAt(0).toLowerCase() + text.slice(1);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const hidden = (text) => h('span', { class: 'visually-hidden', text });

/* ------------------------------------------------------------------ icons */

const ICONS = {
  play: [['path', { d: 'M8 5.5v13a.5.5 0 0 0 .77.42l10.2-6.5a.5.5 0 0 0 0-.84L8.77 5.08A.5.5 0 0 0 8 5.5Z', fill: 'currentColor', stroke: 'none' }]],
  pause: [['rect', { x: 6.5, y: 5, width: 3.6, height: 14, rx: 1, fill: 'currentColor', stroke: 'none' }], ['rect', { x: 13.9, y: 5, width: 3.6, height: 14, rx: 1, fill: 'currentColor', stroke: 'none' }]],
  prev: [['path', { d: 'm14.5 6-6 6 6 6' }]],
  next: [['path', { d: 'm9.5 6 6 6-6 6' }]],
  restart: [['path', { d: 'M3 12a9 9 0 1 0 3-6.7L3 8' }], ['path', { d: 'M3 3v5h5' }]],
  check: [['path', { d: 'm6 12.5 4 4 8-9' }]],
};

function icon(name) {
  return s('svg', {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
  }, ICONS[name].map(([tag, attrs]) => s(tag, attrs)));
}

/* --------------------------------------------------------------- wording */

/** "Amendment No. 1 to MSA-2026-014" → "Amendment No. 1"; "SOW … — Cold-chain" → "SOW …". */
function shortTitle(doc) {
  return doc.title.split(/ — | to (?=[A-Z]+-\d)/)[0];
}

/** "30 days", "45 days" → "30 → 45 days"; "€68.00", "€71.50" → "€68.00 → €71.50". */
function pair(a, b, sep) {
  const unit = (v) => (/\s[^\d\s]+$/.exec(v) || [''])[0];
  const u = unit(a);
  return u && u === unit(b) ? `${a.slice(0, -u.length)}${sep}${b}` : `${a}${sep}${b}`;
}

function regionOf(doc, id) {
  return (doc.regions || []).find((r) => r.id === id) || null;
}

/** Provenance chip text: "AMD-1 §1 · p.1", "INV Table · p.1". */
function provText(doc, regionId) {
  const r = regionOf(doc, regionId);
  const where = r ? (r.section || r.type) : '';
  return `${shortRef(doc.ref)}${where ? ` ${where}` : ''} · p.1`;
}

/** Validity interval, e.g. "2026-03-02 → 2026-10-31"; arrows are spoken as words. */
function when(claim, scope) {
  const arrow = (spoken) => [h('span', { 'aria-hidden': 'true', text: ' →' }), hidden(spoken)];
  let span;
  if (claim.status === 'closed') span = [hidden('valid '), claim.from, arrow(' to'), ' ', claim.to];
  else if (claim.status === 'conflict') span = [`observed ${claim.from}`];
  else if (claim.status === 'review') span = ['held for review'];
  else span = [hidden('valid from '), claim.from, arrow(' onward')];
  return h('span', { class: 'c-doc-demo__when' }, scope ? [scope, ' · '] : null, span);
}

function statefulSummary(st) {
  const name = shortTitle(st.doc);
  const of = (o) => st.events.filter((e) => e.outcome === o);
  const inForce = (e) => e.rows.find((r) => r.role === 'in-force')?.claim;
  const flags = st.events.filter((e) => FLAG_OUTCOMES.has(e.outcome));
  if (flags.length) {
    const parts = flags.map((e) => {
      const held = inForce(e);
      const vs = held ? pair(e.field.value, held.value, ' vs ') : e.field.value;
      return e.outcome === 'escalate'
        ? `${lc(e.field.label)} ${vs}, escalated for review`
        : `${lc(e.field.label)} ${vs} in force, both kept`;
    });
    return `${plural(flags.length, 'flag')} on ${name}: ${parts.join('; ')}.`;
  }
  const sup = of('supersede');
  if (sup.length) {
    const parts = sup.map((e) => {
      const old = e.rows.find((r) => r.role === 'closed')?.claim;
      return `the ${lc(e.field.label)} (${old ? pair(old.value, e.field.value, ' → ') : e.field.value})`;
    });
    const last = parts.pop();
    return `${name} supersedes ${parts.length ? `${parts.join(', ')} and ${last}` : last} from ${humanDate(sup[0].rows[0].claim.from)}.`;
  }
  const co = of('scope-coexist')[0];
  if (co) {
    const other = co.rows.find((r) => r.role === 'coexists')?.claim;
    const tail = other ? `, alongside ${other.value} for ${other.scope || 'the earlier scope'}` : '';
    return `${name}: ${lc(co.field.label)} ${co.field.value} for ${co.field.scope}${tail}.`;
  }
  return `${name}: ${plural(st.events.length, 'claim')} written to memory, each linked to its page region.`;
}

function statelessSummary(st) {
  const name = shortTitle(st.doc);
  const n = plural(st.events.length, 'field');
  if (st.events.some((e) => FLAG_OUTCOMES.has(e.outcome))) return `${name} read from scratch: ${n}, no issues found.`;
  const ref = st.events.find((e) => e.outcome === 'support');
  if (ref) return `${name} read from scratch: ${n}; “${ref.observed}” refers to nothing it remembers.`;
  return `${name} read from scratch: ${n} extracted, none kept for the next document.`;
}

/* ------------------------------------------------------------------ page */

function regionContent(region) {
  switch (region.type) {
    case 'Title': return h('div', { class: 'c-doc-demo__p-title', text: region.text });
    case 'Header': return h('div', { class: 'c-doc-demo__p-meta', text: region.text });
    case 'Footer': return h('div', { class: 'c-doc-demo__p-foot', text: region.text });
    case 'Table': return tableContent(region);
    case 'Signature':
      return h('div', { class: 'c-doc-demo__p-sign' },
        region.text.split(' · ').map((who) => h('span', { text: who })));
    default: {
      // Bold the leading clause number, as a printed contract would.
      const m = /^(\d+(?:\.\d+)?\.?)\s+([\s\S]*)$/.exec(region.text);
      return h('p', { class: 'c-doc-demo__p-text' }, m ? [h('b', { text: m[1] }), ' ', m[2]] : region.text);
    }
  }
}

function tableContent(region) {
  const rows = region.rows || [];
  const table = h('div', { class: 'c-doc-demo__p-table' },
    h('div', { class: 'c-doc-demo__p-caption', text: region.text }),
    rows.map((row, i) => {
      // A row whose middle cells are empty is a summary row (e.g. a total).
      const summary = i > 0 && row.length > 2 && row.slice(1, -1).every((c) => !c);
      return h('div', { class: ['c-doc-demo__p-row', i === 0 && 'is-head', summary && 'is-sum'], dataset: { row: i } },
        row.map((cell, j) => h('span', { class: 'c-doc-demo__p-cell', dataset: { col: j }, text: cell })));
    }));
  // First column (labels) wider than the numeric ones.
  const cols = Math.max(1, rows[0]?.length || 1);
  table.style.setProperty('--cols', cols > 1 ? `2.2fr repeat(${cols - 1}, 1fr)` : '1fr');
  return table;
}

/** The table cell that holds a field's value, if the region is a table. */
function cellFor(regionEl, region, value) {
  if (!region || !region.rows) return null;
  const token = String(value).split(' ')[0];
  const i = region.rows.findIndex((row, k) => k > 0 && row.includes(token));
  if (i < 0) return null;
  const j = region.rows[i].indexOf(token);
  return $(`[data-row="${i}"] [data-col="${j}"]`, regionEl);
}

function pageLabel(doc) {
  const counts = new Map();
  for (const r of doc.regions) counts.set(r.type, (counts.get(r.type) || 0) + 1);
  const parts = [...counts].map(([type, n]) => (n === 1 ? lc(type) : `${n} ${lc(type)}s`));
  const fields = new Set((doc.fields || []).map((f) => f.region)).size;
  return `${doc.title} (${doc.ref}), page 1, with ${plural(doc.regions.length, 'annotated region')}: ${parts.join(', ')}; ${plural(fields, 'region')} hold extracted fields.`;
}

/* ----------------------------------------------------------------- init */

export default function init(root, ctx) {
  const data = ctx.data(root, 'doc-demo');
  const docs = (data && Array.isArray(data.documents) ? data.documents : [])
    .filter((d) => d && Array.isArray(d.regions) && Array.isArray(d.fields));
  const app = $('[data-app]', root);
  if (!docs.length || !app) return;

  const size = { width: data.page?.width || 600, height: data.page?.height || 848 };
  const names = { new: 'New' };
  for (const o of data.outcomes || []) names[o.id] = o.name;
  const states = docs.map((_, k) => replay(docs, k));
  const last = docs.length - 1;

  let step = 0;
  let read = false;          // false until the first document has been read
  let mode = 'stateful';
  let playing = false;
  let touched = false;       // the visitor navigated: no autoplay any more
  let autoplayed = false;
  let timer = 0;
  let stepStarted = 0;
  let deadline = 0;
  let remaining = STEP_MS;
  let inView = false;
  let revealToken = 0;
  let pageDoc = null;
  let regionEls = new Map();
  let hoverEl = null;
  let focusEl = null;

  /* ---------------------------------------------------------- skeleton */

  const trackButtons = docs.map((doc, k) => {
    const btn = h('button', { type: 'button', class: 'c-doc-demo__step', onClick: () => jump(k) },
      h('span', { class: 'c-doc-demo__dot', 'aria-hidden': 'true' }, icon('check')),
      h('span', { class: 'c-doc-demo__step-text' },
        h('span', { class: 'c-doc-demo__step-ref', text: shortRef(doc.ref) }), ' ',
        h('span', { class: 'c-doc-demo__step-date', text: doc.date }),
        hidden(`, ${lc(doc.kind)}${doc.effective ? `, effective ${doc.effective}` : ''}`)),
      h('span', { class: 'visually-hidden', dataset: { status: '' } }));
    return btn;
  });
  const track = h('ol', { class: 'c-doc-demo__track', 'aria-label': 'Documents, in date order' },
    trackButtons.map((b) => h('li', { class: 'c-doc-demo__track-item' }, b)));

  const sheetInner = h('div', { class: 'c-doc-demo__page' });
  const sheet = h('div', { class: 'c-doc-demo__sheet', role: 'img' }, sheetInner);
  const callout = h('div', { class: 'c-doc-demo__callout', 'aria-hidden': 'true', hidden: true });
  const desk = h('div', { class: 'c-doc-demo__desk' }, sheet, callout);

  const modeButtons = ['stateless', 'stateful'].map((m) => h('button', {
    type: 'button', 'aria-pressed': String(m === mode), onClick: () => setMode(m),
  }, m === 'stateless' ? 'Stateless' : 'Stateful'));
  const panelTitleId = `${root.id || 'doc-demo'}-memory`;
  const scroller = h('div', { class: 'c-doc-demo__scroll' });
  const fade = h('div', { class: 'c-doc-demo__fade', 'aria-hidden': 'true' });
  const panel = h('section', { class: 'c-doc-demo__panel', 'aria-labelledby': panelTitleId },
    h('div', { class: 'c-doc-demo__panel-head' },
      h('span', { class: 'c-doc-demo__panel-title', id: panelTitleId, text: 'Memory' }),
      h('div', { class: 'segmented c-doc-demo__mode', role: 'group', 'aria-label': 'Reading mode' }, modeButtons)),
    scroller, fade);

  // The ring around Play fills up until the next document arrives.
  const ringPath = s('circle', { cx: 20, cy: 20, r: 18.75, pathLength: 100 });
  const playIcon = h('span', { class: 'c-doc-demo__play-icon' }, icon('play'));
  const playBtn = h('button', { type: 'button', class: 'c-doc-demo__play', onClick: togglePlay },
    s('svg', { class: 'c-doc-demo__ring', viewBox: '0 0 40 40', 'aria-hidden': 'true', focusable: 'false' }, ringPath),
    playIcon);
  let ringAnim = null;
  const iconBtn = (name, label, onClick) => h('button', {
    type: 'button', class: 'btn btn--ghost c-doc-demo__icon', 'aria-label': label, title: label, onClick,
  }, icon(name));
  const prevBtn = iconBtn('prev', 'Previous document', () => go(step - 1));
  const nextBtn = iconBtn('next', 'Next document', () => go(read ? step + 1 : 0));
  const restartBtn = iconBtn('restart', 'Restart from the first document', restart);
  const summary = h('p', { class: 'c-doc-demo__summary' });
  const controls = h('div', { class: 'c-doc-demo__controls', role: 'group', 'aria-label': 'Playback' },
    playBtn, prevBtn, nextBtn, restartBtn);

  app.replaceChildren(controls, track, h('div', { class: 'c-doc-demo__stage' }, desk, panel), summary);

  /* ------------------------------------------------------------ render */

  // Read document k: the page, then the memory, then the summary. Boxes and
  // claims appear one after the other unless motion is reduced.
  function show(k, { animate = true, announce = true } = {}) {
    step = Math.max(0, Math.min(last, k));
    read = true;
    stepStarted = performance.now();
    const how = !animate || ctx.reducedMotion ? 'instant' : 'stagger';
    const items = [...renderPage(states[step], how), ...renderPanel(states[step], how)];
    if (how === 'stagger') reveal(items);
    renderTrack();
    renderSummary(announce);
    renderControls();
  }

  /** Before insertion: final state now ('instant'), a delay ('stagger'), or hidden ('none'). */
  function prime(items, how) {
    for (const [el, delay] of items) {
      if (how === 'instant') el.classList.add('is-in');
      else if (how === 'stagger') el.style.setProperty('--d', `${delay}ms`);
    }
  }

  function reveal(items) {
    const token = ++revealToken;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (token === revealToken) items.forEach(([el]) => el.classList.add('is-in'));
    }));
  }

  function renderTrack() {
    trackButtons.forEach((btn, k) => {
      const state = !read ? 'next' : k < step ? 'read' : k === step ? 'current' : 'next';
      btn.dataset.state = state;
      if (state === 'current') btn.setAttribute('aria-current', 'step');
      else btn.removeAttribute('aria-current');
      $('[data-status]', btn).textContent = state === 'read' ? ', read' : state === 'current' ? ', reading now' : ', not read yet';
    });
  }

  // The document as a page; returns its region boxes for the entrance.
  function renderPage(st, how) {
    clearHighlight();
    pageDoc = st.doc;
    regionEls = new Map();
    const items = [];
    const fieldRegions = new Set(st.doc.fields.map((f) => f.region));
    const nodes = st.doc.regions.map((region, i) => {
      const [x, y, w, hgt] = region.box;
      const el = h('div', {
        class: ['c-doc-demo__region', fieldRegions.has(region.id) && 'is-field'],
        dataset: { type: region.type.toLowerCase() },
        style: {
          left: `${(x / size.width) * 100}%`, top: `${(y / size.height) * 100}%`,
          width: `${(w / size.width) * 100}%`, height: `${(hgt / size.height) * 100}%`,
        },
      },
      h('div', { class: 'c-doc-demo__box' }, h('span', { class: 'c-doc-demo__tab', text: region.type })),
      regionContent(region));
      regionEls.set(region.id, el);
      items.push([el, i * STAGGER_MS]);
      return el;
    });
    prime(items, how);
    sheetInner.replaceChildren(...nodes);
    sheet.setAttribute('aria-label', pageLabel(st.doc));
    renderFlags(st);
    return items;
  }

  // In stateful mode the regions behind a flag carry the outcome colour.
  function renderFlags(st) {
    for (const el of regionEls.values()) {
      el.classList.remove('is-flag');
      delete el.dataset.outcome;
    }
    if (mode !== 'stateful' || !read) return;
    for (const e of st.events) {
      const el = FLAG_OUTCOMES.has(e.outcome) && regionEls.get(e.field.region);
      if (el) {
        el.classList.add('is-flag');
        el.dataset.outcome = e.outcome;
      }
    }
  }

  function regionDelay(regionId) {
    const i = pageDoc ? pageDoc.regions.findIndex((r) => r.id === regionId) : -1;
    return Math.max(0, i) * STAGGER_MS + ENTER_MS;
  }

  // The memory panel for the current mode; returns the entries that enter.
  function renderPanel(st, how) {
    hoverEl = null;
    focusEl = null;
    const items = [];
    const blocks = !read ? emptyView() : mode === 'stateful' ? statefulView(st, items) : statelessView(st, items);
    prime(items, how);
    scroller.replaceChildren(...blocks);
    scroller.scrollTop = 0;
    $$('.c-doc-demo__claim', scroller).forEach((el, i) => { el.tabIndex = i === 0 ? 0 : -1; });
    syncFade();
    return items;
  }

  function section(label, list, extra) {
    const id = uid('doc-demo-section');
    return [
      h('p', { class: 'c-doc-demo__section', id }, label, extra || null),
      h('ul', { class: 'c-doc-demo__claims', 'aria-labelledby': id }, list),
    ];
  }

  function statefulView(st, items) {
    const ref = shortRef(st.doc.ref);
    const flags = st.events.filter((e) => FLAG_OUTCOMES.has(e.outcome)).length;
    const current = st.events.map((e) => {
      const li = eventEntry(e, st);
      items.push([li, regionDelay(e.field.region)]);
      return li;
    });
    const verb = st.carried.length ? 'reconciled' : 'written to memory';
    const blocks = section(`${ref} · ${plural(st.events.length, 'field')} ${verb}`, current,
      flags ? h('span', { class: 'c-doc-demo__flagcount', text: ` · ${plural(flags, 'flag')}` }) : null);
    if (st.carried.length) {
      blocks.push(...section(`Carried forward · ${plural(st.carried.length, 'claim')}`,
        st.carried.map((c) => claimEntry(c, { carried: true }))));
    } else {
      blocks.push(h('p', { class: 'c-doc-demo__empty' }, 'Memory was empty: nothing to reconcile against yet.'));
    }
    return blocks;
  }

  // Stateless: an empty memory, the fields of this document alone, and no
  // way to notice what contradicts earlier documents.
  function statelessView(st, items) {
    const ref = shortRef(st.doc.ref);
    const list = st.doc.fields.map((f) => {
      const li = h('li', { class: 'c-doc-demo__claim is-plain', dataset: { region: f.region, doc: st.doc.id } },
        h('span', { class: 'c-doc-demo__label', text: f.label }), ' ',
        h('span', { class: 'c-doc-demo__value', text: f.value }),
        f.scope ? [' ', h('span', { class: 'c-doc-demo__when', text: f.scope })] : null,
        prov(st.doc, f.region));
      items.push([li, regionDelay(f.region)]);
      return li;
    });
    const blocks = [
      h('p', { class: 'c-doc-demo__empty' }, h('b', { text: 'Memory: empty' }), ' — each document is read from scratch'),
      ...section(`${ref} · ${plural(list.length, 'field')} extracted`, list),
    ];
    if (st.events.some((e) => FLAG_OUTCOMES.has(e.outcome))) {
      blocks.push(h('p', { class: 'c-doc-demo__verdict' }, icon('check'), 'No issues found'));
    }
    return blocks;
  }

  function emptyView() {
    return [
      h('p', { class: 'c-doc-demo__section', text: 'Waiting for the first document' }),
      h('p', { class: 'c-doc-demo__empty' }, h('b', { text: 'Memory: empty' }), ' — nothing has been read yet'),
    ];
  }

  function prov(doc, regionId, corroborates = false) {
    return h('span', { class: ['c-doc-demo__prov', corroborates && 'is-plus'] },
      hidden(corroborates ? 'corroborated by ' : 'source '), provText(doc, regionId));
  }

  /** A claim's provenance: where it was read, then any corroborating regions. */
  function provs(claim) {
    return h('span', { class: 'c-doc-demo__provs' },
      prov(claim.doc, claim.region), claim.corroborations.map((c) => prov(c.doc, c.region, true)));
  }

  function badge(outcome) {
    return h('span', { class: 'badge c-doc-demo__outcome', dataset: { outcome } }, names[outcome] || outcome);
  }

  /** One claim: label, value, interval and provenance. */
  function claimEntry(claim, { carried = false } = {}) {
    const struck = claim.status === 'closed';
    const li = h('li', {
      // Claims from earlier documents are already in memory: no entrance.
      class: ['c-doc-demo__claim', carried && 'is-carried is-in', struck && 'is-closed'],
      dataset: { region: claim.region, doc: claim.doc.id },
    },
    h('div', { class: 'c-doc-demo__claim-head' },
      h('span', { class: 'c-doc-demo__label', text: claim.label }), ' ',
      struck
        ? h('s', { class: 'c-doc-demo__value c-doc-demo__struck' }, hidden('superseded: '), claim.value)
        : h('span', { class: 'c-doc-demo__value', text: claim.value })),
    h('div', { class: 'c-doc-demo__claim-meta' },
      when(claim, claim.scope),
      provs(claim)));
    return li;
  }

  /** A field of the current document, with its outcome and the claims it touches. */
  function eventEntry(e, st) {
    const main = e.rows[0].claim;
    const value = e.outcome === 'support' ? main.value : e.field.value;
    const related = e.rows.slice(1).map(({ claim, role }) => h('li', {
      class: ['c-doc-demo__rel', `is-${role}`], dataset: { region: claim.region, doc: claim.doc.id },
    },
    h('span', { class: 'c-doc-demo__rel-role', text: ROLE_LABEL[role] || role }), ' ',
    role === 'closed'
      ? h('s', { class: 'c-doc-demo__rel-value c-doc-demo__struck' }, hidden('superseded: '), claim.value)
      : h('span', { class: 'c-doc-demo__rel-value', text: claim.value }), ' ',
    when(claim, role === 'coexists' && claim.scope),
    prov(claim.doc, claim.region)));

    const note = NOTED.has(e.outcome) && e.note
      ? h('p', { class: 'c-doc-demo__note' },
        e.outcome === 'support' ? [h('q', { text: e.observed }), ' · '] : null, e.note)
      : null;

    return h('li', {
      class: ['c-doc-demo__claim', 'is-event', FLAG_OUTCOMES.has(e.outcome) && 'is-flag'],
      dataset: { outcome: e.outcome, region: e.field.region, doc: st.doc.id, value: e.field.value },
    },
    h('div', { class: 'c-doc-demo__claim-head' },
      h('span', { class: 'c-doc-demo__label', text: main.label }), ' ',
      h('span', { class: 'c-doc-demo__value', text: value }), ' ',
      badge(e.outcome)),
    h('div', { class: 'c-doc-demo__claim-meta' },
      when(main, main.scope),
      provs(main)),
    related.length ? h('ul', { class: 'c-doc-demo__rels' }, related) : null,
    note);
  }

  function renderSummary(announce) {
    const st = states[step];
    const text = !read
      ? `${docs.length} documents arrive in date order. Press Play, or pick one.`
      : mode === 'stateful' ? statefulSummary(st) : statelessSummary(st);
    summary.textContent = text;
    if (announce) ctx.announce(text);
  }

  function renderControls() {
    const ended = read && step === last && !playing;
    const label = playing ? 'Pause' : ended ? 'Replay from the first document' : 'Play';
    playBtn.setAttribute('aria-label', label);
    playBtn.title = label;
    playIcon.replaceChildren(icon(playing ? 'pause' : 'play'));
    root.classList.toggle('is-playing', playing);
    prevBtn.setAttribute('aria-disabled', String(!read || step === 0));
    nextBtn.setAttribute('aria-disabled', String(read && step === last));
  }

  /* ---------------------------------------------------- highlight link */

  function clearHighlight() {
    sheet.classList.remove('has-active');
    $$('.is-active', sheetInner).forEach((el) => el.classList.remove('is-active'));
    $$('.is-hit', sheetInner).forEach((el) => el.classList.remove('is-hit'));
    trackButtons.forEach((b) => b.classList.remove('is-source'));
    callout.hidden = true;
  }

  function highlight(el) {
    clearHighlight();
    if (!el || !pageDoc) return;
    const { region: regionId, doc: docId } = el.dataset;
    if (docId !== pageDoc.id) {
      const k = docs.findIndex((d) => d.id === docId);
      if (k >= 0) trackButtons[k].classList.add('is-source');
      return;
    }
    const regionEl = regionEls.get(regionId);
    const region = regionOf(pageDoc, regionId);
    if (!regionEl || !region) return;
    sheet.classList.add('has-active');
    regionEl.classList.add('is-active');
    const value = el.closest('.c-doc-demo__claim')?.dataset.value
      || $('.c-doc-demo__value', el)?.textContent || '';
    const cell = cellFor(regionEl, region, value);
    if (cell) cell.classList.add('is-hit');
    showCallout(regionEl, region, cell);
  }

  // The source text of the highlighted region, legible next to the page.
  function showCallout(regionEl, region, cell) {
    callout.replaceChildren(
      h('div', { class: 'c-doc-demo__callout-head', text: `${provText(pageDoc, region.id)}${region.section ? ` · ${region.type}` : ''}` }),
      region.rows && cell ? calloutRow(region, cell) : h('p', { class: 'c-doc-demo__callout-text', text: region.text }));
    callout.hidden = false;
    const d = desk.getBoundingClientRect();
    const r = regionEl.getBoundingClientRect();
    const p = sheet.getBoundingClientRect();
    const width = Math.min(d.width - 16, Math.max(p.width - 12, 200));
    const left = Math.max(8, Math.min(p.left - d.left + (p.width - width) / 2, d.width - width - 8));
    callout.style.width = `${width}px`;
    callout.style.left = `${left}px`;
    const below = r.bottom - d.top + 6;
    const hgt = callout.offsetHeight;
    callout.style.top = `${below + hgt <= d.height - 6 ? below : Math.max(6, r.top - d.top - hgt - 6)}px`;
  }

  // A table row with its column names: "Express pallet — Unit pallet · Rate €68.00".
  function calloutRow(region, cell) {
    const head = region.rows[0];
    const row = region.rows[Number(cell.parentElement.dataset.row)];
    const hit = Number(cell.dataset.col);
    return h('p', { class: 'c-doc-demo__callout-row' },
      h('b', { text: row[0] }),
      row.slice(1).map((value, i) => (value ? h('span', {},
        h('span', { class: 'c-doc-demo__callout-k', text: head[i + 1] }), ' ',
        h('span', { class: i + 1 === hit ? 'is-hit' : '', text: value })) : null)));
  }

  function syncHighlight() {
    highlight(hoverEl || focusEl);
  }

  scroller.addEventListener('pointerover', (e) => {
    const el = e.target.closest('[data-region]');
    if (el === hoverEl) return;
    hoverEl = el;
    syncHighlight();
  });
  scroller.addEventListener('pointerleave', () => {
    hoverEl = null;
    syncHighlight();
  });
  scroller.addEventListener('focusin', (e) => {
    const el = e.target.closest('.c-doc-demo__claim');
    if (!el) return;
    $$('.c-doc-demo__claim', scroller).forEach((c) => { c.tabIndex = c === el ? 0 : -1; });
    focusEl = el;
    syncHighlight();
  });
  scroller.addEventListener('focusout', (e) => {
    if (!scroller.contains(e.relatedTarget)) {
      focusEl = null;
      syncHighlight();
    }
  });
  // Arrow keys move between claims (one tab stop for the whole list).
  scroller.addEventListener('keydown', (e) => {
    const claims = $$('.c-doc-demo__claim', scroller);
    const i = claims.indexOf(document.activeElement);
    if (i < 0) return;
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: claims.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    claims[Math.max(0, Math.min(claims.length - 1, to))].focus();
  });
  scroller.addEventListener('scroll', syncFade, { passive: true });

  function syncFade() {
    const more = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 4;
    fade.classList.toggle('is-on', more);
  }

  /* ------------------------------------------------------------- modes */

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    modeButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(['stateless', 'stateful'][i] === mode)));
    root.dataset.mode = mode;
    renderFlags(states[step]);
    renderPanel(states[step], 'instant');
    // A brief fade marks the swap.
    if (!ctx.reducedMotion) scroller.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    renderSummary(true);
  }

  /* ---------------------------------------------------------- playback */

  function schedule(delay = STEP_MS) {
    clearTimeout(timer);
    timer = 0;
    remaining = delay;
    ringAnim?.cancel();
    if (!playing || !inView || document.hidden) return;
    deadline = performance.now() + delay;
    if (!ctx.reducedMotion) {
      ringAnim = ringPath.animate([{ strokeDashoffset: 100 * (delay / STEP_MS) }, { strokeDashoffset: 0 }],
        { duration: delay, easing: 'linear', fill: 'forwards' });
    }
    timer = setTimeout(() => {
      timer = 0;
      show(step + 1);
      if (step >= last) stop();
      else schedule();
    }, delay);
  }

  function stop() {
    playing = false;
    clearTimeout(timer);
    timer = 0;
    ringAnim?.cancel();
    renderControls();
  }

  function play() {
    playing = true;
    if (!read || step === last) {
      show(0);
      schedule();
    } else {
      renderControls();
      schedule(Math.max(900, STEP_MS - (performance.now() - stepStarted)));
    }
  }

  function togglePlay() {
    touched = true;
    if (playing) stop();
    else play();
  }

  function go(k) {
    touched = true;
    if (k < 0 || k > last || (read && k === step)) return;
    stop();
    show(k);
  }

  function jump(k) {
    touched = true;
    stop();
    show(k);
  }

  function restart() {
    touched = true;
    const wasPlaying = playing;
    stop();
    show(0);
    if (wasPlaying) {
      playing = true;
      renderControls();
      schedule();
    }
  }

  // Pause the clock while the demo is off screen or the tab is hidden, and
  // resume with the time that was left for the current document.
  function suspendOrResume() {
    if (!playing) return;
    if (!inView || document.hidden) {
      if (timer) remaining = Math.max(600, deadline - performance.now());
      clearTimeout(timer);
      timer = 0;
      ringAnim?.pause();
    } else if (!timer) {
      schedule(remaining);
    }
  }

  // Autoplay once, when most of the demo (or half the viewport) shows it.
  const io = new IntersectionObserver(([entry]) => {
    const seen = entry.intersectionRect.height;
    inView = entry.isIntersecting && entry.intersectionRatio > 0.1;
    if (!autoplayed && seen >= Math.min(entry.boundingClientRect.height * 0.45, window.innerHeight * 0.5)) {
      autoplayed = true;
      if (!ctx.reducedMotion && !touched && !read) play();
    }
    suspendOrResume();
  }, { threshold: [0, 0.1, 0.2, 0.3, 0.45, 0.6] });
  io.observe(root);
  document.addEventListener('visibilitychange', suspendOrResume);

  /* ------------------------------------------------------------ start */

  root.dataset.mode = mode;
  if (ctx.reducedMotion) show(0, { animate: false, announce: false });
  else {
    renderPage(states[0], 'none'); // the first page, not yet read: no boxes
    renderPanel(states[0], 'instant');
    renderTrack();
    renderSummary(false);
    renderControls();
  }
  $('[data-static]', root)?.setAttribute('hidden', '');
}
