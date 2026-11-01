// Tables I and II of the survey. Table I is rebuilt as a chronological
// matrix: models sorted by year on a time spine, four property columns that
// can be focused and counted, a "Show my work" toggle for the author's own
// models, and an inspector that reveals each model's modality and
// pretraining on hover or focus. Table II (paper page only) gains a computed
// "short of 𝒞*" column and lists each paradigm's gaps when it is selected.
// Data: site.data.paper.lineage, .paradigms, .target; own rows link to the
// publication with the matching slug (resolved in the Liquid partial).
import { h, $, $$, mount, uid, roving } from '../lib/dom.js';
import { mark, tally, listText, numberWord as word, byMark } from './audit-marks.js';

const startYear = (year) => parseInt(String(year), 10) || 0;
const value = (row, key) => row[key] || '–';

export default function init(root, ctx) {
  const data = ctx.data(root, 'lineage');
  if (!data || !data.lineage || !Array.isArray(data.lineage.rows) || !Array.isArray(data.lineage.columns)) return;
  const lineageFig = $('[data-table="lineage"]', root);
  if (lineageFig) lineageMatrix(lineageFig, data.lineage, data.pubs || {}, data.mode !== 'paper', ctx);
  const paradigmsFig = $('[data-table="paradigms"]', root);
  if (paradigmsFig && data.paradigms && Array.isArray(data.paradigms.rows)) {
    paradigmGaps(paradigmsFig, data.paradigms, data.target || '𝒞*', ctx);
  }
}

/* ======================================================= Table I: lineage */

