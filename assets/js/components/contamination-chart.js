// Chart for the contamination calculator: P_cont(k) against the number of
// updates k, with the tolerance δ, the horizon k*, the evaluated k and two
// reference curves. The SVG is drawn at the container's pixel width, so text
// and strokes keep their size at every breakpoint.
import { s } from '../lib/dom.js';

/** P_cont(k) = 1 − (1 − q)^k, computed without cancellation for small q. */
export function pcont(q, k) {
  if (q <= 0 || k <= 0) return 0;
  return -Math.expm1(k * Math.log1p(-q));
}

/** Largest k with P_cont(k) ≤ δ: k* = ln(1 − δ) / ln(1 − q); ∞ when q = 0. */
export function horizon(q, delta) {
  if (q <= 0) return Infinity;
  return Math.log1p(-delta) / Math.log1p(-q);
}

/** Tick label: 1, 10, 100, 1k, 2.5k … */
export function compact(n) {
  return n >= 1000 ? `${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k` : n.toLocaleString('en-US');
}

const PAD = { top: 16, right: 18, bottom: 30, left: 44 };
const SAMPLES = 240;

function xScale(logX, kmax, x0, x1) {
  if (logX) {
    const span = Math.log10(kmax);
    return {
      min: 1,
      map: (k) => x0 + (Math.log10(Math.max(k, 1)) / span) * (x1 - x0),
      invert: (px) => 10 ** (((px - x0) / (x1 - x0)) * span),
    };
  }
  return {
    min: 0,
    map: (k) => x0 + (k / kmax) * (x1 - x0),
    invert: (px) => ((px - x0) / (x1 - x0)) * kmax,
  };
}

function xTicks(logX, kmax) {
  if (logX) {
    const major = [];
    for (let d = 1; d <= kmax; d *= 10) major.push(d);
    if (kmax / major[major.length - 1] >= 1.9) major.push(kmax);
    const minor = [];
    for (let d = 1; d < kmax; d *= 10) {
      for (let m = 2; m <= 9; m += 1) if (d * m < kmax && !major.includes(d * m)) minor.push(d * m);
    }
    return { major, minor };
  }
  const raw = kmax / 5;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * p).find((v) => v >= raw - 1e-9);
  const major = [];
  for (let v = 0; v <= kmax + 1e-9; v += step) major.push(Math.round(v));
  return { major, minor: [] };
}

/** Sample k values: even in log or linear space, plus the first integers. */
function samplePoints(logX, kmax) {
  const ks = new Set();
  for (let i = 0; i <= SAMPLES; i += 1) {
    ks.add(logX ? 10 ** ((i / SAMPLES) * Math.log10(kmax)) : (i / SAMPLES) * kmax);
  }
  if (!logX) for (let k = 1; k <= Math.min(kmax, 40); k += 1) ks.add(k);
  return [...ks].sort((a, b) => a - b);
}

function curvePath(q, ks, x, y) {
  let d = '';
  ks.forEach((k, i) => {
    d += `${i ? 'L' : 'M'}${x(k).toFixed(1)},${y(pcont(q, k)).toFixed(1)}`;
  });
  return d;
}

/**
 * Draw the chart into `svg` and return the geometry needed to map a pointer
 * position back to k.
 * m = { width, logX, kmax, k, q, delta, kstar, refs: [{ q, cls }] }
 */
