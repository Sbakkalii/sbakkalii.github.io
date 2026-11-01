// Table IV, the statefulness audit, upgraded in place. Each criterion header
// becomes a toggle that focuses its column and explains how the ten document
// benchmarks code it; a computed row counts them under every column; two
// toggles show or hide the adjacent and the proposed rows. Every count is
// computed from _data/paper.yml (site.data.paper.audit).
import { h, $, $$, mount, roving } from '../lib/dom.js';
import { mark, markKind, tally, listText, numberWord as word, byMark } from './audit-marks.js';

// The Provenance column records grounding granularity instead of Yes / –
// (see audit.provenance_note), so it is summarised by label, not by Yes.
const GRANULAR = 'provenance';
const RANK = { full: 0, qual: 1, partial: 2, implicit: 3, none: 4 };

export default function init(root, ctx) {
  const data = ctx.data(root, 'audit');
  const table = $('.c-audit__table', root);
  const wrap = $('.c-audit__wrap', root);
  if (!data || !Array.isArray(data.rows) || !Array.isArray(data.criteria) || !table || !wrap) return;

  const criteria = data.criteria;
  const docs = data.rows.filter((r) => !r.adjacent && !r.proposed);
  const beyond = data.rows.filter((r) => r.adjacent || r.proposed);
  const noneMeaning = (data.legend || []).find((l) => l.mark === '–')?.meaning || '–';
  const state = { focus: null, hover: null };

  const value = (row, key) => row[key] || '–';
  const groupsFor = (c) => tally(docs.map((r) => ({ value: value(r, c.key), item: r.name }))).sort(byMark);

  /* ------------------------------------------------------------ headers */

  const buttons = criteria.map((c) => {
    const th = $(`thead th[data-col="${c.key}"]`, table);
    const btn = h('button', {
      type: 'button',
      class: 'c-audit__colbtn',
      'aria-pressed': 'false',
      title: c.name,
      dataset: { col: c.key },
      onClick: () => select(state.focus === c.key ? null : c.key),
    }, c.label);
    if (th) mount(th, btn);
    return btn;
  });
  roving(buttons, { onSelect: (i) => select(criteria[i].key) });
  for (const btn of buttons) {
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.focus) { e.preventDefault(); select(null); }
    });
  }

  /* -------------------------------------------------------- summary row */

  const docsBody = $('[data-group="docs"]', table);
  const summary = h('tbody', { class: 'c-audit__group c-audit__group--summary', dataset: { group: 'summary' } },
    h('tr', {},
      h('th', { scope: 'row' },
        h('span', { class: 'c-audit__sumlabel' }, `Of the ${word(docs.length)}`),
        h('span', { class: 'c-audit__sumsub' }, 'computed')),
      criteria.map(summaryCell)));
  if (docsBody) docsBody.after(summary);

  function summaryCell(c) {
    const values = docs.map((r) => value(r, c.key));
    const kinds = values.map(markKind);
    const granular = c.key === GRANULAR;
    const primaryKind = granular ? 'qual' : 'full';
    const primary = kinds.filter((k) => k === primaryKind).length;
    const rest = tally(values.filter((v, i) => kinds[i] !== primaryKind && kinds[i] !== 'none').map((v) => ({ value: v })));
    const order = [...kinds].sort((a, b) => RANK[a] - RANK[b]);
    return h('td', { class: 'c-audit__sum', dataset: { col: c.key } },
      h('span', { class: 'c-audit__sumval' }, h('b', {}, String(primary)), h('span', {}, granular ? ' with a granularity' : ' Yes')),
      h('span', { class: 'c-audit__bar', 'aria-hidden': 'true' }, order.map((k) => h('i', { class: `is-${k}` }))),
      rest.length ? h('span', { class: 'c-audit__sumnote' }, rest.map((g) => `${g.count} ${g.value}`).join(' · ')) : null);
  }

  /* --------------------------------------------------------- row toggles */

  const toggles = beyond.map((row) => {
    const group = row.adjacent ? 'adjacent' : 'proposed';
    const body = $(`[data-group="${group}"]`, table);
    if (!body) return null;
    const btn = h('button', {
      type: 'button',
      class: 'chip c-audit__toggle',
      'aria-pressed': 'true',
      onClick: () => {
        const show = btn.getAttribute('aria-pressed') !== 'true';
        btn.setAttribute('aria-pressed', String(show));
        body.hidden = !show;
        ctx.announce(`${row.name} row ${show ? 'shown' : 'hidden'}.`);
      },
    }, h('span', { class: 'c-audit__tick', 'aria-hidden': 'true' }), row.name);
    return btn;
  }).filter(Boolean);

  const controls = h('div', { class: 'c-audit__controls' },
    h('p', { class: 'c-audit__hint' }, 'Select a criterion to focus its column.'),
    toggles.length ? h('div', { class: 'c-audit__toggles', role: 'group', 'aria-label': 'Rows beyond the document benchmarks' },
      h('span', { class: 'c-audit__toggles-k', 'aria-hidden': 'true' }, 'Show'), toggles) : null);
  wrap.before(controls);

  /* ------------------------------------------------------ detail panel */

  const panel = h('div', { class: 'c-audit__panel' });
  const finding = $('.c-audit__finding', root);
  const below = h('div', { class: 'c-audit__below' }, panel, finding);
  wrap.after(below);

  function overview() {
    const cells = docs.length * criteria.length;
    const yes = [];
    let none = 0;
    for (const c of criteria) {
      for (const r of docs) {
        const k = markKind(value(r, c.key));
        if (k === 'none') none += 1;
        if (k === 'full') yes.push({ value: c.label, item: r.name });
      }
    }
    const where = tally(yes).map((g) => `${g.value} (${listText(g.items)})`);
    return [
      h('p', { class: 'c-audit__eyebrow' }, `${criteria.length} criteria · ${docs.length} document benchmarks`),
      h('p', { class: 'c-audit__lead' },
        `Of the ${cells} cells for the ${word(docs.length)} document benchmarks, `,
        h('b', {}, `${none} are –`),
        yes.length ? `, and only ${word(yes.length)} ${yes.length === 1 ? 'is' : 'are'} Yes: ${listText(where)}.` : ', and none is Yes.'),
      h('p', { class: 'c-audit__more' }, 'A criterion’s column shows its full name and how each benchmark codes it.'),
    ];
  }

  function detail(c) {
    const i = criteria.indexOf(c);
    const groups = groupsFor(c);
    const others = beyond.filter((r) => !$(`[data-group="${r.adjacent ? 'adjacent' : 'proposed'}"]`, table)?.hidden);
    return [
      h('div', { class: 'c-audit__phead' },
        h('p', { class: 'c-audit__eyebrow' }, `Criterion ${i + 1} of ${criteria.length} · ${c.label}`),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm c-audit__clear', onClick: () => { select(null); buttons[i].focus(); } }, 'Clear')),
      h('h3', { class: 'c-audit__name' }, c.name),
      c.key === GRANULAR && data.provenance_note ? h('p', { class: 'c-audit__pnote' }, data.provenance_note) : null,
      h('p', { class: 'c-audit__sub' }, `How the ${word(docs.length)} document benchmarks code it`),
      h('ul', { class: 'c-audit__tally' }, groups.map((g) => h('li', {},
        h('span', { class: 'c-audit__tmark' }, mark(g.value)),
        h('b', { class: 'c-audit__tcount' }, String(g.count)),
        h('span', { class: 'c-audit__tnames' }, markKind(g.value) !== 'none' ? listText(g.items)
          : g.count === docs.length ? `all ${word(docs.length)}` : `the other ${word(g.count)}`)))),
      others.length ? h('p', { class: 'c-audit__also' },
        h('span', { class: 'c-audit__also-k' }, 'Beyond the ten'),
        others.map((r) => h('span', { class: 'c-audit__also-i' }, `${r.name} `, mark(value(r, c.key))))) : null,
    ];
  }

  function sentence(c) {
    const parts = groupsFor(c).map((g) => `${g.count} ${g.value === '–' ? noneMeaning : g.value}`);
    return `${c.name}. Of the ${docs.length} document benchmarks: ${parts.join(', ')}.`;
  }

  /* ------------------------------------------------------------- state */

  function select(key) {
    state.focus = key;
    for (const btn of buttons) btn.setAttribute('aria-pressed', String(btn.dataset.col === key));
    for (const cell of $$('th[data-col], td[data-col]', table)) cell.classList.toggle('is-focus', cell.dataset.col === key);
    root.classList.toggle('has-focus', Boolean(key));
    const c = criteria.find((x) => x.key === key);
    mount(panel, c ? detail(c) : overview());
    if (c) ctx.announce(sentence(c));
  }

  function hover(key) {
    if (key === state.hover) return;
    state.hover = key;
    for (const cell of $$('th[data-col], td[data-col]', table)) cell.classList.toggle('is-hover', cell.dataset.col === key);
  }

  // Mouse shortcuts: a click on any cell focuses its column (the header
  // buttons are the keyboard path); hovering previews the column.
  table.addEventListener('click', (e) => {
    const cell = e.target.closest('td[data-col]');
    if (cell) select(state.focus === cell.dataset.col ? null : cell.dataset.col);
  });
  table.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'mouse') hover(e.target.closest('[data-col]')?.dataset.col || null);
  });
  table.addEventListener('pointerleave', () => hover(null));

  // Keep the detail panel in step when a row is shown or hidden.
  for (const btn of toggles) btn.addEventListener('click', () => { if (state.focus) mount(panel, detail(criteria.find((x) => x.key === state.focus))); });

  root.classList.add('is-enhanced');
  select(null);
}
