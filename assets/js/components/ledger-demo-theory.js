// Two calculators for the decision-ledger demo, both from "Fresh at
// Decision, Stale at Action": the freshness ceiling of Proposition 1, and the
// accuracy factorisation. Their inputs are hypothetical, except the default
// decision-to-action gap, which comes from the demo's own timestamps.

import { h, s, uid } from '../lib/dom.js';
import { mathHTML } from '../lib/math.js';

const DAYS_PER_MONTH = 365.25 / 12; // the average month, 30.44 days
const toMonths = (days) => days / DAYS_PER_MONTH;
const pct = (p) => `${Math.round(p * 100)}%`;

/** A labelled range input with its value shown in an <output>. */
function slider({ label, min, max, step, value, format, spoken }) {
  const id = uid('ld-range');
  const input = h('input', { type: 'range', id, min, max, step, value });
  // The slider speaks its own value; the visible readout need not repeat it.
  const out = h('output', { for: id, 'aria-live': 'off' });
  const wrap = h('div', { class: 'range c-ledger-demo__range' },
    h('div', { class: 'range__head' }, h('label', { for: id, html: label }), out),
    input);
  const sync = () => {
    const v = Number(input.value);
    out.textContent = format(v);
    input.setAttribute('aria-valuetext', spoken(v));
  };
  sync();
  return {
    wrap,
    input,
    get value() { return Number(input.value); },
    set(v) { input.value = String(v); sync(); },
    sync,
  };
}

/** Redraw `draw` whenever the host's width changes. */
function onWidth(host, draw) {
  let width = 0;
  let req = 0;
  const run = () => {
    const w = Math.floor(host.clientWidth);
    if (w && w !== width) { width = w; draw(w); }
  };
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => { cancelAnimationFrame(req); req = requestAnimationFrame(run); }).observe(host);
  }
  return { redraw: () => { width = 0; run(); } };
}

/* ------------------------------------------------ Proposition 1 widget */

export function mountCeiling(el, { dFresh, dAct }) {
  const dataGap = Number.isFinite(dAct) ? dAct : 0;
  const fresh = Number.isFinite(dFresh) ? dFresh : 0;
  const maxDays = Math.max(180, Math.ceil((dataGap + 60) / 30) * 30);

  const rate = slider({
    label: `Change rate <span class="math">${mathHTML('λ_f')}</span> <span class="c-ledger-demo__hyp">hypothetical</span>`,
    min: 0, max: 2, step: 0.05, value: 0.5,
    format: (v) => `${v.toFixed(2)} / month`,
    spoken: (v) => `${v.toFixed(2)} expected changes per month`,
  });
  const gap = slider({
    label: `Gap from decision to action <span class="math">${mathHTML('Δ_act')}</span>`,
    min: 0, max: maxDays, step: 1, value: dataGap,
    format: (v) => `${v} days ≈ ${toMonths(v).toFixed(2)} months`,
    spoken: (v) => `${v} days, ${toMonths(v).toFixed(2)} months`,
  });
  const back = h('button', {
    type: 'button',
    class: 'btn btn--ghost btn--sm c-ledger-demo__back',
    hidden: true,
    onClick: () => { gap.set(dataGap); update(); gap.input.focus(); },
  }, `Back to this decision, ${dataGap} days`);

  const big = h('output', { class: 'c-ledger-demo__big' });
  const work = h('p', { class: 'c-ledger-demo__work' });
  const note = h('p', { class: 'c-ledger-demo__work c-ledger-demo__work--muted' });
  const chart = h('div', { class: 'c-ledger-demo__chart' });

  el.append(
    h('div', { class: 'c-ledger-demo__sliders' }, rate.wrap, gap.wrap, back),
    h('div', { class: 'c-ledger-demo__result' },
      big,
      h('p', { class: 'c-ledger-demo__result-text', html: `the most the evidence can still hold at ${mathHTML('t_a')}, however fresh it was when the decision was made` })),
    work,
    note,
    chart);

  const plot = onWidth(chart, (w) => drawCeiling(chart, w, { lambda: rate.value, gap: gap.value, dataGap, maxDays }));

  function update() {
    const lambda = rate.value;
    const g = gap.value;
    const ceiling = Math.exp(-lambda * toMonths(g));
    const actual = Math.exp(-lambda * toMonths(g + fresh));
    big.textContent = `≤ ${pct(ceiling)}`;
    work.innerHTML = `<i>e</i><sup>−λ<sub>f</sub>Δ<sub>act</sub></sup> = <i>e</i><sup>−${lambda.toFixed(2)} × ${toMonths(g).toFixed(2)}</sup> = ${ceiling.toFixed(3)}`;
    note.innerHTML = `Counting this decision’s ${mathHTML('Δ_fresh')} = ${fresh} days as well: <i>e</i><sup>−λ<sub>f</sub>(Δ<sub>fresh</sub> + Δ<sub>act</sub>)</sup> = ${actual.toFixed(3)}.`;
    back.hidden = g === dataGap;
    plot.redraw();
  }

  rate.input.addEventListener('input', () => { rate.sync(); update(); });
  gap.input.addEventListener('input', () => { gap.sync(); update(); });
  update();
}

