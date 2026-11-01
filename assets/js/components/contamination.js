// Contamination bound (Theorem III.4, Corollary III.7) as a calculator.
//
// The static figure prints a worked example; this module turns it into live
// readouts, a chart of P_cont(k) = 1 − (1 − p_e·p_c)^k and the controls that
// drive them. Every number is computed from the visitor's inputs: nothing
// here is a measurement.
import { h, s, $, $$, clamp, uid } from '../lib/dom.js';
import { math, mathHTML } from '../lib/math.js';
import { renderChart, pcont, horizon } from './contamination-chart.js';

const START = { pe: 0.05, pc: 0.1, perfect: false, delta: 0.05, kmax: 10000, k: 100, logX: true, wm: 1, dkl: 1 };
const PRESETS = [
  { id: 'weak', label: 'Weak', pc: 0.5 },
  { id: 'good', label: 'Good', pc: 0.01 },
  { id: 'perfect', label: 'Perfect', pc: 0 },
];
const KMAX_VALUES = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
const PC_VALUES = logValues(0.001, 1, 20);
const DELTA_VALUES = logValues(0.001, 0.5, 20);
const TABLE_KS = [1, 10, 100, 1000, 10000];
const SUPERSCRIPT = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

/* ------------------------------------------------------------- numbers */

/** Values evenly spaced on a log scale, rounded to two significant digits. */
function logValues(min, max, perDecade) {
  const lo = Math.log10(min);
  const n = Math.round((Math.log10(max) - lo) * perDecade);
  return Array.from({ length: n + 1 }, (_, i) => Number((10 ** (lo + i / perDecade)).toPrecision(2)));
}

/** Integer k values for the "evaluate at" slider: dense at small k. */
function kValues(kmax) {
  const out = new Set();
  for (let i = 0; i <= 200; i += 1) {
    const v = 10 ** (i / 50);
    const k = v < 10 ? Math.round(v) : Number(v.toPrecision(2));
    if (k <= kmax) out.add(k);
  }
  out.add(kmax);
  return [...out].sort((a, b) => a - b);
}

function nearestIndex(values, v, log = false) {
  let best = 0;
  let bestD = Infinity;
  values.forEach((x, i) => {
    const d = log ? Math.abs(Math.log(x) - Math.log(Math.max(v, 1e-12))) : Math.abs(x - v);
    if (d < bestD) { best = i; bestD = d; }
  });
  return best;
}

function sci(x) {
  const e = Math.floor(Math.log10(x));
  const m = x / 10 ** e;
  const exp = String(e).split('').map((c) => SUPERSCRIPT[c]).join('');
  return `${m.toLocaleString('en-US', { maximumFractionDigits: 2 })} × 10${exp}`;
}

/** Plain number with up to `sig` significant digits; tiny values in powers of ten. */
function num(x, sig = 3) {
  if (x === 0) return '0';
  if (Math.abs(x) < 1e-4) return sci(x);
  return x.toLocaleString('en-US', { maximumSignificantDigits: sig });
}

function pct(p) {
  if (p <= 0) return '0%';
  if (p >= 1) return '≈ 100%';
  const v = p * 100;
  if (v >= 99.995) return '> 99.99%';
  if (v < 0.01) return `${v.toPrecision(2)}%`;
  return `${v.toFixed(2)}%`;
}

function kstarText(kstar) {
  if (!Number.isFinite(kstar)) return '∞';
  if (kstar >= 10000) return Math.round(kstar).toLocaleString('en-US');
  if (kstar >= 100) return kstar.toFixed(1);
  if (kstar >= 1) return kstar.toFixed(2);
  return kstar.toPrecision(2);
}

/** Number of whole updates that stay within δ, as a phrase. */
function withinPhrase(kstar) {
  if (!Number.isFinite(kstar)) return 'every update stays within δ';
  const n = Math.floor(kstar + 1e-9);
  if (n < 1) return 'even one update exceeds δ';
  if (n === 1) return 'only the first update stays within δ';
  return `the first ${n.toLocaleString('en-US')} updates stay within δ`;
}

