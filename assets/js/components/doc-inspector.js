// Ariadne document inspector (products page, #ariadne).
//
// The four fictional documents of _data/demo.yml are tabs. Each page is drawn
// from its layout regions in the demo's page coordinate box; selecting a
// region shows its text, the fields read from it with their provenance, and
// what each field did to memory (the stream is replayed by
// reconcile-model.js). Alongside: the validity history of one field, the
// pre-write gate rejecting a misread cell, and an erasure request applied one
// level at a time. Every source reference is a button back to its region.

import { h, mount, roving, uid } from '../lib/dom.js';
import {
  replay, erase, icon, outcomeName, shortRef, matchCell, withSymbols,
  parseDay, isoDay, fmtDate, fmtDay, monthShort, NEW, REJECTED,
} from './reconcile-model.js';

// Fields the history can trace, in this order (each changes over the stream).
const HISTORY_KEYS = ['payment_terms', 'rate_express', 'liability_cap', 'data_residency'];
// Every demo document is a single page (see their "page 1" footers).
const PAGE = 1;
const DAY = 86400000;

const pct = (v) => `${(v * 100).toFixed(3)}%`;
const MONTH_LONG = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' });
const MONTH_YEAR = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// Clause headings ("4.2 Payment terms.") are set in bold, as on paper;
// otherwise only the clause number is.
const HEADING = /^(\d+(?:\.\d+)?\.?\s+[A-Z][a-z]+(?: [a-z]+)?\.)(?=\s|$)/;
const NUMBER = /^(\d+(?:\.\d+)?\.)(?=\s)/;

function clauseText(text) {
  const m = HEADING.exec(text) || NUMBER.exec(text);
  return m ? [h('b', null, m[1]), text.slice(m[1].length)] : text;
}

/** Month axis from the first document's month to a month past the last one. */
function buildAxis(docs) {
  const days = docs.flatMap((d) => [d.date, d.effective]).filter(Boolean).map(parseDay);
  const first = new Date(Math.min(...days));
  const last = new Date(Math.max(...days));
  const start = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1);
  const end = Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 2, 1);
  const months = [];
  for (let m = start; m < end;) {
    months.push({ left: ((m - start) / (end - start)) * 100, label: monthShort(m) });
    const d = new Date(m);
    m = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  const y0 = new Date(start).getUTCFullYear();
  const y1 = new Date(end - DAY).getUTCFullYear();
  return {
    start,
    end,
    months,
    year: y0 === y1 ? String(y0) : `${y0}–${y1}`,
    label: `${MONTH_LONG.format(start)} to ${MONTH_YEAR.format(end - DAY)}`,
  };
}

