// Table III, substrate options, with a composer. Pick any of the single
// substrates and each capability shows the best mark available in the
// selection (✓ > Partial > Implicit > –) and which substrate provides it.
// Combining rows this way is our illustration and is labelled on screen;
// the paper rates single substrates and a hybrid, and a preset shows the
// hybrid row exactly as rated. Data: site.data.paper.substrates.
import { h, $, $$, mount, uid } from '../lib/dom.js';
import { mark, markKind, listText, numberWord } from './audit-marks.js';

const RANK = { '✓': 3, Partial: 2, Implicit: 1, '–': 0 };
const DISCLAIMER = 'Combining rows by best available mark is our illustration; the paper rates single substrates and a hybrid.';

export default function init(root, ctx) {
  const data = ctx.data(root, 'substrates');
  const table = $('.c-substrates__table', root);
  const wrap = $('.c-substrates__wrap', root);
  if (!data || !Array.isArray(data.rows) || !Array.isArray(data.capabilities) || !table || !wrap) return;

  const caps = data.capabilities;
  const rows = data.rows.map((r, index) => ({ ...r, index }));
  const singles = rows.filter((r) => !r.hybrid);
  const hybrid = rows.find((r) => r.hybrid);
  const meaning = Object.fromEntries((data.legend || []).map((l) => [l.mark, l.meaning]));
  const value = (r, key) => r[key] || '–';
  const rank = (v) => RANK[v] ?? 0;

  // Start from one familiar store, so the first view already makes the point.
  const state = { selected: new Set(singles.slice(0, 1).map((r) => r.index)), hybrid: false, before: null };

  /* ------------------------------------------------------------ controls */

  const labelId = uid('substrates');
  const chips = singles.map((r) => h('button', {
    type: 'button',
    class: 'chip c-substrates__chip',
    'aria-pressed': 'false',
    dataset: { row: r.index },
    onClick: () => toggle(r.index),
  }, h('span', { class: 'c-substrates__tick', 'aria-hidden': 'true' }), r.name));

  const preset = hybrid ? h('button', {
    type: 'button',
    class: 'btn btn--secondary btn--sm c-substrates__preset',
    'aria-pressed': 'false',
    onClick: togglePreset,
  }, 'The paper’s hybrid row') : null;
  const clear = h('button', { type: 'button', class: 'btn btn--ghost btn--sm c-substrates__clear', onClick: clearAll }, 'Clear');

  const controls = h('div', { class: 'c-substrates__controls' },
    h('p', { class: 'c-substrates__k', id: labelId }, 'Combine single substrates'),
    h('div', { class: 'c-substrates__chips', role: 'group', 'aria-labelledby': labelId }, chips),
    h('div', { class: 'c-substrates__presets' }, preset, clear));

  const score = h('div', { class: 'c-substrates__score' });
  const list = h('ul', { class: 'c-substrates__caps', 'aria-label': 'Capabilities of the selection' });
  const result = h('div', { class: 'c-substrates__result' }, score, list);
  const disclaimer = h('p', { class: 'note-illustrative c-substrates__disclaimer' }, DISCLAIMER);
  wrap.before(h('div', { class: 'c-substrates__composer' }, controls, result), disclaimer);

  /* --------------------------------------------------------- composing */

  function compose() {
    if (state.hybrid) {
      return caps.map((cap) => ({ cap, value: value(hybrid, cap.key), providers: [hybrid] }));
    }
    const picked = singles.filter((r) => state.selected.has(r.index));
    return caps.map((cap) => {
      let top = -1;
      let best = [];
      for (const r of picked) {
        const s = rank(value(r, cap.key));
        if (s > top) { top = s; best = [r]; } else if (s === top) best.push(r);
      }
      return { cap, value: best.length ? value(best[0], cap.key) : '–', providers: top > 0 ? best : [] };
    });
  }

  function selectionLabel() {
    if (state.hybrid) return 'The paper’s hybrid row';
    const names = singles.filter((r) => state.selected.has(r.index)).map((r) => r.name);
    return names.length ? names.join(' + ') : 'No substrate selected';
  }

  /* ------------------------------------------------------------ render */

  function item(x, empty) {
    const kind = markKind(x.value);
    const how = x.value === '✓' || x.value === '–' ? meaning[x.value] : `${x.value} · ${meaning[x.value] || ''}`;
    let via = 'select a substrate';
    if (state.hybrid) via = `as rated in the ${hybrid.name} row`;
    else if (x.providers.length > 2 && x.providers.length === state.selected.size) via = `via all ${numberWord(x.providers.length)} selected`;
    else if (x.providers.length) via = `via ${listText(x.providers.map((r) => r.name))}`;
    else if (!empty) via = 'no selected substrate provides it';
    return h('li', { class: ['c-substrates__item', `is-${empty ? 'empty' : kind}`] },
      h('p', { class: 'c-substrates__cap' }, mark(x.value, 'mk--bare'), h('span', {}, x.cap.label)),
      empty ? null : h('p', { class: 'c-substrates__how' }, how),
      h('p', { class: 'c-substrates__via' }, via));
  }

  function render(announce) {
    const res = compose();
    const empty = !state.hybrid && state.selected.size === 0;
    const native = res.filter((x) => x.value === '✓').length;
    const rest = ['Partial', 'Implicit', '–']
      .map((v) => ({ v, n: res.filter((x) => x.value === v).length }))
      .filter((x) => x.n && !empty);

    for (const chip of chips) chip.setAttribute('aria-pressed', String(!state.hybrid && state.selected.has(Number(chip.dataset.row))));
    if (preset) preset.setAttribute('aria-pressed', String(state.hybrid));
    clear.disabled = empty;
    root.classList.toggle('is-hybrid', state.hybrid);

    mount(score,
      h('p', { class: 'c-substrates__sel' }, selectionLabel()),
      h('div', { class: 'c-substrates__line' },
        h('p', { class: 'c-substrates__big' }, h('b', {}, String(native)), h('span', {}, ` of ${caps.length}`), h('span', { class: 'c-substrates__unit' }, ' capabilities native')),
        h('p', { class: 'c-substrates__glyphs', 'aria-hidden': 'true' }, res.map((x) => mark(x.value, 'mk--bare')))),
      rest.length ? h('p', { class: 'c-substrates__rest' }, rest.map((x) => `${x.n} ${x.v === '–' ? meaning['–'] : x.v.toLowerCase()}`).join(' · ')) : null);
    mount(list, res.map((x) => item(x, empty)));
    highlight(res);
    if (announce) ctx.announce(`${selectionLabel()}: ${native} of ${caps.length} capabilities native.`);
  }

  // Selected rows are tinted; the cells that supply each capability's mark
  // are outlined, so the table shows where every result comes from.
  function highlight(res) {
    const active = state.hybrid ? new Set([hybrid.index]) : state.selected;
    for (const tr of $$('tbody tr[data-row]', table)) tr.classList.toggle('is-selected', active.has(Number(tr.dataset.row)));
    for (const td of $$('td.is-best', table)) td.classList.remove('is-best');
    for (const x of res) {
      for (const r of x.providers) $(`tr[data-row="${r.index}"] td[data-col="${x.cap.key}"]`, table)?.classList.add('is-best');
    }
  }

  /* ------------------------------------------------------------- state */

  function toggle(index) {
    if (state.hybrid) {
      state.hybrid = false;
      state.selected = new Set([index]);
    } else if (state.selected.has(index)) state.selected.delete(index);
    else state.selected.add(index);
    render(true);
  }

  function togglePreset() {
    if (state.hybrid) {
      state.hybrid = false;
      state.selected = state.before || new Set();
    } else {
      state.before = new Set(state.selected);
      state.hybrid = true;
    }
    render(true);
  }

  function clearAll() {
    state.hybrid = false;
    state.selected = new Set();
    render(true);
    chips[0]?.focus();
  }

  // Mouse shortcut: clicking a row's name in the table toggles it too.
  table.addEventListener('click', (e) => {
    const th = e.target.closest('tbody th[scope="row"]');
    const tr = th && th.closest('tr[data-row]');
    if (!tr) return;
    const index = Number(tr.dataset.row);
    if (hybrid && index === hybrid.index) togglePreset();
    else toggle(index);
  });

  root.classList.add('is-enhanced');
  render(false);
}