/** Smallest k with P_cont(k) ≥ 50%. */
function halfway(q) {
  return q > 0 ? Math.ceil(horizon(q, 0.5) - 1e-9) : Infinity;
}

/* ------------------------------------------------------------ controls */

function rangeControl({ label, min, max, step, value, onInput }) {
  const id = uid('cont');
  const input = h('input', { type: 'range', id, min, max, step, value, onInput: () => onInput(Number(input.value)) });
  const output = h('output', { for: id, 'aria-live': 'off' });
  const wrap = h('div', { class: 'range c-contamination__range' },
    h('div', { class: 'range__head' }, h('label', { for: id }, label), output),
    input);
  return { wrap, input, output };
}

/** Notation in unbreakable pieces, so a line can only wrap between them. */
function eqHTML(...pieces) {
  return `<span class="math">${pieces.map((p) => `<span class="c-contamination__nw">${mathHTML(p)}</span>`).join(' ')}</span>`;
}

function symLabel(symbol, name) {
  return [math('span', symbol, { class: 'math' }), ' ', h('span', { class: 'c-contamination__name' }, name)];
}

function toggle(label, pressed, onToggle) {
  const btn = h('button', { type: 'button', class: 'chip c-contamination__toggle', 'aria-pressed': String(pressed) }, label);
  btn.addEventListener('click', () => onToggle(btn.getAttribute('aria-pressed') !== 'true'));
  return btn;
}

/* ----------------------------------------------------------------- init */