export default function init(root, ctx) {
  const data = ctx.data(root, 'doc-inspector');
  const app = root.querySelector('[data-app]');
  const alt = root.querySelector('[data-alt]');
  const docs = (data && Array.isArray(data.documents) ? data.documents : [])
    .filter((d) => Array.isArray(d.regions) && d.regions.length);
  if (!app || !docs.length || !data.page) return;

  const box = data.page;
  const outcomes = data.outcomes || [];
  const noisy = data.noisy && docs.some((d) => d.id === data.noisy.document) ? data.noisy : null;
  const deletion = data.deletion && docs.some((d) => d.id === data.deletion.target) ? data.deletion : null;
  const target = deletion ? deletion.target : '';
  const targetDoc = docs.find((d) => d.id === target);
  const steps = deletion ? [...(deletion.effects || [])].sort((a, b) => a.level - b.level) : [];
  const stage = (id) => (data.lifecycle || []).find((x) => x.id === id);
  const levelName = (n) => ((data.levels || []).find((x) => x.level === n) || {}).name || '';

  const keys = HISTORY_KEYS.filter((k) => docs.some((d) => (d.fields || []).some((f) => f.key === k)));
  const keyLabel = (k) => {
    for (const d of docs) {
      const f = (d.fields || []).find((x) => x.key === k);
      if (f) return f.label;
    }
    return k;
  };

  const state = { doc: 0, region: '', key: keys[0] || '', noisy: false, level: 0 };
  let run = replay(docs);
  const axis = buildAxis(docs);
  const pos = (iso) => ((parseDay(iso) - axis.start) / (axis.end - axis.start)) * 100;
  const base = uid('di');

  /* ------------------------------------------------------------ lookups */

  const regionOf = (doc, id) => doc.regions.find((r) => r.id === id) || null;
  const fieldsIn = (doc, region) => (doc.fields || []).filter((f) => f.region === region.id);
  const eventOf = (doc, field) => run.events.find((e) => e.doc === doc && e.field === field);
  const keep = (list) => erase(list, target, state.level);
  const fileDeleted = (doc) => state.level >= 1 && doc.id === target;
  const interval = (c) => `${c.from} → ${c.to || 'open'}`;
  const place = (region) => (region ? region.section || region.type.toLowerCase() : '');
  const money = (text) => parseFloat(String(text).replace(/[^\d.]/g, ''));
  const typeset = (text) => withSymbols(text, { sym: 'c-doc-inspector__sym', keep: 'c-doc-inspector__keep' });
  const titleOf = (doc) => (String(doc.title).includes(doc.ref) ? doc.title : `${doc.ref} · ${doc.title}`);

  /** Run a re-render without moving `anchor` (the control just used) on screen. */
  function steady(anchor, render) {
    const before = anchor.getBoundingClientRect().top;
    render();
    const shift = anchor.getBoundingClientRect().top - before;
    // 'instant' overrides the page's smooth scroll-behavior.
    if (Math.abs(shift) > 1) window.scrollBy({ top: shift, behavior: 'instant' });
  }

  /** A source reference that selects its region on the page. */
  function refButton(doc, region) {
    const label = `${shortRef(doc.ref)} ${place(region)}`.trim();
    const here = doc === docs[state.doc] && region && region.id === state.region;
    if (!region || here || fileDeleted(doc)) {
      return h('span', { class: ['c-doc-inspector__ref', 'is-static', fileDeleted(doc) && 'is-gone'] }, label);
    }
    return h('button', {
      type: 'button',
      class: 'c-doc-inspector__ref',
      'aria-label': `Show ${doc.ref} ${place(region)} on the page`,
      onClick: () => jumpTo(doc.id, region.id),
    }, label);
  }

  function badge(outcome) {
    return h('span', { class: ['c-doc-inspector__oc', outcome === REJECTED && 'c-doc-inspector__oc--rejected'], dataset: { outcome } },
      icon(outcome, 'c-doc-inspector__oc-icon'), outcomeName(outcome, outcomes));
  }

  /* --------------------------------------------------------------- tabs */

  const panelId = `${base}-panel`;
  const tabs = docs.map((doc, i) => h('button', {
    type: 'button',
    role: 'tab',
    id: `${base}-tab-${i}`,
    class: 'c-doc-inspector__tab',
    'aria-selected': 'false',
    'aria-controls': panelId,
    tabindex: '-1',
    onClick: () => selectDoc(i),
  },
    h('span', { class: 'c-doc-inspector__tab-ref' }, shortRef(doc.ref)),
    h('span', { class: 'c-doc-inspector__tab-kind' }, doc.kind),
    h('span', { class: 'c-doc-inspector__tab-date' }, fmtDate(doc.date))));
  roving(tabs, { onSelect: (i) => selectDoc(i) });
  const tablist = h('div', { class: 'c-doc-inspector__tabs', role: 'tablist', 'aria-label': 'Documents, in the order they were read' }, tabs);

  function renderTabs() {
    tabs.forEach((t, i) => {
      const gone = fileDeleted(docs[i]);
      t.classList.toggle('is-erased', gone);
      t.querySelector('.c-doc-inspector__tab-kind').textContent = gone ? 'File deleted' : docs[i].kind;
    });
  }

  /* -------------------------------------------------------------- page */

  const canvas = h('div', { class: 'c-doc-inspector__canvas' });
  const hint = h('p', { class: 'c-doc-inspector__hint' });
  const stagePanel = h('div', { class: 'c-doc-inspector__stage', role: 'tabpanel', id: panelId },
    h('div', { class: 'c-doc-inspector__sticky' }, canvas, hint));
  const ratio = `${box.width} / ${box.height}`;
  let regionButtons = [];

  function renderStage() {
    const doc = docs[state.doc];
    stagePanel.setAttribute('aria-labelledby', tabs[state.doc].id);
    if (fileDeleted(doc)) {
      regionButtons = [];
      mount(canvas, tombstone(doc));
      mount(hint, 'The file is gone; see the erasure request for what else remains.');
      return;
    }
    regionButtons = doc.regions.map((r) => regionButton(doc, r));
    roving(regionButtons, { onSelect: (i, btn) => selectRegion(btn.dataset.region) });
    mount(canvas, h('div', {
      class: 'c-doc-inspector__page',
      role: 'radiogroup',
      'aria-label': `Layout regions of ${doc.ref}, page ${PAGE}`,
      style: { aspectRatio: ratio },
    }, regionButtons));
    const withFields = doc.regions.filter((r) => fieldsIn(doc, r).length).length;
    mount(hint,
      h('span', null, `${doc.regions.length} regions, ${withFields} with extracted fields`),
      h('span', { class: 'c-doc-inspector__keyhint', 'aria-hidden': 'true' }, h('kbd', null, '←'), h('kbd', null, '→'), ' move'));
    markRegion();
  }

  function markRegion() {
    for (const btn of regionButtons) {
      const on = btn.dataset.region === state.region;
      btn.setAttribute('aria-checked', String(on));
      btn.tabIndex = on ? 0 : -1;
    }
  }

  function regionButton(doc, region) {
    const fields = fieldsIn(doc, region);
    const [x, y, w, hh] = region.box;
    return h('button', {
      type: 'button',
      role: 'radio',
      'aria-checked': 'false',
      tabindex: '-1',
      class: 'c-doc-inspector__region',
      dataset: { region: region.id, type: region.type.toLowerCase(), fields: fields.length ? 'yes' : 'no' },
      style: { left: pct(x / box.width), top: pct(y / box.height), width: pct(w / box.width), height: pct(hh / box.height) },
      'aria-label': regionName(doc, region, fields),
      onClick: () => selectRegion(region.id),
    },
      h('span', { class: ['c-doc-inspector__rtab', region.section && 'has-section'], 'aria-hidden': 'true' },
        h('span', { class: 'c-doc-inspector__rtab-type' }, region.type),
        region.section && h('span', { class: 'c-doc-inspector__rtab-sec' }, ` ${region.section}`)),
      h('span', { class: 'c-doc-inspector__rbody', 'aria-hidden': 'true' }, regionBody(doc, region, fields)));
  }

  function regionName(doc, region, fields) {
    const head = `${region.type}${region.section ? ` ${region.section}` : ''}`;
    if (!fields.length) return `${head}, layout only`;
    return `${head}: ${fields.map((f) => {
      const ev = eventOf(doc, f);
      const outcome = ev ? ev.outcome : NEW;
      return `${f.label} ${outcome === REJECTED ? ev.read : f.value}, ${outcomeName(outcome, outcomes)}`;
    }).join('; ')}`;
  }

  function regionBody(doc, region, fields) {
    if (Array.isArray(region.rows)) return tableBody(doc, region, fields);
    if (region.type === 'Signature') {
      return h('span', { class: 'c-doc-inspector__sign' },
        String(region.text || '').split(' · ').map((part) => h('span', { class: 'c-doc-inspector__sign-col' }, part)));
    }
    return h('span', { class: 'c-doc-inspector__text' }, clauseText(region.text || ''));
  }

  function tableBody(doc, region, fields) {
    const rows = region.rows;
    // Column widths follow the longest entry; money and counts align right.
    const widths = rows[0].map((_, c) => Math.max(3, ...rows.map((row) => String(row[c] || '').length)));
    const numeric = rows[0].map((_, c) => rows.slice(1).every((row) => !row[c] || /^[€\d]/.test(row[c])));
    const read = new Set(fields.map((f) => matchCell(region, f.value)).filter(Boolean).map((at) => at.join('-')));
    const misread = misreadCell(doc, region);
    const grid = h('span', {
      class: 'c-doc-inspector__grid',
      style: { gridTemplateColumns: widths.map((wd) => `minmax(0, ${wd}fr)`).join(' ') },
    }, rows.map((row, r) => row.map((cell, c) => {
      const at = `${r}-${c}`;
      return h('span', {
        class: ['c-doc-inspector__cell', r === 0 && 'is-head', numeric[c] && 'is-num',
          r > 0 && /^total$/i.test(row[0]) && 'is-total', read.has(at) && 'is-field', misread && misread.at === at && 'is-misread'],
      }, cell, misread && misread.at === at && h('span', { class: 'c-doc-inspector__misread' }, `read ${misread.read}`));
    })));
    return [region.text && h('span', { class: 'c-doc-inspector__caption' }, clauseText(region.text)), grid];
  }

  function misreadCell(doc, region) {
    if (!state.noisy || !noisy || noisy.document !== doc.id || (noisy.region && noisy.region !== region.id)) return null;
    const f = fieldsIn(doc, region).find((x) => x.key === noisy.key);
    const at = f && matchCell(region, f.value);
    return at ? { at: at.join('-'), read: noisy.read } : null;
  }

  function tombstone(doc) {
    return h('div', { class: 'c-doc-inspector__page c-doc-inspector__page--erased', style: { aspectRatio: ratio } },
      h('div', { class: 'c-doc-inspector__tomb' },
        icon(REJECTED, 'c-doc-inspector__tomb-icon'),
        h('p', { class: 'c-doc-inspector__tomb-title' }, 'File deleted'),
        h('p', { class: 'c-doc-inspector__tomb-ref' }, `${doc.ref} · page ${PAGE}`),
        h('p', { class: 'c-doc-inspector__tomb-why' }, deletion.reason)));
  }

  /* --------------------------------------------------------- inspector */

  const inspector = h('section', { class: 'c-doc-inspector__panel c-doc-inspector__inspector', 'aria-labelledby': `${base}-insp` });

  function renderInspector() {
    const doc = docs[state.doc];
    if (fileDeleted(doc)) {
      mount(inspector,
        h('header', { class: 'c-doc-inspector__ihead' },
          h('p', { class: 'c-doc-inspector__kicker' }, `${shortRef(doc.ref)} · erased`),
          h('h3', { class: 'c-doc-inspector__ititle', id: `${base}-insp` }, 'Document erased')),
        h('p', { class: 'c-doc-inspector__empty' }, deletion.reason),
        h('h4', { class: 'divider-label c-doc-inspector__sub' }, 'Still in memory'),
        residualList());
      return;
    }
    const region = regionOf(doc, state.region) || doc.regions[0];
    const fields = fieldsIn(doc, region);
    mount(inspector,
      h('header', { class: 'c-doc-inspector__ihead' },
        h('p', { class: 'c-doc-inspector__kicker' }, `${shortRef(doc.ref)} · selected region`),
        h('h3', { class: 'c-doc-inspector__ititle', id: `${base}-insp` },
          region.type, region.section && h('span', { class: 'c-doc-inspector__isec' }, region.section))),
      regionQuote(region),
      h('h4', { class: 'divider-label c-doc-inspector__sub' }, fields.length > 1 ? `${fields.length} extracted fields` : 'Extracted field'),
      fields.length
        ? h('ul', { class: 'c-doc-inspector__fields' }, fields.map((f) => fieldItem(doc, f)))
        : h('p', { class: 'c-doc-inspector__empty' }, 'Layout only: no field is read from this region.'),
      h('h4', { class: 'divider-label c-doc-inspector__sub' }, 'Provenance'),
      provenance(doc, region));
  }

  function regionQuote(region) {
    if (!Array.isArray(region.rows)) return h('blockquote', { class: 'c-doc-inspector__quote' }, region.text);
    const [head, ...body] = region.rows;
    return h('div', { class: 'c-doc-inspector__qwrap' },
      h('table', { class: 'c-doc-inspector__qtable' },
        region.text && h('caption', null, region.text),
        h('thead', null, h('tr', null, head.map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', null, body.map((row) => h('tr', null, row.map((c) => h('td', null, c)))))));
  }

  function fieldItem(doc, field) {
    const ev = eventOf(doc, field) || { outcome: NEW, prior: [] };
    const rejected = ev.outcome === REJECTED;
    const claim = ev.claim && keep([ev.claim]).length ? ev.claim : null;
    const note = rejected ? ev.why : field.note;
    return h('li', { class: 'c-doc-inspector__field', dataset: { outcome: ev.outcome } },
      h('div', { class: 'c-doc-inspector__frow' },
        h('span', { class: 'c-doc-inspector__flabel' }, field.label),
        h('span', { class: ['c-doc-inspector__fvalue', rejected && 'is-misread'] }, typeset(rejected ? ev.read : field.value))),
      (field.scope || rejected) && h('p', { class: 'c-doc-inspector__fmeta' },
        rejected ? `Printed “${field.value}”, read “${ev.read}”` : `Scope: ${field.scope}`),
      h('div', { class: 'c-doc-inspector__fout' },
        badge(ev.outcome),
        h('span', { class: 'c-doc-inspector__vs' }, rejected ? 'nothing is written' : 'against memory')),
      memoryLine(keep(ev.prior || []), rejected),
      note && h('p', { class: 'c-doc-inspector__note' }, typeset(note)),
      !rejected && fate(ev, claim));
  }

  function memoryLine(prior, rejected) {
    const label = rejected ? 'Memory kept' : 'Memory before';
    return h('div', { class: 'c-doc-inspector__mem' },
      h('span', { class: 'c-doc-inspector__mem-k' }, label),
      prior.length
        ? h('ul', { class: 'c-doc-inspector__mem-list' }, prior.map((p) => h('li', null,
          h('b', null, typeset(p.value)), p.scope && h('span', { class: 'c-doc-inspector__muted' }, ` (${p.scope})`), ' ',
          refButton(p.doc, regionOf(p.doc, p.field.region)), ' ',
          h('span', { class: 'c-doc-inspector__int' }, typeset(interval(p))))))
        : h('span', { class: 'c-doc-inspector__muted' }, 'nothing stored for this field'));
  }

  /** What the stream later does to a claim, with links to each source. */
  function fate(ev, claim) {
    const items = [];
    const at = (c) => refButton(c.doc, regionOf(c.doc, c.field.region));
    if (ev.outcome === 'support' && ev.target && keep([ev.target]).length) {
      items.push(['support', ['Corroborates ', at(ev.target), ` (“${ev.target.value}”); no new claim is written.`]]);
    }
    if (ev.outcome === 'escalate') items.push(['escalate', ['Held for a person: not written to memory.']]);
    if (claim) {
      items.push(['read', [h('span', { class: 'c-doc-inspector__mem-k' }, 'Valid'), ' ', h('span', { class: 'c-doc-inspector__int' }, typeset(interval(claim)))]]);
      if (claim.closedBy) items.push(['supersede', [`Closed ${claim.to} by `, at(claim.closedBy), ` (“${claim.closedBy.value}”).`]]);
      for (const x of claim.corroborations) items.push(['support', ['Corroborated by ', at(x), '.']]);
      for (const x of keep(claim.coexists)) items.push(['scope-coexist', ['Stands beside ', at(x), ` (“${x.value}”, ${x.scope}).`]]);
      for (const x of keep(claim.conflicts)) items.push(['retain-conflict', ['In conflict with ', at(x), ` (“${x.value}”); both kept.`]]);
      for (const q of run.queue) {
        if (q.against.includes(claim)) items.push(['escalate', ['Contradicted by ', at(q.claim), ` (“${q.field.value}”), escalated for review.`]]);
      }
      for (const e of run.events) {
        if (e.outcome === REJECTED && e.active.includes(claim)) {
          items.push([REJECTED, [`A misread “${e.read}” from `, refButton(e.doc, regionOf(e.doc, e.field.region)), ' was rejected; this claim stands.']]);
        }
      }
    }
    return items.length > 0 && h('ul', { class: 'c-doc-inspector__fate' }, items.map(([o, parts]) =>
      h('li', { dataset: { outcome: o } }, icon(o, 'c-doc-inspector__fate-icon'), h('span', null, parts))));
  }

  function provenance(doc, region) {
    const [x, y, w, hh] = region.box;
    const rows = [
      ['Document', titleOf(doc)],
      ['Section', region.section || '—'],
      ['Page', String(PAGE)],
      ['Box (x, y, w, h)', `[${x}, ${y}, ${w}, ${hh}]`],
      ['Dated', doc.effective ? `${doc.date}, effective ${doc.effective}` : doc.date],
    ];
    return h('dl', { class: 'c-doc-inspector__prov' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
  }

  /* ------------------------------------------------------------ history */

  const keyButtons = keys.map((k) => h('button', {
    type: 'button',
    'aria-pressed': 'false',
    dataset: { key: k },
    onClick: () => setKey(k, true),
  }, keyLabel(k)));
  const chart = h('div', { class: 'c-doc-inspector__chart' });
  const histNote = h('div', { class: 'c-doc-inspector__hnote' });
  const history = h('section', { class: 'c-doc-inspector__panel c-doc-inspector__history', 'aria-labelledby': `${base}-hist` },
    h('div', { class: 'c-doc-inspector__phead' },
      h('h3', { class: 'c-doc-inspector__ptitle', id: `${base}-hist` }, 'Field history'),
      h('p', { class: 'c-doc-inspector__psub' }, `Validity of each claim, ${axis.label}`)),
    h('div', { class: 'segmented c-doc-inspector__keys', role: 'group', 'aria-label': 'Field to trace' }, keyButtons),
    chart,
    histNote);

  function setKey(k, fromUser) {
    if (!keys.includes(k)) return;
    state.key = k;
    for (const b of keyButtons) b.setAttribute('aria-pressed', String(b.dataset.key === k));
    if (fromUser) {
      renderHistory();
      ctx.announce(historySummary());
    }
  }

  function syncKey() {
    const doc = docs[state.doc];
    const region = regionOf(doc, state.region);
    const f = region && !fileDeleted(doc) && fieldsIn(doc, region).find((x) => keys.includes(x.key));
    if (f) setKey(f.key, false);
  }

  function historyRows(key) {
    const rows = keep(run.claims).filter((c) => c.key === key).map((c) => ({ type: 'claim', c, doc: c.doc, start: c.from }));
    for (const q of run.queue) {
      if (q.field.key === key) rows.push({ type: 'escalate', q, doc: q.doc, start: q.doc.date });
    }
    for (const e of run.events) {
      if (e.outcome === REJECTED && e.field.key === key) rows.push({ type: REJECTED, e, doc: e.doc, start: e.doc.date });
    }
    return rows.sort((a, b) => parseDay(a.start) - parseDay(b.start));
  }

  function statusOf(c) {
    if (c.residual) return `residual-${c.residual}`;
    if (c.to) return 'closed';
    return c.conflicts.length ? 'conflict' : 'open';
  }

  const STATUS_TEXT = {
    open: () => 'in force',
    closed: (c) => `closed ${fmtDay(c.to)}`,
    conflict: () => 'in conflict',
    'residual-file': () => 'file deleted',
    'residual-schema': () => 'evidence removed',
  };

  function marker(outcome, iso, text) {
    return h('span', { class: 'c-doc-inspector__hmark', dataset: { outcome }, style: { left: `${pos(iso)}%` }, title: text }, icon(outcome));
  }

  function historyRow(row) {
    const current = row.doc === docs[state.doc];
    const region = (doc, field) => regionOf(doc, field.region);
    if (row.type !== 'claim') {
      const escalated = row.type === 'escalate';
      const doc = row.doc;
      const field = escalated ? row.q.field : row.e.field;
      const text = escalated ? 'escalated' : 'rejected';
      return h('li', { class: ['c-doc-inspector__hrow', current && 'is-current'], dataset: { status: escalated ? 'escalated' : REJECTED } },
        h('div', { class: 'c-doc-inspector__hlabel' },
          h('span', { class: 'c-doc-inspector__hval' }, escalated ? field.value : row.e.read),
          h('span', { class: 'c-doc-inspector__hmeta' }, refButton(doc, region(doc, field)), ` · ${text}`),
          h('span', { class: 'visually-hidden' }, ` Read ${fmtDate(doc.date)}.`)),
        h('div', { class: 'c-doc-inspector__htrack', 'aria-hidden': 'true' },
          marker(escalated ? 'escalate' : REJECTED, doc.date, text)));
    }
    const c = row.c;
    const status = statusOf(c);
    const left = pos(c.from);
    const right = c.to ? pos(isoDay(parseDay(c.to) + DAY)) : 100;
    const marks = [];
    const notes = [];
    for (const x of c.corroborations) {
      marks.push(marker('support', x.doc.date, `Corroborated by ${x.doc.ref}`));
      notes.push(`Corroborated by ${x.doc.ref} on ${fmtDate(x.doc.date)}.`);
    }
    notes.push(c.to ? `Valid ${fmtDate(c.from)} to ${fmtDate(c.to)}.` : `Valid from ${fmtDate(c.from)}.`);
    if (c.doc.date !== c.from) notes.push(`Signed ${fmtDate(c.doc.date)}.`);
    for (const x of keep(c.conflicts)) notes.push(`In conflict with ${x.doc.ref} (${x.value}).`);
    return h('li', { class: ['c-doc-inspector__hrow', current && 'is-current'], dataset: { status } },
      h('div', { class: 'c-doc-inspector__hlabel' },
        h('span', { class: 'c-doc-inspector__hval' }, c.value),
        c.scope && h('span', { class: 'c-doc-inspector__hscope' }, c.scope),
        h('span', { class: 'c-doc-inspector__hmeta' }, refButton(c.doc, region(c.doc, c.field)), ` · ${STATUS_TEXT[status](c)}`),
        h('span', { class: 'visually-hidden' }, ` ${notes.join(' ')}`)),
      h('div', { class: 'c-doc-inspector__htrack', 'aria-hidden': 'true' },
        c.doc.date !== c.from && h('span', {
          class: 'c-doc-inspector__hlead',
          style: { left: `${pos(c.doc.date)}%`, width: `${left - pos(c.doc.date)}%` },
        }),
        h('span', { class: ['c-doc-inspector__hbar', !c.to && 'is-open'], style: { left: `${left}%`, width: `${right - left}%` } }),
        marks));
  }

  function renderHistory() {
    const rows = historyRows(state.key);
    mount(chart,
      h('div', { class: 'c-doc-inspector__gridlines', 'aria-hidden': 'true' },
        axis.months.map((m) => h('span', { style: { left: `${m.left}%` } }))),
      h('div', { class: 'c-doc-inspector__axis', 'aria-hidden': 'true' },
        h('span', { class: 'c-doc-inspector__axis-year' }, axis.year),
        h('span', { class: 'c-doc-inspector__axis-track' },
          axis.months.map((m) => h('span', { class: 'c-doc-inspector__axis-m', style: { left: `${m.left}%` } }, m.label)))),
      h('ol', { class: 'c-doc-inspector__hrows', 'aria-label': `${keyLabel(state.key)}, claims over time` },
        rows.length ? rows.map(historyRow) : h('li', { class: 'c-doc-inspector__hempty' }, 'No claim left for this field.')));
    mount(histNote, historyLegend(rows), erasureNote());
  }

  function historyLegend(rows) {
    const seen = new Set(rows.map((r) => (r.type === 'claim' ? statusOf(r.c) : r.type)));
    if (rows.some((r) => r.type === 'claim' && r.c.doc.date !== r.c.from)) seen.add('lead');
    const items = [
      ['open', 'in force'], ['closed', 'closed by a later claim'], ['conflict', 'kept in conflict'],
      ['residual-file', 'source file deleted'], ['residual-schema', 'evidence removed'],
      ['lead', 'signed, not yet effective'],
    ].filter(([k]) => seen.has(k));
    return items.length > 0 && h('ul', { class: 'c-doc-inspector__legend' },
      items.map(([k, label]) => h('li', null, h('span', { class: 'c-doc-inspector__swatch', dataset: { status: k }, 'aria-hidden': 'true' }), label)));
  }

  function erasureNote() {
    if (!state.level || !targetDoc) return null;
    const touched = run.claims.some((c) => c.doc.id === target && c.key === state.key);
    const st = steps[state.level - 1];
    if (!touched || !st) return null;
    const left = keep(run.claims).filter((c) => c.doc.id === target).length;
    if (!left) return h('p', { class: 'c-doc-inspector__hwarn is-ok' }, h('b', null, `Level ${st.level}: `), st.text);
    if (state.level === 2 && data.unlearning_note) {
      return h('p', { class: 'c-doc-inspector__hwarn' }, h('b', null, 'Still stored. '), 'From the paper: ', data.unlearning_note);
    }
    return h('p', { class: 'c-doc-inspector__hwarn' }, h('b', null, `Level ${st.level}: `), `${st.text} Every claim derived from it is still stored.`);
  }

  function historySummary() {
    const claims = keep(run.claims).filter((c) => c.key === state.key);
    const open = claims.filter((c) => !c.to).length;
    return `${keyLabel(state.key)}: ${claims.length} stored claim${claims.length === 1 ? '' : 's'}, ${open} open.`;
  }

  /* -------------------------------------------------------- the gate */

  const validate = stage('validate');
  const noisyDoc = noisy && docs.find((d) => d.id === noisy.document);
  const noisyField = noisyDoc && (noisyDoc.fields || []).find((f) => f.key === noisy.key);
  const gateBtn = noisyField && h('button', {
    type: 'button',
    class: 'btn btn--secondary btn--sm c-doc-inspector__toggle',
    'aria-pressed': 'false',
    onClick: toggleNoisy,
  }, h('span', { class: 'c-doc-inspector__switch', 'aria-hidden': 'true' }), 'Simulate an OCR error');
  const gateChecks = h('ul', { class: 'c-doc-inspector__checks', 'aria-label': 'Gate checks' });
  const gateStatus = h('p', { class: 'c-doc-inspector__status' });
  const gateCard = gateBtn && h('section', { class: 'c-doc-inspector__card', 'aria-labelledby': `${base}-gate` },
    h('p', { class: 'c-doc-inspector__kicker' }, validate ? validate.name : 'Validate'),
    h('h3', { class: 'c-doc-inspector__ctitle', id: `${base}-gate` }, `A misread ${noisyDoc.kind.toLowerCase()} cell`),
    validate && h('p', { class: 'c-doc-inspector__cbody' }, validate.body),
    gateBtn,
    gateChecks,
    gateStatus);

  /** What the gate compares an observation with: the row's arithmetic and memory. */
  function checksFor(read) {
    const region = regionOf(noisyDoc, noisyField.region);
    const at = matchCell(region, noisyField.value);
    const out = [];
    if (at) {
      const [head] = region.rows;
      const row = region.rows[at[0]];
      const qi = head.findIndex((x) => /^(qty|quantity)$/i.test(x));
      const ai = head.findIndex((x) => /^amount$/i.test(x));
      if (qi >= 0 && ai >= 0) {
        const ok = Math.abs(money(row[qi]) * money(read) - money(row[ai])) < 0.005;
        out.push([ok, `Row arithmetic: ${row[qi]} × ${read} ${ok ? '=' : '≠'} ${row[ai]}`]);
      }
    }
    const ev = eventOf(noisyDoc, noisyField);
    const prior = ev ? ev.prior : [];
    const same = prior.find((p) => p.value === read);
    out.push([Boolean(same), same
      ? `Memory: matches ${shortRef(same.doc.ref)} ${place(regionOf(same.doc, same.field.region))} (“${same.value}”)`
      : `Memory: matches no stored rate (${prior.map((p) => p.value).join(', ') || 'none'})`]);
    return out;
  }

  function renderGate() {
    if (!gateBtn) return;
    gateBtn.setAttribute('aria-pressed', String(state.noisy));
    gateCard.classList.toggle('is-on', state.noisy);
    const read = state.noisy ? noisy.read : noisyField.value;
    mount(gateChecks, checksFor(read).map(([ok, text]) => h('li', { dataset: { ok: String(ok) } },
      icon(ok ? 'support' : REJECTED, 'c-doc-inspector__check-icon'),
      h('span', null, h('span', { class: 'visually-hidden' }, ok ? 'Passes: ' : 'Fails: '), typeset(text)))));
    const ev = eventOf(noisyDoc, noisyField);
    const kept = ev ? ev.active.map((c) => `“${c.value}”`).join(' and ') : '';
    mount(gateStatus, state.noisy
      ? [h('b', { class: 'c-doc-inspector__verdict' }, icon(REJECTED), 'Rejected.'),
        ` Nothing is written${kept ? `; ${kept} stays in force` : ''}.`]
      : [h('b', { class: 'c-doc-inspector__verdict is-ok' }, icon('support'), 'Admitted.'),
        ` “${read}” is written, then reconciled: ${outcomeName(ev ? ev.outcome : NEW, outcomes)}.`]);
  }

  function toggleNoisy() {
    state.noisy = !state.noisy;
    run = replay(docs, { noisy: state.noisy ? noisy : null });
    steady(gateBtn, () => {
      renderGate();
      if (state.noisy) selectDoc(docs.indexOf(noisyDoc), noisy.region);
      else {
        renderStage();
        renderInspector();
        renderHistory();
      }
    });
    ctx.announce(state.noisy
      ? `The gate rejects “${noisy.read}”; the state is unchanged.`
      : `OCR error off: ${noisyDoc.ref} is read as printed.`);
  }

  /* ----------------------------------------------------- the erasure */

  const forget = stage('forget');
  const levelItems = steps.map((st) => h('li', { class: 'c-doc-inspector__level' },
    h('span', { class: 'c-doc-inspector__lmark', 'aria-hidden': 'true' }),
    h('span', { class: 'c-doc-inspector__ltext' },
      h('b', null, `Level ${st.level}`, levelName(st.level) ? ` · ${levelName(st.level)}` : ''),
      h('span', null, st.text)),
    h('span', { class: 'visually-hidden', 'data-level-state': '' })));
  const applyBtn = h('button', { type: 'button', class: 'btn btn--sm', onClick: applyLevel });
  const resetBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: resetErasure }, 'Reset');
  const residualEl = h('div', { class: 'c-doc-inspector__status' });
  const forgetCard = targetDoc && steps.length > 0 && h('section', { class: 'c-doc-inspector__card', 'aria-labelledby': `${base}-forget` },
    h('p', { class: 'c-doc-inspector__kicker' }, forget ? forget.name : 'Forget'),
    h('h3', { class: 'c-doc-inspector__ctitle', id: `${base}-forget` }, deletion.reason),
    forget && h('p', { class: 'c-doc-inspector__cbody' }, forget.body),
    h('ol', { class: 'c-doc-inspector__levels' }, levelItems),
    residualEl,
    h('div', { class: 'c-doc-inspector__actions' }, applyBtn, resetBtn));

  function residualList() {
    const left = keep(run.claims).filter((c) => c.doc.id === target);
    if (!left.length) return h('p', { class: 'c-doc-inspector__empty' }, `Nothing derived from ${targetDoc.ref} remains.`);
    return h('ul', { class: 'c-doc-inspector__mem-list c-doc-inspector__residual' }, left.map((c) => h('li', null,
      h('b', null, c.label), ` ${c.value}`, c.scope ? ` (${c.scope})` : '',
      h('span', { class: 'c-doc-inspector__muted' }, c.residual === 'schema' ? ', in the consolidated schema, without its evidence' : ', with its embeddings and graph nodes'))));
  }

  function renderForget() {
    if (!forgetCard) return;
    levelItems.forEach((li, i) => {
      const done = state.level > i;
      li.classList.toggle('is-done', done);
      li.classList.toggle('is-next', state.level === i);
      li.querySelector('[data-level-state]').textContent = done ? ' (applied)' : ' (not applied)';
    });
    const finished = state.level >= steps.length;
    applyBtn.textContent = finished ? 'All levels applied' : `Apply level ${state.level + 1} of ${steps.length}`;
    applyBtn.setAttribute('aria-disabled', String(finished));
    resetBtn.setAttribute('aria-disabled', String(!state.level));
    forgetCard.classList.toggle('is-on', state.level > 0);
    const left = keep(run.claims).filter((c) => c.doc.id === target);
    mount(residualEl, state.level
      ? (left.length
        ? [h('b', null, 'Still in memory: '), left.map((c) => `${c.label.toLowerCase()} ${c.value}`).join('; '), '.']
        : [h('b', { class: 'c-doc-inspector__verdict is-ok' }, icon('support'), 'Done.'), ` Nothing derived from ${targetDoc.ref} remains.`])
      : `${targetDoc.ref} is in memory: its file and ${left.length} claim${left.length === 1 ? '' : 's'}.`);
  }

  function applyLevel() {
    if (state.level >= steps.length) return;
    state.level += 1;
    const st = steps[state.level - 1];
    const touched = run.claims.find((c) => c.doc.id === target && keys.includes(c.key));
    steady(applyBtn, () => {
      if (touched) setKey(touched.key, false);
      renderTabs();
      // The first level shows the deleted file; later ones keep the view.
      if (state.level === 1) selectDoc(docs.indexOf(targetDoc));
      else {
        renderStage();
        renderInspector();
        renderHistory();
      }
      renderForget();
    });
    ctx.announce(`Level ${st.level}${levelName(st.level) ? `, ${levelName(st.level)}` : ''}: ${st.text}`);
  }

  function resetErasure() {
    if (!state.level) return;
    state.level = 0;
    steady(resetBtn, () => {
      renderTabs();
      renderStage();
      renderInspector();
      renderHistory();
      renderForget();
    });
    ctx.announce(`Erasure undone: ${targetDoc.ref} is back in memory.`);
  }

  /* ---------------------------------------------------------- selection */

  function defaultRegion(doc) {
    const find = (pred) => doc.regions.find((r) => fieldsIn(doc, r).some(pred));
    return (find((f) => keys.includes(f.key)) || find(() => true) || doc.regions[0]).id;
  }

  function selectDoc(i, regionId = '') {
    state.doc = i;
    tabs.forEach((t, j) => {
      t.setAttribute('aria-selected', String(j === i));
      t.tabIndex = j === i ? 0 : -1;
    });
    const doc = docs[i];
    state.region = regionId && regionOf(doc, regionId) ? regionId : defaultRegion(doc);
    renderStage();
    syncKey();
    renderInspector();
    renderHistory();
  }

  function selectRegion(id) {
    state.region = id;
    markRegion();
    syncKey();
    renderInspector();
    renderHistory();
  }

  function jumpTo(docId, regionId) {
    const i = docs.findIndex((d) => d.id === docId);
    if (i < 0) return;
    selectDoc(i, regionId);
    const btn = regionButtons.find((b) => b.dataset.region === state.region);
    (btn || tabs[i]).focus();
  }

  /* -------------------------------------------------------------- mount */

  const cards = [gateCard, forgetCard].filter(Boolean);
  mount(app,
    tablist,
    h('div', { class: 'c-doc-inspector__body' },
      stagePanel,
      h('div', { class: 'c-doc-inspector__side' },
        inspector,
        keys.length > 0 && history,
        cards.length > 0 && h('div', { class: 'c-doc-inspector__cards' }, cards))));
  app.hidden = false;
  if (alt) alt.open = false;
  renderTabs();
  renderGate();
  renderForget();
  selectDoc(0);
}