function lineageMatrix(fig, lin, pubs, mineFirst, ctx) {
  const body = $('.figure__body', fig);
  const cols = lin.columns;
  // Chronological: a range such as "2020–22" sorts by its first year; ties
  // keep the paper's order.
  const rows = lin.rows.map((r, i) => ({ ...r, i })).sort((a, b) => startYear(a.year) - startYear(b.year) || a.i - b.i);
  const own = rows.filter((r) => r.own && pubs[r.own]);
  const state = { col: null, active: null, mine: mineFirst && own.length > 0 };

  /* --- controls: column readout and "Show my work" ----------------------- */
  const readout = h('div', { class: 'c-lineage__readout' });
  const mineBtn = own.length ? h('button', {
    type: 'button',
    class: 'chip c-lineage__mine',
    'aria-pressed': String(state.mine),
    onClick: () => setMine(!state.mine, true),
  }, h('span', { class: 'c-lineage__tick', 'aria-hidden': 'true' }), 'Show my work') : null;
  const controls = h('div', { class: 'c-lineage__controls' }, readout, mineBtn);

  /* --- the matrix ------------------------------------------------------- */
  const colBtns = cols.map((c) => h('button', {
    type: 'button',
    class: 'c-lineage__colbtn',
    'aria-pressed': 'false',
    dataset: { col: c.key },
    onClick: () => focusCol(state.col === c.key ? null : c.key),
  }, c.label));
  roving(colBtns, { onSelect: (j) => focusCol(cols[j].key) });

  const rowBtns = [];
  let prevYear = null;
  const trs = rows.map((r) => {
    const first = r.year !== prevYear;
    prevYear = r.year;
    const pub = r.own ? pubs[r.own] : null;
    const metaId = uid('lineage-meta');
    const btn = h('button', {
      type: 'button',
      class: 'c-lineage__rowbtn',
      tabindex: '-1',
      'aria-describedby': metaId,
      onClick: () => activate(r),
      onFocus: () => activate(r),
    }, r.method);
    rowBtns.push(btn);
    r.tr = h('tr', { class: ['c-lineage__row', first && 'is-first', pub && 'is-own'] },
      h('td', { class: 'c-lineage__year' }, h('span', { class: first ? 'c-lineage__ylabel' : 'visually-hidden' }, r.year)),
      h('th', { scope: 'row', class: 'c-lineage__name' },
        // Narrow layouts drop the year column and show the year here instead.
        h('span', { class: ['c-lineage__yinline', !first && 'is-repeat'] }, r.year),
        h('span', { class: 'c-lineage__nameline' }, btn,
          pub ? h('a', { class: 'c-lineage__own', href: pub.url, onFocus: () => activate(r) },
            'My work', h('span', { class: 'visually-hidden' }, `: ${pub.title}`)) : null),
        h('span', { class: 'c-lineage__meta', id: metaId },
          h('span', { class: 'visually-hidden' }, 'Modality: '), r.modality,
          h('span', { 'aria-hidden': 'true' }, ' · '),
          h('span', { class: 'visually-hidden' }, ', pretraining: '), r.pretraining)),
      cols.map((c) => h('td', { dataset: { col: c.key } }, mark(value(r, c.key)))));
    r.tr.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') activate(r); });
    return r.tr;
  });
  if (rowBtns.length) rowBtns[0].tabIndex = 0;
  roving(rowBtns, { orientation: 'vertical' });

  const table = h('table', { class: 'table c-lineage__table c-lineage__table--matrix' },
    h('caption', { class: 'visually-hidden' }, `Table I in chronological order: ${rows.length} representation models and ${cols.length} properties. Select a column header to count its marks; each model's modality and pretraining follow its name.`),
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col', class: 'c-lineage__yearh' }, 'Year'),
      h('th', { scope: 'col', class: 'c-lineage__corner' }, 'Model'),
      cols.map((c, j) => h('th', { scope: 'col', dataset: { col: c.key } }, colBtns[j])))),
    h('tbody', {}, trs));

  const labelledBy = $('.figure__label', fig)?.id;
  const wrap = h('div', { class: 'table-wrap c-lineage__wrap', role: 'region', tabindex: '0', 'aria-labelledby': labelledBy || null }, table);
  const inspector = h('div', { class: 'c-lineage__inspector', role: 'group', 'aria-label': 'Model details' });
  mount(body, controls, h('div', { class: 'c-lineage__grid' }, wrap, inspector));

  /* --- state ------------------------------------------------------------- */
  function focusCol(key) {
    state.col = key;
    for (const b of colBtns) b.setAttribute('aria-pressed', String(b.dataset.col === key));
    for (const cell of $$('th[data-col], td[data-col]', table)) cell.classList.toggle('is-focus', cell.dataset.col === key);
    fig.classList.toggle('has-focus', Boolean(key));
    renderReadout();
    renderInspector();
    const c = cols.find((x) => x.key === key);
    if (c) ctx.announce(countSentence(c));
  }

  function setMine(on, announce) {
    state.mine = on;
    fig.classList.toggle('is-mine', on);
    if (mineBtn) mineBtn.setAttribute('aria-pressed', String(on));
    if (announce) ctx.announce(on ? `Highlighting my work: ${listText(own.map((r) => r.method))}.` : 'My work no longer highlighted.');
  }

  function activate(r) {
    if (state.active === r) return;
    state.active?.tr.classList.remove('is-active');
    state.active = r;
    r.tr.classList.add('is-active');
    const k = rows.indexOf(r);
    rowBtns.forEach((b, j) => { b.tabIndex = j === k ? 0 : -1; });
    renderInspector();
  }

  /* --- readout: counts for the focused column ---------------------------- */
  function yesCount(c) {
    return rows.filter((r) => value(r, c.key) === '✓').length;
  }

  function countSentence(c) {
    const n = yesCount(c);
    return n === 0
      ? `None of the ${rows.length} models is marked ✓ for ${c.label}.`
      : `${n} of the ${rows.length} models are marked ✓ for ${c.label}.`;
  }

  function renderReadout() {
    const c = cols.find((x) => x.key === state.col);
    if (!c) {
      mount(readout, h('p', { class: 'c-lineage__hint' }, `Select a column to count it across the ${word(rows.length)} models.`));
      return;
    }
    const n = yesCount(c);
    const groups = tally(rows.map((r) => ({ value: value(r, c.key), item: r.method }))).sort(byMark);
    mount(readout,
      h('p', { class: ['c-lineage__count', n === 0 && 'is-zero'] }, h('b', {}, String(n)), h('span', {}, ` of ${rows.length}`)),
      h('div', { class: 'c-lineage__rtext' },
        h('p', { class: 'c-lineage__rhead' }, countSentence(c)),
        h('p', { class: 'c-lineage__rgroups' }, groups.map((g) => h('span', { class: 'c-lineage__rgroup' }, mark(g.value, 'mk--says'), h('b', {}, String(g.count)))))));
  }

  /* --- inspector: the active model, or the author's models ---------------- */
  function renderInspector() {
    const r = state.active;
    if (!r) {
      mount(inspector,
        h('p', { class: 'c-lineage__ik' }, own.length ? 'My work in Table I' : 'Table I'),
        own.length ? h('ul', { class: 'c-lineage__ilist' }, own.map((o) => h('li', {},
          h('a', { href: pubs[o.own].url }, o.method),
          h('span', {}, pubs[o.own].venue || o.year)))) : null,
        h('p', { class: 'c-lineage__ihint' }, 'Hover or focus a model to see its modality and pretraining.'));
      return;
    }
    const pub = r.own ? pubs[r.own] : null;
    mount(inspector,
      h('p', { class: 'c-lineage__ik' }, r.year, pub ? h('span', { class: 'c-lineage__ibadge' }, 'My work') : null),
      h('h3', { class: 'c-lineage__iname' }, r.method),
      h('dl', { class: 'c-lineage__ikv' },
        h('dt', {}, 'Modality'), h('dd', {}, r.modality),
        h('dt', {}, 'Pretraining'), h('dd', {}, r.pretraining)),
      h('ul', { class: 'c-lineage__imarks' }, cols.map((c) => h('li', { class: state.col === c.key ? 'is-focus' : null },
        h('span', {}, c.label), mark(value(r, c.key))))),
      pub ? h('p', { class: 'c-lineage__ipub' }, h('a', { href: pub.url }, pub.title), pub.venue ? h('span', {}, pub.venue) : null) : null);
  }

  // The last model stays in the inspector when the pointer leaves the table,
  // so its details remain readable (and its link reachable).
  fig.classList.add('is-enhanced');
  setMine(state.mine, false);
  focusCol(null);
}