export function renderChart(svg, m) {
  const width = Math.max(260, Math.round(m.width));
  const height = Math.round(Math.min(360, Math.max(230, width * 0.46)));
  const x0 = PAD.left;
  const x1 = width - PAD.right;
  const y0 = height - PAD.bottom;
  const y1 = PAD.top;
  const sx = xScale(m.logX, m.kmax, x0, x1);
  const x = (k) => sx.map(k);
  const y = (p) => y0 - p * (y0 - y1);
  const ks = samplePoints(m.logX, m.kmax);

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.replaceChildren();

  // Region where P_cont(k) ≤ δ (k ≤ k*).
  const bandEnd = Math.min(m.kstar, m.kmax);
  if (bandEnd >= sx.min && m.kstar > 0) {
    svg.append(s('rect', { class: 'band', x: x0, y: y1, width: Math.max(0, x(bandEnd) - x0), height: y0 - y1 }));
  }

  // Grid and axes.
  const grid = s('g', { class: 'grid' });
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    grid.append(s('line', { x1: x0, x2: x1, y1: y(p), y2: y(p) }));
    grid.append(s('text', { class: 'tick', x: x0 - 8, y: y(p), dy: '0.32em', 'text-anchor': 'end' }, `${p * 100}%`));
  }
  const ticks = xTicks(m.logX, m.kmax);
  for (const k of ticks.minor) grid.append(s('line', { class: 'minor', x1: x(k), x2: x(k), y1: y0, y2: y0 + 4 }));
  ticks.major.forEach((k, i) => {
    const anchor = i === 0 ? 'start' : i === ticks.major.length - 1 && x(k) > x1 - 16 ? 'end' : 'middle';
    grid.append(s('line', { class: 'major', x1: x(k), x2: x(k), y1: y0, y2: y0 + 6 }));
    grid.append(s('text', { class: 'tick', x: x(k), y: y0 + 19, 'text-anchor': anchor }, compact(k)));
  });
  grid.append(s('line', { class: 'axis', x1: x0, x2: x1, y1: y0, y2: y0 }));
  svg.append(grid);

  // Tolerance δ.
  const yd = y(m.delta);
  svg.append(s('line', { class: 'delta', x1: x0, x2: x1, y1: yd, y2: yd }));
  svg.append(s('text', { class: 'delta-label', x: x1, y: yd - 6, 'text-anchor': 'end' }, `δ = ${m.deltaText}`));

  // Reference curves, then the current gate on top.
  for (const ref of m.refs) {
    svg.append(s('path', { class: `ref ${ref.cls}`, d: curvePath(ref.q, ks, x, y) }));
  }
  svg.append(s('path', { class: 'curve', d: curvePath(m.q, ks, x, y) }));
  if (m.kmax <= 50) {
    const dots = s('g', { class: 'dots' });
    for (let k = 1; k <= m.kmax; k += 1) dots.append(s('circle', { cx: x(k), cy: y(pcont(m.q, k)), r: 2.25 }));
    svg.append(dots);
  }

  // Horizon k*: a full-height marker labelled at the top; the band to its
  // left is where P_cont(k) ≤ δ.
  const labelY = y1 + 13;
  if (Number.isFinite(m.kstar) && m.kstar >= sx.min && m.kstar <= m.kmax) {
    const xk = x(m.kstar);
    svg.append(s('line', { class: 'kstar', x1: xk, x2: xk, y1, y2: y0 }));
    svg.append(s('circle', { class: 'kstar-dot', cx: xk, cy: yd, r: 3.5 }));
    const right = xk + 8 + 76 < x1;
    svg.append(s('text', { class: 'kstar-label', x: right ? xk + 7 : xk - 7, y: labelY, 'text-anchor': right ? 'start' : 'end' }, `k* = ${m.kstarText}`));
    if (xk - x0 > 76 && right) svg.append(s('text', { class: 'band-label', x: xk - 7, y: labelY, 'text-anchor': 'end' }, 'within δ'));
  } else if (m.kstar > m.kmax) {
    svg.append(s('text', { class: 'kstar-label', x: x1 - 6, y: labelY, 'text-anchor': 'end' }, `within δ throughout · k* = ${m.kstarText}`));
  }

  // The evaluated k.
  const xe = x(Math.max(m.k, sx.min));
  const pe = pcont(m.q, m.k);
  const ye = y(pe);
  svg.append(s('line', { class: 'cursor', x1: xe, x2: xe, y1: y1, y2: y0 }));
  svg.append(s('circle', { class: 'cursor-dot', cx: xe, cy: ye, r: 5 }));
  const cursorRight = xe + 10 + 64 < x1;
  const cursorY = Math.min(Math.max(ye - 10, y1 + 30), y0 - 10);
  svg.append(s('text', { class: 'cursor-label', x: cursorRight ? xe + 10 : xe - 10, y: cursorY, 'text-anchor': cursorRight ? 'start' : 'end' }, m.pText));

  // Transparent hit area for pointer scrubbing.
  svg.append(s('rect', { class: 'hit', x: x0, y: y1, width: x1 - x0, height: y0 - y1 + PAD.bottom }));

  return { x0, x1, invert: sx.invert, min: sx.min };
}