function drawCeiling(host, W, { lambda, gap, dataGap, maxDays }) {
  const H = W < 380 ? 136 : 156;
  const m = { l: 38, r: 14, t: 10, b: 28 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const X = (d) => m.l + (d / maxDays) * iw;
  const Y = (p) => m.t + (1 - p) * ih;
  const P = (d) => Math.exp(-lambda * toMonths(d));
  const hatch = uid('ld-ceil');

  const pts = [];
  for (let i = 0; i <= 72; i++) {
    const d = (i / 72) * maxDays;
    pts.push(`${X(d).toFixed(1)},${Y(P(d)).toFixed(1)}`);
  }
  const curve = `M${pts.join(' L')}`;
  const above = `${curve} L${X(maxDays)},${Y(1)} L${X(0)},${Y(1)} Z`;
  const p = P(gap);

  const svg = s('svg', {
    class: 'c-ledger-demo__chart-svg',
    width: W, height: H, viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': `Ceiling e to the minus lambda times the gap, for lambda ${lambda.toFixed(2)} per month: at ${gap} days the evidence holds with probability at most ${pct(p)}. The shaded region above the curve is out of reach at any freshness.`,
  },
  s('defs', null,
    s('pattern', { id: hatch, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      s('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'c-ledger-demo__tl-hatch' }))));

  svg.append(s('path', { class: 'c-ledger-demo__ceil-out', d: above, fill: `url(#${hatch})` }));
  for (const v of [0, 0.5, 1]) {
    svg.append(s('line', { class: 'c-ledger-demo__ceil-grid', x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }));
    svg.append(s('text', { class: 'c-ledger-demo__ceil-tick', x: m.l - 6, y: Y(v) + 3.5, 'text-anchor': 'end' }, pct(v)));
  }
  const step = W < 480 ? 60 : 30;
  for (let d = 0; d <= maxDays; d += step) {
    svg.append(s('line', { class: 'c-ledger-demo__ceil-grid', x1: X(d), x2: X(d), y1: Y(0), y2: Y(0) + 4 }));
    svg.append(s('text', { class: 'c-ledger-demo__ceil-tick', x: X(d), y: H - 10, 'text-anchor': d === maxDays ? 'end' : 'middle' }, d === maxDays ? `${d} days` : String(d)));
  }
  if (P(maxDays) < 0.75) {
    svg.append(s('text', { class: 'c-ledger-demo__ceil-note', x: W - m.r - 6, y: Y(1) + 14, 'text-anchor': 'end' }, 'out of reach, however fresh'));
  }
  svg.append(s('path', { class: 'c-ledger-demo__ceil-curve', d: curve }));

  // This decision's gap, as a reference tick on the axis.
  svg.append(s('line', { class: 'c-ledger-demo__ceil-ref', x1: X(dataGap), x2: X(dataGap), y1: Y(0), y2: Y(P(dataGap)) }));
  // The current reading.
  const px = X(gap);
  const py = Y(p);
  svg.append(s('line', { class: 'c-ledger-demo__ceil-drop', x1: px, x2: px, y1: py, y2: Y(0) }));
  svg.append(s('circle', { class: 'c-ledger-demo__ceil-dot', cx: px, cy: py, r: 4.5 }));
  const right = px < m.l + iw * 0.72;
  svg.append(s('text', {
    class: 'c-ledger-demo__ceil-value',
    x: px + (right ? 8 : -8),
    y: Math.max(py - 8, m.t + 10),
    'text-anchor': right ? 'start' : 'end',
  }, `≤ ${pct(p)}`));
  host.replaceChildren(svg);
}

/* ----------------------------------------- Accuracy factorisation widget */

const SEGMENTS = [
  { key: 'keep', right: true, label: 'should stand, kept', size: (v) => (1 - v.pi) * v.K },
  { key: 'flip', right: false, label: 'should stand, switched', size: (v) => (1 - v.pi) * (1 - v.K) },
  { key: 'hit', right: true, label: 'delivered, switched', size: (v) => v.pi * v.rho * v.S },
  { key: 'ignored', right: false, label: 'delivered, kept', size: (v) => v.pi * v.rho * (1 - v.S) },
  { key: 'luck', right: true, label: 'not delivered, switched', size: (v) => v.pi * (1 - v.rho) * v.L },
  { key: 'miss', right: false, label: 'not delivered, kept: a routing miss', size: (v) => v.pi * (1 - v.rho) * (1 - v.L) },
];

export function mountAccuracy(el) {
  const make = (label, value) => slider({
    label, min: 0, max: 1, step: 0.05, value,
    format: pct,
    spoken: (v) => `${Math.round(v * 100)} percent`,
  });
  const sl = {
    pi: make('Decisions that should change, <i>π</i>', 0.3),
    rho: make('Routing recall, <i>ρ</i>', 0.5),
    S: make('<i>S</i> · delivered', 1),
    L: make('<i>L</i> · not delivered', 0),
    K: make('<i>K</i> · should stand', 1),
  };

  const bar = h('div', { class: 'c-ledger-demo__mosaic-bar', role: 'img' });
  const segs = SEGMENTS.map((seg) => {
    const el2 = h('span', { class: 'c-ledger-demo__mosaic-seg', 'data-seg': seg.key, 'data-right': String(seg.right), title: seg.label });
    bar.append(el2);
    return el2;
  });
  const groupStand = h('span', { 'data-group': 'stand' }, 'should stand');
  const groupChange = h('span', { 'data-group': 'change' }, 'should change');
  const subPad = h('span');
  const subDelivered = h('span', { 'data-group': 'delivered', html: '<i>ρ</i> delivered', title: 'delivered in time (ρ)' });
  const subMissed = h('span', { 'data-group': 'missed', html: '1 − <i>ρ</i> missed', title: 'not delivered (1 − ρ)' });
  const big = h('output', { class: 'c-ledger-demo__big' });
  const work = h('p', { class: 'c-ledger-demo__work' });
  const loss = h('p', { class: 'c-ledger-demo__work c-ledger-demo__work--muted' });

  el.append(
    h('div', { class: 'c-ledger-demo__sliders' }, sl.pi.wrap, sl.rho.wrap,
      h('div', { class: 'c-ledger-demo__sliders-row' }, sl.S.wrap, sl.L.wrap, sl.K.wrap)),
    h('div', { class: 'c-ledger-demo__mosaic' },
      h('div', { class: 'c-ledger-demo__mosaic-groups', 'aria-hidden': 'true' }, groupStand, groupChange),
      bar,
      h('div', { class: 'c-ledger-demo__mosaic-groups c-ledger-demo__mosaic-groups--sub', 'aria-hidden': 'true' }, subPad, subDelivered, subMissed),
      h('ul', { class: 'c-ledger-demo__mosaic-key list-plain', 'aria-hidden': 'true' },
        h('li', { 'data-right': 'true' }, 'right'),
        h('li', { 'data-right': 'false' }, 'wrong'))),
    h('div', { class: 'c-ledger-demo__result' },
      big,
      h('p', { class: 'c-ledger-demo__result-text', html: 'of decisions are right at action time: the solid part of the bar' })),
    work,
    loss,
    h('p', { class: 'c-ledger-demo__panel-note' }, 'In the paper’s controlled streams, models switched once decisive news arrived, so accuracy followed routing. Drag ρ to see why.'));

  function update() {
    const v = Object.fromEntries(Object.entries(sl).map(([k, x]) => [k, x.value]));
    const sizes = SEGMENTS.map((seg) => seg.size(v));
    const A = sizes.reduce((sum, x, i) => sum + (SEGMENTS[i].right ? x : 0), 0);
    sizes.forEach((x, i) => { segs[i].style.flexBasis = `${(x * 100).toFixed(2)}%`; });
    groupStand.style.flexBasis = `${((1 - v.pi) * 100).toFixed(2)}%`;
    groupChange.style.flexBasis = `${(v.pi * 100).toFixed(2)}%`;
    subPad.style.flexBasis = `${((1 - v.pi) * 100).toFixed(2)}%`;
    subDelivered.style.flexBasis = `${(v.pi * v.rho * 100).toFixed(2)}%`;
    subMissed.style.flexBasis = `${(v.pi * (1 - v.rho) * 100).toFixed(2)}%`;
    big.textContent = pct(A);
    const [keep, , hit, , luck, miss] = sizes;
    work.innerHTML = `<i>A</i> = ${keep.toFixed(2)} + ${hit.toFixed(2)} + ${luck.toFixed(2)} = ${A.toFixed(2)}`;
    loss.innerHTML = `Routing misses, <i>π</i>(1 − <i>ρ</i>)(1 − <i>L</i>), cost ${(miss * 100).toFixed(0)} points of accuracy.`;
    bar.setAttribute('aria-label', `Accuracy ${pct(A)}. Wrong: ${pct(1 - A)}, of which routing misses ${pct(miss)}.`);
  }

  for (const x of Object.values(sl)) x.input.addEventListener('input', () => { x.sync(); update(); });
  update();
}