/* ================================================ Table II: paradigm gaps */

function paradigmGaps(fig, par, symbol, ctx) {
  const table = $('table', fig);
  const wrap = $('.c-lineage__wrap', fig);
  const bodyRows = table ? $$('tbody tr', table) : [];
  if (!table || !wrap || bodyRows.length !== par.rows.length) return;
  const cols = par.columns;
  // Hover previews a paradigm; a click (or Enter/Space) pins it.
  const state = { active: null, pinned: false };

  const gapsOf = (row) => cols.filter((c) => value(row, c.key) !== '✓');
  const items = par.rows.map((row, j) => ({ row, tr: bodyRows[j], gaps: gapsOf(row) }));
  const adjacent = items.filter((x) => !x.row.target);
  const targetItem = items.find((x) => x.row.target);

  // Header and cells of the computed column.
  $('thead tr', table)?.append(h('th', { scope: 'col', class: 'c-lineage__gaph' }, 'Short of ', h('span', { class: 'math' }, symbol)));
  const buttons = [];
  for (const x of items) {
    const met = cols.length - x.gaps.length;
    const descId = uid('lineage-gap');
    x.tr.append(h('td', { class: 'c-lineage__gapcell' },
      h('span', { class: 'c-lineage__gapval' }, h('b', {}, String(x.gaps.length)), ` of ${cols.length}`),
      h('span', { class: 'c-lineage__gapbar', 'aria-hidden': 'true' }, cols.map((c, k) => h('i', { class: k < met ? 'is-met' : null }))),
      h('span', { class: 'visually-hidden', id: descId }, x.gaps.length ? `Not met in full: ${listText(x.gaps.map((c) => c.label))}.` : 'Meets every property.')));
    const th = $('th[scope="row"]', x.tr);
    // Narrow layouts hide the computed column and show the count here.
    const inline = h('span', { class: 'c-lineage__gapinline' }, x.gaps.length ? `Short on ${x.gaps.length} of ${cols.length}` : `Meets all ${cols.length}`);
    if (x.row.target) {
      th?.append(inline);
      continue;
    }
    const btn = h('button', {
      type: 'button',
      class: 'c-lineage__rowbtn',
      'aria-pressed': 'false',
      'aria-describedby': descId,
      onClick: () => select(state.active === x ? null : x),
    }, x.row.paradigm);
    x.btn = btn;
    buttons.push(btn);
    if (th) mount(th, btn, inline);
    x.tr.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse' && !state.pinned) render(x); });
  }
  roving(buttons, { orientation: 'vertical' });
  table.addEventListener('pointerleave', () => { if (!state.pinned) render(null); });

  const readout = h('div', { class: 'c-lineage__gaps' });
  wrap.after(readout);

  function closest() {
    const fewest = Math.min(...adjacent.map((x) => x.gaps.length));
    return { fewest, names: adjacent.filter((x) => x.gaps.length === fewest).map((x) => x.row.paradigm) };
  }

  function render(x) {
    for (const it of items) it.tr.classList.toggle('is-active', it === x);
    for (const cell of $$('td.is-gap, td.is-need', table)) cell.classList.remove('is-gap', 'is-need');
    if (x) {
      for (const c of x.gaps) {
        $(`td[data-col="${c.key}"]`, x.tr)?.classList.add('is-gap');
        if (targetItem) $(`td[data-col="${c.key}"]`, targetItem.tr)?.classList.add('is-need');
      }
    }
    if (!x) {
      const { fewest, names } = closest();
      mount(readout,
        h('p', { class: 'c-lineage__gk' }, `Computed from Table II · a property counts as met only when marked ✓`),
        h('p', { class: 'c-lineage__glead' },
          `No adjacent paradigm meets all ${word(cols.length)} properties of `, h('span', { class: 'math' }, symbol),
          `. The closest, ${listText(names)}, ${names.length > 1 ? 'are' : 'is'} short on ${word(fewest)}.`),
        h('p', { class: 'c-lineage__ghint' }, 'Select a paradigm to list what it lacks.'));
      return;
    }
    const groups = tally(x.gaps.map((c) => ({ value: value(x.row, c.key), item: c.label }))).sort(byMark);
    mount(readout,
      h('p', { class: 'c-lineage__gk' }, `${x.row.paradigm} · short of `, h('span', { class: 'math' }, symbol), ` on ${x.gaps.length} of ${cols.length}`),
      h('ul', { class: 'c-lineage__glist' }, groups.map((g) => h('li', {}, h('span', { class: 'c-lineage__gmark' }, mark(g.value, 'mk--says')), h('span', {}, listText(g.items))))),
      h('p', { class: 'c-lineage__ghint' }, `Met in full: ${listText(cols.filter((c) => !x.gaps.includes(c)).map((c) => c.label)) || 'none'}.`));
  }

  function select(x) {
    state.active = x;
    state.pinned = Boolean(x);
    for (const it of adjacent) it.btn?.setAttribute('aria-pressed', String(it === x));
    render(x);
    if (x) ctx.announce(`${x.row.paradigm}: short of the target on ${x.gaps.length} of ${cols.length} properties, ${listText(x.gaps.map((c) => c.label))}.`);
  }

  fig.classList.add('is-enhanced');
  render(null);
}