export default function init(root, ctx) {
  const data = ctx.data(root, 'contamination');
  const calc = $('[data-calc]', root);
  const stats = $('[data-stats]', root);
  if (!data || !calc || !stats) return;

  const names = Object.fromEntries((data.variables || []).map((v) => [v.symbol, v.name]));
  const state = { ...START };
  let tween = 0;
  let announceTimer = 0;
  let geometry = null;

  /* --- readouts: reuse the worked-example stats, add E[MH(k)] --- */
  const harmStat = h('div', { class: 'c-contamination__stat' },
    h('dt', {}, 'Expected Memory Harm after ', h('span', { dataset: { harmK: '' } }), ' updates'),
    h('dd', { class: 'c-contamination__val', dataset: { val: 'harm' } }),
    h('dd', { class: 'c-contamination__how', dataset: { how: 'harm' } }));
  stats.append(harmStat);
  const val = (key) => $(`[data-val="${key}"]`, stats);
  const how = (key) => $(`[data-how="${key}"]`, stats);

  /* --- chart column --- */
  const svg = s('svg', { class: 'c-contamination__svg', role: 'img', focusable: 'false' });
  const xTitle = h('p', { class: 'c-contamination__axis c-contamination__axis--x' });
  const legend = h('ul', { class: 'c-contamination__legend', 'aria-label': 'Curves' });
  const kControl = rangeControl({
    label: 'Evaluate at k',
    min: 0, max: 1, step: 1, value: 0,
    onInput: (i) => { stopTween(); state.k = kList()[i]; render(); },
  });
  const plot = h('div', { class: 'c-contamination__plot' },
    legend,
    h('p', { class: 'c-contamination__axis c-contamination__axis--y', html: mathHTML('P_cont(k)') }),
    h('div', { class: 'c-contamination__chart' }, svg),
    xTitle,
    kControl.wrap);

  /* --- controls column --- */
  const presetButtons = PRESETS.map((p) => h('button', {
    type: 'button',
    'aria-pressed': 'false',
    dataset: { preset: p.id },
    onClick: () => applyPreset(p),
  }, p.label, h('span', { class: 'c-contamination__preset-val', html: mathHTML(`p_c = ${num(p.pc)}`) })));

  const peControl = rangeControl({
    label: symLabel('p_e', names.p_e || ''),
    min: 0, max: 0.5, step: 0.005, value: state.pe,
    onInput: (v) => { stopTween(); state.pe = v; render(); },
  });
  const pcControl = rangeControl({
    label: symLabel('p_c', names.p_c || ''),
    min: 0, max: PC_VALUES.length - 1, step: 1, value: nearestIndex(PC_VALUES, state.pc, true),
    onInput: (i) => { stopTween(); state.pc = PC_VALUES[i]; render(); },
  });
  const perfectToggle = toggle(['Perfect gate ', h('span', { class: 'math', html: mathHTML('(p_c = 0)') })], state.perfect, (on) => {
    stopTween();
    state.perfect = on;
    render();
  });
  const deltaControl = rangeControl({
    label: symLabel('δ', names['δ'] || ''),
    min: 0, max: DELTA_VALUES.length - 1, step: 1, value: nearestIndex(DELTA_VALUES, state.delta, true),
    onInput: (i) => { stopTween(); state.delta = DELTA_VALUES[i]; render(); },
  });
  const kmaxControl = rangeControl({
    label: 'Chart horizon',
    min: 0, max: KMAX_VALUES.length - 1, step: 1, value: KMAX_VALUES.indexOf(state.kmax),
    onInput: (i) => { stopTween(); state.kmax = KMAX_VALUES[i]; state.k = Math.min(state.k, state.kmax); render(); },
  });
  const logToggle = toggle('Log scale for k', state.logX, (on) => { state.logX = on; render(); });
  const wmControl = rangeControl({
    label: [math('span', 'w_m', { class: 'math' })],
    min: 0, max: 1, step: 0.01, value: state.wm,
    onInput: (v) => { state.wm = v; render(); },
  });
  const dklControl = rangeControl({
    label: [h('span', { class: 'math', html: mathHTML('D_KL(P_true ‖ P_false)') })],
    min: 0, max: 5, step: 0.05, value: state.dkl,
    onInput: (v) => { state.dkl = v; render(); },
  });
  const resetBtn = $('[data-reset]', root)
    || h('button', { type: 'button', class: 'btn btn--ghost btn--sm c-contamination__reset' }, 'Reset to the worked example');
  resetBtn.addEventListener('click', reset);

  const controls = h('div', { class: 'c-contamination__controls' },
    h('fieldset', { class: 'c-contamination__group' },
      h('legend', { class: 'c-contamination__k' }, 'Gate'),
      h('div', { class: 'segmented c-contamination__presets', role: 'group', 'aria-label': 'Gate presets' }, presetButtons),
      peControl.wrap,
      pcControl.wrap,
      perfectToggle),
    h('fieldset', { class: 'c-contamination__group' },
      h('legend', { class: 'c-contamination__k' }, 'Tolerance and chart'),
      deltaControl.wrap,
      kmaxControl.wrap,
      logToggle),
    h('fieldset', { class: 'c-contamination__group' },
      h('legend', { class: 'c-contamination__k' }, 'Harm equation'),
      wmControl.wrap,
      dklControl.wrap,
      h('p', { class: 'c-contamination__hint', html: `Free parameters, both 1 by default, so that <span class="math">${mathHTML('E[MH(k)]')}</span> equals <span class="math">${mathHTML('P_cont(k)')}</span>.` })));

  const disclaimer = h('div', { class: 'c-contamination__bar' },
    h('p', { class: 'c-contamination__disclaimer' },
      `Calculator for ${data.id || 'the theorem'} (assumes ${data.assumption || 'step independence'}). Not a measurement.`),
    resetBtn);
  const lab = h('div', { class: 'c-contamination__lab' }, plot, controls);
  stats.before(disclaimer);
  stats.after(lab);

  /* --- values table: becomes live, with the reference gates --- */
  const values = $('[data-values]', root);
  if (values) values.open = false;
  const table = $('.c-contamination__table', root);
  const tableCaption = $('[data-values-caption]', root);
  const points = $$('[data-point]', root);

  /* ------------------------------------------------------------ model */

  function kList() { return kValues(state.kmax); }

  function model(pcOverride) {
    const pc = pcOverride ?? (state.perfect ? 0 : state.pc);
    const q = state.pe * pc;
    const kstar = horizon(q, state.delta);
    // Reference gates: ten times weaker (capped at p_c = 1, a gate that
    // accepts every error) and ten times stronger. With a perfect gate, show
    // the slider's imperfect p_c and a gate ten times stronger than that.
    const refs = pc > 0
      ? [
        { pc: Math.min(1, pc * 10), cls: 'ref--weaker', label: pc * 10 >= 1 ? 'Accepts every error' : 'Ten times weaker' },
        { pc: pc / 10, cls: 'ref--stronger', label: 'Ten times stronger' },
      ]
      : [
        { pc: state.pc, cls: 'ref--weaker', label: 'Imperfect gate' },
        { pc: state.pc / 10, cls: 'ref--stronger', label: 'Ten times stronger' },
      ];
    const visibleRefs = refs.filter((r) => Math.abs(r.pc - pc) > 1e-12).map((r) => ({ ...r, q: state.pe * r.pc }));
    return { pc, q, kstar, refs: visibleRefs, p: pcont(q, state.k) };
  }

  /* ----------------------------------------------------------- render */

  function render(pcOverride) {
    const m = model(pcOverride);
    renderReadouts(m);
    renderChartNow(m);
    if (pcOverride === undefined) {
      renderLegend(m);
      renderTable(m);
      syncControls(m);
      markCorollary(m);
      queueAnnounce(m);
    }
  }

  function renderReadouts(m) {
    const { q, kstar, p } = m;
    const k = state.k.toLocaleString('en-US');
    val('q').textContent = num(q, 3);
    how('q').innerHTML = eqHTML('q = p_e · p_c', `= ${num(state.pe)} · ${num(m.pc)}`);
    $('[data-k-label]', stats).textContent = k;
    val('p').textContent = pct(p);
    how('p').innerHTML = eqHTML(`P_cont(${state.k})`, `= 1 − (1 − ${num(q, 3)})^${state.k}`);
    $('[data-delta-label]', stats).textContent = `δ = ${num(state.delta)}`;
    val('kstar').innerHTML = `<span class="math">k*</span> = ${kstarText(kstar)}`;
    how('kstar').innerHTML = q > 0
      ? `${eqHTML(`ln(1 − ${num(state.delta)})`, `/ ln(1 − ${num(q, 3)})`)}: ${withinPhrase(kstar)}.`
      : `${eqHTML('q = 0')}: ${withinPhrase(kstar)}.`;
    const harm = state.wm * p * state.dkl;
    const p4 = p === 0 ? '0' : p.toLocaleString('en-US', { maximumSignificantDigits: 4 });
    $('[data-harm-k]', stats).textContent = k;
    val('harm').textContent = harm === 0 ? '0' : harm.toLocaleString('en-US', { maximumSignificantDigits: 4 });
    how('harm').innerHTML = eqHTML('w_m · P_cont · D_KL', `= ${num(state.wm)} · ${p4} · ${num(state.dkl)}`);
  }

  function renderChartNow(m) {
    const width = svg.parentElement.clientWidth || 600;
    geometry = renderChart(svg, {
      width,
      logX: state.logX,
      kmax: state.kmax,
      k: state.k,
      q: m.q,
      delta: state.delta,
      deltaText: num(state.delta),
      kstar: m.kstar,
      kstarText: kstarText(m.kstar),
      pText: pct(m.p),
      refs: m.refs,
    });
    svg.setAttribute('aria-label', chartLabel(m));
    xTitle.innerHTML = `<span class="math">k</span>, number of state updates${state.logX ? ' (log scale)' : ''}`;
  }

  function chartLabel(m) {
    const end = pcont(m.q, state.kmax);
    const head = `Line chart of P_cont(k) for k from 1 to ${state.kmax.toLocaleString('en-US')}${state.logX ? ' on a log scale' : ''}.`;
    if (m.q === 0) return `${head} With q = 0 the curve stays at 0%: the state is never contaminated.`;
    const horizonText = Number.isFinite(m.kstar) ? ` It stays within δ = ${num(state.delta)} up to k* = ${kstarText(m.kstar)}.` : '';
    return `${head} With q = ${num(m.q)}, contamination reaches ${pct(end)} by k = ${state.kmax.toLocaleString('en-US')}.${horizonText} The reference curves for other gates have the same shape, shifted along k.`;
  }

  function renderLegend(m) {
    const item = (cls, title, pc, q) => {
      const half = halfway(q);
      const note = Number.isFinite(half) ? `50% at k = ${half.toLocaleString('en-US')}` : 'never contaminated';
      return h('li', {},
        s('svg', { class: `c-contamination__swatch ${cls}`, viewBox: '0 0 28 10', 'aria-hidden': 'true', focusable: 'false' }, s('line', { x1: 1, x2: 27, y1: 5, y2: 5 })),
        h('span', { class: 'c-contamination__legend-name' }, title),
        h('span', { class: 'c-contamination__legend-meta', html: `${mathHTML(`p_c = ${num(pc)}`)} · ${note}` }));
    };
    legend.replaceChildren(
      item('curve', m.pc > 0 ? 'Your gate' : 'Perfect gate', m.pc, m.q),
      ...m.refs.map((r) => item(r.cls, r.label, r.pc, r.q)),
    );
  }

  function renderTable(m) {
    if (!table) return;
    const cols = [{ title: m.pc > 0 ? 'Your gate' : 'Perfect gate', pc: m.pc, q: m.q }, ...m.refs.map((r) => ({ title: r.label, pc: r.pc, q: r.q }))];
    const ks = [...new Set([...TABLE_KS.filter((k) => k <= state.kmax), state.kmax, state.k])].sort((a, b) => a - b);
    const head = h('tr', {}, h('th', { scope: 'col' }, 'Updates ', h('span', { class: 'math' }, 'k')),
      cols.map((c) => h('th', { scope: 'col', class: 'num' }, `${c.title} `, h('span', { class: 'math', html: mathHTML(`(p_c = ${num(c.pc)})`) }))));
    const rows = ks.map((k) => h('tr', { class: k === state.k ? 'is-current' : null },
      h('th', { scope: 'row', class: 'num' }, k.toLocaleString('en-US'), k === state.k ? h('span', { class: 'visually-hidden' }, ' (evaluated)') : null),
      cols.map((c) => h('td', { class: 'num' }, pct(pcont(c.q, k))))));
    $('thead', table).replaceChildren(head);
    $('tbody', table).replaceChildren(...rows);
    if (tableCaption) {
      tableCaption.innerHTML = `Current settings: <span class="math">${mathHTML(`p_e = ${num(state.pe)}`)}</span>. Illustrative values, not measurements.`;
    }
  }

  function syncControls(m) {
    peControl.input.value = String(state.pe);
    peControl.output.textContent = num(state.pe);
    peControl.input.setAttribute('aria-valuetext', num(state.pe));

    pcControl.input.value = String(nearestIndex(PC_VALUES, state.pc, true));
    pcControl.input.disabled = state.perfect;
    pcControl.wrap.classList.toggle('is-disabled', state.perfect);
    pcControl.output.textContent = state.perfect ? '0' : num(state.pc);
    pcControl.input.setAttribute('aria-valuetext', num(state.pc));
    perfectToggle.setAttribute('aria-pressed', String(state.perfect));

    deltaControl.input.value = String(nearestIndex(DELTA_VALUES, state.delta, true));
    deltaControl.output.textContent = num(state.delta);
    deltaControl.input.setAttribute('aria-valuetext', num(state.delta));

    kmaxControl.input.value = String(KMAX_VALUES.indexOf(state.kmax));
    kmaxControl.output.textContent = state.kmax.toLocaleString('en-US');
    kmaxControl.input.setAttribute('aria-valuetext', `${state.kmax.toLocaleString('en-US')} updates`);
    logToggle.setAttribute('aria-pressed', String(state.logX));

    const list = kList();
    kControl.input.max = String(list.length - 1);
    kControl.input.value = String(nearestIndex(list, state.k, true));
    kControl.output.textContent = state.k.toLocaleString('en-US');
    kControl.input.setAttribute('aria-valuetext', `k = ${state.k.toLocaleString('en-US')}`);

    wmControl.input.value = String(state.wm);
    wmControl.output.textContent = state.wm.toFixed(2);
    dklControl.input.value = String(state.dkl);
    dklControl.output.textContent = state.dkl.toFixed(2);

    for (const btn of presetButtons) {
      const p = PRESETS.find((x) => x.id === btn.dataset.preset);
      const active = p.pc === 0 ? state.perfect : !state.perfect && state.pc === p.pc;
      btn.setAttribute('aria-pressed', String(active));
    }
    root.classList.toggle('is-perfect', m.pc === 0);
  }

  function markCorollary(m) {
    for (const li of points) {
      const applies = (li.dataset.point === '1' && m.pc === 0) || (li.dataset.point === '2' && m.pc > 0 && state.pe > 0);
      li.classList.toggle('is-current', applies);
      const tag = $('.c-contamination__here', li);
      if (applies && !tag) li.append(h('span', { class: 'badge badge--accent badge--plain c-contamination__here' }, 'Your settings'));
      if (!applies && tag) tag.remove();
    }
  }

  function queueAnnounce(m) {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      const horizonText = Number.isFinite(m.kstar) ? `safe horizon k* = ${kstarText(m.kstar)}` : 'no contamination at any k';
      ctx.announce(`Contamination after ${state.k.toLocaleString('en-US')} updates: ${pct(m.p)}; ${horizonText}.`);
    }, 900);
  }

  /* ---------------------------------------------------------- actions */

  function stopTween() {
    if (tween) cancelAnimationFrame(tween);
    tween = 0;
  }

  function applyPreset(p) {
    stopTween();
    const from = model().pc;
    const to = p.pc;
    const finish = () => {
      tween = 0;
      if (to === 0) state.perfect = true;
      else { state.perfect = false; state.pc = to; }
      render();
    };
    if (ctx.reducedMotion || from === to) { finish(); return; }
    const t0 = performance.now();
    const duration = 450;
    const step = (now) => {
      const u = clamp((now - t0) / duration, 0, 1);
      const e = 1 - (1 - u) ** 3;
      const pc = from > 0 && to > 0 ? from * (to / from) ** e : from + (to - from) * e;
      if (u < 1) {
        render(pc);
        tween = requestAnimationFrame(step);
      } else finish();
    };
    tween = requestAnimationFrame(step);
  }

  function reset() {
    stopTween();
    Object.assign(state, START);
    render();
    ctx.announce('Reset to the worked example.');
  }

  /* -------------------------------------------- pointer scrubbing on k */

  function kFromPointer(event) {
    if (!geometry) return state.k;
    const rect = svg.getBoundingClientRect();
    const scale = rect.width ? Number(svg.getAttribute('width')) / rect.width : 1;
    const px = clamp((event.clientX - rect.left) * scale, geometry.x0, geometry.x1);
    return clamp(Math.round(geometry.invert(px)), 1, state.kmax);
  }
  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    stopTween();
    svg.setPointerCapture(event.pointerId);
    state.k = kFromPointer(event);
    render();
  });
  svg.addEventListener('pointermove', (event) => {
    if (!svg.hasPointerCapture(event.pointerId)) return;
    const k = kFromPointer(event);
    if (k !== state.k) { state.k = k; render(); }
  });

  /* ------------------------------------------------------------ layout */

  let lastWidth = 0;
  const ro = new ResizeObserver(() => {
    const w = svg.parentElement.clientWidth;
    if (Math.abs(w - lastWidth) >= 1) { lastWidth = w; renderChartNow(model()); }
  });
  ro.observe(svg.parentElement);

  render();
}
