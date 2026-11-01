// AgentForge decision-ledger demo.
//
// A decision is made on fresh evidence and carried out weeks later; news
// keeps arriving in between. A router decides which news reaches the open
// decision before its revision deadline t_r, and the outcome is judged when
// the decision is carried out at t_a. Notation and routing rules follow
// "Fresh at Decision, Stale at Action"; the decision and the news are the
// fictional ones in site.data.demo.ledger.

import { h, s, $, $$, clamp, uid, roving } from '../lib/dom.js';
import { mathHTML } from '../lib/math.js';
import { mountCeiling, mountAccuracy } from './ledger-demo-theory.js';

const DAY_MS = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The three routers of the demo. `match` reads the item's routing signals;
// `timeFilter` drops matched items whose stated start falls after the activity.
const ROUTERS = [
  {
    id: 'none',
    label: 'No routing',
    reads: [],
    match: () => false,
    rule: 'Nothing reaches the decision once it is made: it is carried out as decided.',
  },
  {
    id: 'name',
    label: 'Name match',
    reads: ['names'],
    match: (n) => Boolean(n.names),
    why: (n) => (n.names ? 'mentions a name from the decision' : 'mentions no name from the decision'),
    rule: 'An item reaches the decision when it mentions a name the decision uses.',
  },
  {
    id: 'watch',
    label: 'Dossier + watch conditions',
    reads: ['dossier', 'watch', 'after_activity'],
    match: (n) => Boolean(n.dossier || n.watch),
    timeFilter: true,
    why: (n) => {
      if (n.dossier && n.watch) return 'matches the dossier and a watch condition';
      if (n.dossier) return 'matches the dossier';
      if (n.watch) return 'matches a watch condition';
      return 'matches neither the dossier nor a watch condition';
    },
    rule: 'An item reaches the decision when it matches the dossier or a watch condition; a time filter then drops items whose stated start falls after the activity ends.',
  },
];

const STATES = {
  delivered: { label: 'Delivered', tone: 'accent', tally: 'Delivered' },
  noise: { label: 'Noise · false positive', tone: 'warn', tally: 'Noise' },
  dropped: { label: 'Dropped · time filter', tone: 'muted', tally: 'Dropped' },
  missed: { label: 'Missed', tone: 'bad', tally: 'Missed' },
  late: { label: 'Too late', tone: 'muted', tally: 'Too late' },
  idle: { label: 'Not delivered', tone: 'muted', tally: 'Not delivered' },
};

/* ------------------------------------------------------------- dates */

function toDay(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function fmtDay(day, withYear = true) {
  const d = new Date(day * DAY_MS);
  const text = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return withYear ? `${text} ${d.getUTCFullYear()}` : text;
}

function monthStart(day, offset = 0) {
  const d = new Date(day * DAY_MS);
  return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1) / DAY_MS);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const joinIds = (ids) => (ids.length < 2 ? ids.join('') : `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`);

/* ------------------------------------------------------------- model */

function buildModel(ledger) {
  const decision = ledger.decision || {};
  const times = (decision.times || []).map((t) => ({ ...t, day: toDay(t.date) }));
  const T = Object.fromEntries(times.map((t) => [t.key, t]));
  const deadline = T.t_r ? T.t_r.day : Infinity;
  const news = (ledger.news || [])
    .map((n) => ({ ...n, day: toDay(n.date) }))
    .map((n) => ({ ...n, late: Boolean(n.late) || n.day > deadline }))
    .sort((a, b) => a.day - b.day);
  return { decision, times, T, news, switchTo: switchTarget(decision, news) };
}

// The option to switch to: an explicit `switch_to`, else the alternative the
// decisive item's note names ("switch to the second carrier"), else the last.
function switchTarget(decision, news) {
  if (decision.switch_to) return decision.switch_to;
  const alts = decision.alternatives || [];
  const note = (news.find((n) => n.decisive)?.effect || '').toLowerCase();
  return alts.find((a) => note.includes(a.split(',')[0].trim().toLowerCase())) || alts.at(-1) || '';
}

/* ----------------------------------------------------------- routing */

function classify(item, router) {
  const matched = router.match(item);
  if (item.late) return { matched, state: 'late' };
  if (matched && router.timeFilter && item.after_activity) return { matched, state: 'dropped' };
  if (matched) return { matched, state: item.decoy ? 'noise' : 'delivered' };
  return { matched, state: item.decisive ? 'missed' : 'idle' };
}

function evaluate(model, router) {
  const rows = model.news.map((item) => ({ item, ...classify(item, router) }));
  const hit = rows.find((r) => r.state === 'delivered' && r.item.decisive) || null;
  const shouldChange = model.news.some((n) => n.decisive);
  const switched = Boolean(hit);
  return {
    router,
    rows,
    hit,
    switched,
    right: switched === shouldChange,
    option: switched ? model.switchTo : model.decision.chosen,
  };
}

function explain(model, result, consequence) {
  const { router, hit } = result;
  const ta = model.T.t_a ? fmtDay(model.T.t_a.day, false) : 'action time';
  if (hit) {
    const lead = model.T.t_r ? model.T.t_r.day - hit.item.day : 0;
    const how = router.why ? ` ${router.why(hit.item)} and` : '';
    return `${hit.item.id}${how} reaches the decision ${plural(lead, 'day')} before the deadline, so the agent switches in time and avoids the ${consequence}.`;
  }
  if (result.right) return 'No news calls for a change, so keeping the decision is right.';
  const missed = result.rows.filter((r) => r.state === 'missed').map((r) => r.item);
  const carried = `on ${ta} it is carried out as made, on a ${consequence}`;
  if (!router.why || !missed.length) return `Nothing reaches the decision, so ${carried}.`;
  const verb = missed.length === 1 ? 'it' : 'them';
  return `${joinIds(missed.map((m) => m.id))} ${router.why(missed[0])}, so ${router.label.toLowerCase()} never delivers ${verb}: ${carried}.`;
}

/* ------------------------------------------------- timeline geometry */

const GAP = 6;
const monoWidth = (text, size) => text.length * size * 0.6;

// The first day of the main scale: anything before the largest gap in the
// dates, when that gap is longer than everything after it, is drawn in an
// off-scale column (t_w was written months before the rest happens).
function scaleStart(days) {
  const d = [...new Set(days)].sort((a, b) => a - b);
  let best = 0;
  let at = 0;
  for (let i = 1; i < d.length; i++) {
    if (d[i] - d[i - 1] > best) { best = d[i] - d[i - 1]; at = i; }
  }
  return at > 0 && best > d.at(-1) - d[at] ? d[at] : d[0];
}

function labelExtent(x, w, anchor, width) {
  if (anchor === 'start') return { a: x - 4, b: x - 4 + w };
  if (anchor === 'end') return { a: x + 4 - w, b: x + 4 };
  const a = clamp(x - w / 2, 2, width - 2 - w);
  return { a, b: a + w };
}

// A label fits if it stays inside the drawing, does not overlap a label in
// its own lane, and no leader line (which runs from lane 0 to its label)
// crosses another label. `clear` is how far a leader must pass from a label.
function fitsAmong(c, others, width, clear) {
  // A leader only has to clear the marker itself when entries have a `core`.
  const body = (q) => (q.core ? { a: q.x - q.core, b: q.x + q.core } : q);
  return c.a >= 1 && c.b <= width - 1 && others.every((p) => {
    if (p.lane === c.lane) return c.b + GAP <= p.a || c.a >= p.b + GAP;
    if (p.lane > c.lane) return p.x < body(c).a - clear || p.x > body(c).b + clear;
    return c.x < body(p).a - clear || c.x > body(p).b + clear;
  });
}

// Place labels (sorted by x) in lanes, preferring low lanes and centred
// anchors; a small depth-first search backs up when a choice blocks a later
// label, and falls back to centred labels in lane 0 if nothing fits.
function placeLabels(entries, width, { anchors = ['middle'], clear = 3, lanes = 4 } = {}) {
  const options = (e) => {
    const list = [];
    for (let lane = 0; lane < lanes; lane++) {
      for (const anchor of anchors) list.push({ ...e, lane, anchor, ...labelExtent(e.x, e.w, anchor, width) });
    }
    return list;
  };
  let budget = 4000;
  const search = (i, placed) => {
    if (i === entries.length) return placed;
    for (const c of options(entries[i])) {
      if (--budget < 0) return null;
      if (!fitsAmong(c, placed, width, clear)) continue;
      const done = search(i + 1, [...placed, c]);
      if (done) return done;
    }
    return null;
  };
  const found = search(0, []);
  if (found) return found;
  // Very narrow: let leaders graze neighbouring markers rather than overlap.
  if (clear > -2) return placeLabels(entries, width, { anchors, clear: -2, lanes });
  return entries.map((e) => ({ ...e, lane: 0, anchor: 'middle', ...labelExtent(e.x, e.w, 'middle', width) }));
}

function layout(model, width) {
  const narrow = width < 600;
  const g = { width, narrow, fs: narrow ? 10 : 11, r: narrow ? 5 : 6.5 };
  const days = [...model.times.map((t) => t.day), ...model.news.map((n) => n.day)];
  const start = scaleStart(days);
  const hasOff = model.times.some((t) => t.day < start);
  g.offW = hasOff ? (narrow ? 40 : 58) : 0;
  g.breakW = hasOff ? (narrow ? 12 : 16) : 0;
  const last = Math.max(...days);
  g.d0 = start - 3;
  g.d1 = monthStart(last, 1) - last <= 24 ? monthStart(last, 1) : last + 7;
  g.x0 = g.offW + g.breakW + (narrow ? 4 : 8);
  g.x1 = width - (narrow ? 28 : 44);
  const k = (g.x1 - g.x0) / (g.d1 - g.d0);
  g.X = (day) => (day >= start ? g.x0 + (day - g.d0) * k : g.offW / 2);
  g.inScale = (day) => day >= start;

  // News markers, in lanes above the decision bar (lane 0 is the lowest).
  const ids = model.news.map((n) => ({ id: n.id, x: g.X(n.day), w: Math.max(2 * g.r + 4, monoWidth(n.id, g.fs)), core: g.r + (n.decisive ? 1.5 : 0) }));
  g.news = placeLabels(ids, width, { clear: 1 });
  const newsLanes = Math.max(1, ...g.news.map((p) => p.lane + 1));
  g.laneH = g.r * 2 + g.fs + 12;
  g.monthY = 12;
  g.capY = 31;
  g.newsTop = 40;
  g.newsBottom = g.newsTop + newsLanes * g.laneH;
  g.barY = g.newsBottom + (narrow ? 20 : 24);
  g.barH = narrow ? 22 : 26;
  g.axisY = g.barY + g.barH + 16;

  // Timestamp labels under the axis (symbol over date); the ledger entry's
  // table gives their meaning.
  g.symSize = narrow ? 14 : 15;
  const stamps = model.times.map((t) => ({
    key: t.key,
    x: g.X(t.day),
    w: Math.max(g.symSize, monoWidth(fmtDay(t.day, false), g.fs)) + 4,
  }));
  g.stamps = placeLabels(stamps, width, { anchors: ['middle', 'start', 'end'] });
  const stampLanes = Math.max(1, ...g.stamps.map((p) => p.lane + 1));
  g.stampLaneH = 34;
  g.stampTop = (lane) => g.axisY + 10 + lane * g.stampLaneH;
  g.deltaTop = g.stampTop(stampLanes) + 4;
  g.height = g.deltaTop + 2 * 24 + 6;
  return g;
}

/* --------------------------------------------------- timeline drawing */

function svgMath(tag, text, attrs) {
  // SVG text with a real subscript: "t_r" -> t + baseline-shifted r.
  const [base, sub] = String(text).split('_');
  return s(tag, attrs, base, sub ? s('tspan', { class: 'c-ledger-demo__tl-sub', dy: '0.32em' }, sub) : null);
}

function drawTimeline(model, g, handlers) {
  const { T } = model;
  const hatch = uid('ld-hatch');
  const svg = s('svg', {
    class: 'c-ledger-demo__svg',
    width: g.width,
    height: g.height,
    viewBox: `0 0 ${g.width} ${g.height}`,
    role: 'img',
  });
  svg.append(s('defs', null,
    s('pattern', { id: hatch, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      s('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'c-ledger-demo__tl-hatch' }))));

  const xd = T.t_d ? g.X(T.t_d.day) : g.x0;
  const xr = T.t_r ? g.X(T.t_r.day) : null;
  const xa = T.t_a ? g.X(T.t_a.day) : g.x1;
  const xe = T.t_e ? g.X(T.t_e.day) : null;
  const zoneTop = g.capY - 13;

  // Zones: the activity window, and the stretch after the revision deadline.
  if (xe !== null) svg.append(s('rect', { class: 'c-ledger-demo__tl-activity', x: xa, y: zoneTop, width: xe - xa, height: g.axisY - zoneTop }));
  if (xr !== null) svg.append(s('rect', { class: 'c-ledger-demo__tl-late', x: xr, y: zoneTop, width: xa - xr, height: g.barY - 6 - zoneTop, fill: `url(#${hatch})` }));

  drawMonths(svg, g, model);
  drawCaptions(svg, g, { xd, xr, xa, xe });

  // Guides for the timestamps; the revision deadline is drawn heavier.
  for (const t of model.times) {
    const x = g.X(t.day);
    const top = t.key === 't_r' ? zoneTop - 2 : (g.inScale(t.day) ? zoneTop : g.barY - 8);
    svg.append(s('line', { class: `c-ledger-demo__tl-guide${t.key === 't_r' ? ' c-ledger-demo__tl-guide--deadline' : ''}`, x1: x, x2: x, y1: top, y2: g.axisY }));
  }

  drawAxis(svg, g);
  const bar = drawBar(svg, g, model, { xd, xa, xe });
  const markers = drawNews(svg, g, model, handlers);
  drawStamps(svg, g, model);
  drawDeltas(svg, g, model);
  return { svg, bar, markers };
}

function drawMonths(svg, g, model) {
  const first = monthStart(g.d0, 1);
  let prevYear = null;
  for (let m = first; m <= g.d1; m = monthStart(m, 1)) {
    const x = g.X(m);
    const d = new Date(m * DAY_MS);
    const year = d.getUTCFullYear();
    const label = `${MONTHS[d.getUTCMonth()]}${prevYear !== year ? ` ${year}` : ''}`.toUpperCase();
    prevYear = year;
    svg.append(s('line', { class: 'c-ledger-demo__tl-grid', x1: x, x2: x, y1: g.monthY + 5, y2: g.axisY }));
    const room = (m === g.d1 ? g.width - 2 : g.X(monthStart(m, 1))) - x - 6;
    const text = monoWidth(label, g.fs - 0.5) <= room ? label : MONTHS[d.getUTCMonth()].toUpperCase();
    if (monoWidth(text, g.fs - 0.5) <= room) svg.append(s('text', { class: 'c-ledger-demo__tl-month', x: x + 4, y: g.monthY }, text));
  }
  // Month of the off-scale timestamps, over their column.
  const off = model.times.filter((t) => !g.inScale(t.day));
  if (off.length) {
    const d = new Date(off[0].day * DAY_MS);
    const text = `${MONTHS[d.getUTCMonth()]}${g.narrow ? '' : ` ${d.getUTCFullYear()}`}`.toUpperCase();
    svg.append(s('text', { class: 'c-ledger-demo__tl-month', x: g.offW / 2, y: g.monthY, 'text-anchor': 'middle' }, text));
  }
}

function drawCaptions(svg, g, { xd, xr, xa, xe }) {
  const caption = (from, to, text, cls = '') => {
    if (from === null || to === null) return;
    if (monoWidth(text, g.fs - 1) + 10 > to - from) return;
    svg.append(s('text', { class: `c-ledger-demo__tl-caption ${cls}`, x: from + 5, y: g.capY }, text.toUpperCase()));
  };
  if (xr !== null) {
    caption(xd, xr, g.narrow ? 'Open' : 'Open for revision');
    caption(xr, xa, 'Too late', 'c-ledger-demo__tl-caption--late');
  }
  if (xe !== null) caption(xa, xe, 'Activity');
}

function drawAxis(svg, g) {
  const y = g.axisY;
  if (g.offW) {
    svg.append(s('line', { class: 'c-ledger-demo__tl-axis', x1: 4, x2: g.offW + 2, y1: y, y2: y }));
    // Axis break: two short slanted strokes between the columns.
    const bx = g.offW + g.breakW / 2 + 2;
    for (const dx of [-3, 3]) svg.append(s('line', { class: 'c-ledger-demo__tl-break', x1: bx + dx - 3, x2: bx + dx + 3, y1: y + 6, y2: y - 6 }));
  }
  svg.append(s('line', { class: 'c-ledger-demo__tl-axis', x1: g.x0 - 6, x2: g.width - 6, y1: y, y2: y }));
  svg.append(s('path', { class: 'c-ledger-demo__tl-axis-head', d: `M${g.width - 10},${y - 4} L${g.width - 4},${y} L${g.width - 10},${y + 4}` }));
}

function drawBar(svg, g, model, { xd, xa, xe }) {
  const { T, decision } = model;
  const y = g.barY;
  const mid = y + g.barH / 2;
  const hit = model.news.find((n) => n.decisive);
  const xs = hit ? g.X(hit.day) : null;

  // Evidence: written (t_w), verified (t_v), then decided (t_d).
  if (T.t_w && T.t_v) {
    svg.append(s('line', { class: 'c-ledger-demo__tl-evidence', x1: g.X(T.t_w.day), x2: g.X(T.t_v.day), y1: mid, y2: mid }));
    svg.append(s('circle', { class: 'c-ledger-demo__tl-evidence-dot', cx: g.X(T.t_w.day), cy: mid, r: 3 }));
  }
  if (T.t_v) {
    const xv = g.X(T.t_v.day);
    svg.append(s('line', { class: 'c-ledger-demo__tl-fresh', x1: xv, x2: xd, y1: mid, y2: mid }));
    svg.append(s('path', { class: 'c-ledger-demo__tl-verified', d: `M${xv},${mid - 4} L${xv + 4},${mid} L${xv},${mid + 4} L${xv - 4},${mid} Z` }));
  }

  const kept = s('rect', { class: 'c-ledger-demo__tl-bar', x: xd, y, width: Math.max(0, xa - xd), height: g.barH, rx: 4 });
  const switched = xs !== null
    ? s('rect', { class: 'c-ledger-demo__tl-bar c-ledger-demo__tl-bar--switched', x: xs, y, width: Math.max(0, xa - xs), height: g.barH, rx: 4 })
    : null;
  const labelY = mid + 4;
  const keptLabel = s('text', { class: 'c-ledger-demo__tl-bar-label', x: xd + 8, y: labelY }, decision.chosen || '');
  const switchLabel = xs !== null ? s('text', { class: 'c-ledger-demo__tl-bar-label c-ledger-demo__tl-bar-label--switched', x: xs + 8, y: labelY }, model.switchTo) : null;
  svg.append(kept, switched || '', keptLabel, switchLabel || '');

  // Verdict at action time, inside the activity window.
  const vx = xa + 11;
  const verdict = s('g', { class: 'c-ledger-demo__tl-verdict' },
    s('circle', { cx: vx, cy: mid, r: 8 }),
    s('path', { class: 'c-ledger-demo__tl-verdict-wrong', d: `M${vx - 3},${mid - 3} L${vx + 3},${mid + 3} M${vx + 3},${mid - 3} L${vx - 3},${mid + 3}` }),
    s('path', { class: 'c-ledger-demo__tl-verdict-right', d: `M${vx - 3.5},${mid + 0.5} L${vx - 1},${mid + 3} L${vx + 3.5},${mid - 2.5}` }));
  svg.append(verdict);
  const room = (xe !== null ? xe : g.width) - (vx + 12);
  const verdictText = s('text', { class: 'c-ledger-demo__tl-verdict-label', x: vx + 12, y: labelY }, '');
  svg.append(verdictText);
  return { kept, switched, keptLabel, switchLabel, verdict, verdictText, room, xd, xs, xa };
}

function drawNews(svg, g, model, { onEnter, onLeave, onPick }) {
  const markers = new Map();
  const bottom = g.newsBottom - 4;
  model.news.forEach((n, i) => {
    const p = g.news[i];
    const x = p.x;
    const cy = bottom - g.r - p.lane * g.laneH;
    const from = cy + g.r + 3;
    const to = g.barY - 7;
    const stub = from + (to - from) * 0.5;
    const shape = n.decisive
      ? s('path', { class: 'c-ledger-demo__tl-marker', d: `M${x},${cy - g.r - 1.5} L${x + g.r + 1.5},${cy} L${x},${cy + g.r + 1.5} L${x - g.r - 1.5},${cy} Z` })
      : s('circle', { class: 'c-ledger-demo__tl-marker', cx: x, cy, r: g.r });
    const group = s('g', {
      class: 'c-ledger-demo__tl-news',
      'data-id': n.id,
      onMouseenter: () => onEnter(n.id),
      onMouseleave: () => onLeave(n.id),
      onClick: () => onPick(n.id),
    },
    s('title', null, `${n.id} · ${fmtDay(n.day)} · ${n.text}`),
    s('line', { class: 'c-ledger-demo__tl-arrow', x1: x, x2: x, y1: from, y2: to }),
    s('path', { class: 'c-ledger-demo__tl-arrow-head', d: `M${x - 4},${to - 1} L${x + 4},${to - 1} L${x},${to + 5} Z` }),
    s('line', { class: 'c-ledger-demo__tl-stub', x1: x, x2: x, y1: from, y2: stub }),
    s('path', { class: 'c-ledger-demo__tl-cross', d: `M${x - 3.5},${stub - 0.5} L${x + 3.5},${stub + 6.5} M${x + 3.5},${stub - 0.5} L${x - 3.5},${stub + 6.5}` }),
    s('circle', { class: 'c-ledger-demo__tl-ring', cx: x, cy, r: g.r + 4.5 }),
    shape,
    s('text', { class: 'c-ledger-demo__tl-id', x, y: cy - g.r - 5, 'text-anchor': 'middle' }, n.id),
    s('circle', { class: 'c-ledger-demo__tl-hit', cx: x, cy: cy - 4, r: Math.max(12, g.r + 8) }));
    svg.append(group);
    markers.set(n.id, group);
  });
  return markers;
}

function drawStamps(svg, g, model) {
  for (const p of g.stamps) {
    const t = model.T[p.key];
    const top = g.stampTop(p.lane);
    const tx = p.anchor === 'middle' ? (p.a + p.b) / 2 : p.anchor === 'start' ? p.a + 4 : p.b - 4;
    const anchor = p.anchor === 'middle' ? 'middle' : p.anchor;
    const deadline = p.key === 't_r';
    svg.append(s('line', { class: 'c-ledger-demo__tl-leader', x1: p.x, x2: p.x, y1: g.axisY, y2: top + 1 }));
    const label = s('g', { class: `c-ledger-demo__tl-stamp${deadline ? ' is-deadline' : ''}`, 'text-anchor': anchor },
      s('title', null, `${t.label} · ${fmtDay(t.day)}`));
    label.append(svgMath('text', p.key, { class: 'c-ledger-demo__tl-sym', x: tx, y: top + g.symSize, 'font-size': g.symSize }));
    label.append(s('text', { class: 'c-ledger-demo__tl-date', x: tx, y: top + g.symSize + 14 }, fmtDay(t.day, false)));
    svg.append(label);
  }
}

// Dimension lines for the two gaps of Proposition 1.
function drawDeltas(svg, g, model) {
  const { t_v: tv, t_d: td, t_a: ta } = model.T;
  if (!tv || !td || !ta) return;
  const rows = [
    { from: td, to: ta, sym: 'Δ_act', y: g.deltaTop + 8 },
    { from: tv, to: td, sym: 'Δ_fresh', y: g.deltaTop + 32 },
  ];
  for (const r of rows) {
    const x1 = g.X(r.from.day);
    const x2 = g.X(r.to.day);
    const days = r.to.day - r.from.day;
    const [base, sub] = r.sym.split('_');
    const value = g.narrow ? ` ${days} d` : ` = ${plural(days, 'day')}`;
    svg.append(s('path', { class: 'c-ledger-demo__tl-dim', d: `M${x1},${r.y - 4} V${r.y + 4} M${x1},${r.y} H${x2} M${x2},${r.y - 4} V${r.y + 4}` }));
    const label = s('text', { class: 'c-ledger-demo__tl-dim-label', y: r.y + 4 },
      s('tspan', { class: 'c-ledger-demo__tl-dim-sym' }, base),
      s('tspan', { class: 'c-ledger-demo__tl-sub', dy: '0.32em' }, sub),
      s('tspan', { dy: '-0.32em' }, value));
    const width = monoWidth(`${base}${sub}${value}`, g.fs) + 10;
    // Centred on a wide span (over a gap in the line), else right of its end.
    if (x2 - x1 > width + 16) {
      svg.append(s('rect', { class: 'c-ledger-demo__tl-dim-bg', x: (x1 + x2) / 2 - width / 2, y: r.y - 8, width, height: 16, rx: 3 }));
      label.setAttribute('x', (x1 + x2) / 2);
      label.setAttribute('text-anchor', 'middle');
    } else {
      label.setAttribute('x', x2 + 8);
      label.setAttribute('text-anchor', 'start');
    }
    svg.append(label);
  }
}

/* ----------------------------------------------------- timeline state */

function fitLabel(text, room) {
  if (!text || !text.textContent) return false;
  let width = 0;
  try { width = text.getComputedTextLength(); } catch { width = text.textContent.length * 7; }
  return width > 0 && width <= room;
}

function applyTimeline(tl, result, consequence) {
  if (!tl) return;
  const { bar, markers, svg } = tl;
  for (const row of result.rows) markers.get(row.item.id)?.setAttribute('data-state', row.state);
  svg.dataset.switched = String(result.switched);
  svg.dataset.right = String(result.right);
  if (bar.switched) bar.switched.classList.toggle('is-on', result.switched);
  const keptRoom = (result.switched && bar.xs !== null ? bar.xs : bar.xa) - bar.xd - 14;
  bar.keptLabel.classList.toggle('is-hidden', !fitLabel(bar.keptLabel, keptRoom));
  if (bar.switchLabel) bar.switchLabel.classList.toggle('is-hidden', !result.switched || !fitLabel(bar.switchLabel, bar.xa - bar.xs - 14));
  bar.verdictText.textContent = result.right ? 'switched in time' : consequence.split(' by ')[0];
  bar.verdictText.classList.toggle('is-hidden', !fitLabel(bar.verdictText, bar.room));
}

function timelineLabel(model, result) {
  const T = model.T;
  const by = (state) => result.rows.filter((r) => r.state === state).map((r) => r.item.id);
  const parts = [];
  const delivered = by('delivered');
  if (delivered.length) parts.push(`${joinIds(delivered)} reach${delivered.length === 1 ? 'es' : ''} the decision`);
  if (by('noise').length) parts.push(`${joinIds(by('noise'))} as noise`);
  if (by('dropped').length) parts.push(`the time filter drops ${joinIds(by('dropped'))}`);
  if (by('missed').length) parts.push(`${joinIds(by('missed'))}, decisive, is missed`);
  if (by('late').length) parts.push(`${joinIds(by('late'))} arrives after the revision deadline`);
  const route = parts.length ? parts.join('; ') : 'nothing reaches the decision';
  const when = ['t_d', 't_r', 't_a'].filter((k) => T[k]).map((k) => `${T[k].label.toLowerCase()} ${fmtDay(T[k].day)}`).join(', ');
  return `Timeline: ${when}. ${result.router.label}: ${route}. The decision is ${result.switched ? `switched to ${result.option}` : `kept, ${result.option}`}, ${result.right ? 'right' : 'wrong'} at action time.`;
}

/* --------------------------------------------------------------- init */

export default function init(root, ctx) {
  const data = ctx.data(root, 'ledger-demo');
  if (!data || !data.ledger || !data.ledger.decision) return;
  const model = buildModel(data.ledger);
  const consequence = data.consequence || 'consequence at action time';
  const run = $('[data-ledger="run"]', root);
  const list = $('[data-ledger="news"]', root);
  if (!run || !list) return;

  const state = { router: ROUTERS[0], focus: null, result: null };
  const items = new Map($$('.c-ledger-demo__item', list).map((li) => [li.dataset.id, li]));
  const hit = model.news.find((n) => n.decisive);

  /* Router and outcome */
  const routerHead = uid('ld-router');
  const buttons = ROUTERS.map((r) => h('button', {
    type: 'button',
    'aria-pressed': String(r === state.router),
    'data-router': r.id,
    onClick: () => select(r),
  }, r.label));
  roving(buttons, { onSelect: (i) => select(ROUTERS[i]) });
  const rule = h('p', { class: 'c-ledger-demo__rule' });
  const verb = h('span', { class: 'c-ledger-demo__verb' });
  const option = h('strong', { class: 'c-ledger-demo__option' });
  const chip = h('span', { class: 'c-ledger-demo__chip' });
  const sentence = h('p', { class: 'c-ledger-demo__explain' });
  const tally = h('ul', { class: 'c-ledger-demo__tally list-plain', 'aria-label': 'Where each item went' });
  const outcome = h('section', { class: 'c-ledger-demo__outcome', 'aria-label': 'Outcome at the revision deadline' },
    h('p', { class: 'c-ledger-demo__kicker', html: `Outcome at <span class="math">${mathHTML('t_r')}</span> · ${model.T.t_r ? fmtDay(model.T.t_r.day) : ''}` }),
    h('p', { class: 'c-ledger-demo__verdict' }, h('span', { class: 'c-ledger-demo__verdict-what' }, verb, ' ', option), chip),
    sentence,
    tally);

  const router = h('div', { class: 'c-ledger-demo__router' },
    h('p', { class: 'c-ledger-demo__kicker', id: routerHead }, 'Route incoming news by'),
    h('div', { class: 'segmented c-ledger-demo__seg', role: 'group', 'aria-labelledby': routerHead }, buttons),
    rule,
    hit ? h('p', { class: 'c-ledger-demo__hint', html: `Which router delivers ${hit.id}, the decisive item, before <span class="math">${mathHTML('t_r')}</span>?` }) : null);

  /* Timeline */
  const frame = h('div', { class: 'c-ledger-demo__tl-frame' });
  const timeline = h('div', { class: 'c-ledger-demo__timeline' }, frame, legend());
  run.append(h('div', { class: 'c-ledger-demo__console' }, router, outcome), timeline);
  let tl = null;
  let drawnWidth = 0;

  const handlers = {
    onEnter: (id) => setFocus(id),
    onLeave: () => setFocus(document.activeElement?.closest?.('.c-ledger-demo__item')?.dataset.id || null),
    onPick: (id) => {
      const li = items.get(id);
      if (!li) return;
      li.focus({ preventScroll: true });
      li.scrollIntoView({ block: 'nearest', behavior: ctx.reducedMotion ? 'auto' : 'smooth' });
    },
  };

  function draw() {
    const width = Math.floor(frame.clientWidth);
    if (!width || width === drawnWidth) return;
    drawnWidth = width;
    tl = drawTimeline(model, layout(model, width), handlers);
    frame.replaceChildren(tl.svg);
    if (state.result) paintTimeline();
    setFocus(state.focus);
  }

  function paintTimeline() {
    applyTimeline(tl, state.result, consequence);
    if (tl) tl.svg.setAttribute('aria-label', timelineLabel(model, state.result));
  }

  /* News list */
  for (const [id, li] of items) {
    li.tabIndex = 0;
    const badge = h('span', { class: 'badge c-ledger-demo__state' });
    li.querySelector('.c-ledger-demo__item-meta')?.after(badge);
    li.addEventListener('focus', () => setFocus(id));
    li.addEventListener('blur', () => setFocus(null));
    li.addEventListener('mouseenter', () => setFocus(id));
    li.addEventListener('mouseleave', () => setFocus(document.activeElement === li ? id : null));
  }
  root.classList.add('is-enhanced');

  function setFocus(id) {
    state.focus = id;
    for (const [key, li] of items) li.classList.toggle('is-focus', key === id);
    if (tl) for (const [key, g] of tl.markers) g.classList.toggle('is-focus', key === id);
  }

  function paintList(result) {
    for (const row of result.rows) {
      const li = items.get(row.item.id);
      if (!li) continue;
      const st = STATES[row.state];
      li.dataset.state = row.state;
      const badge = $('.c-ledger-demo__state', li);
      badge.className = `badge badge--${st.tone} c-ledger-demo__state`;
      badge.textContent = st.label;
      for (const sig of $$('[data-signal]', li)) sig.dataset.read = String(result.router.reads.includes(sig.dataset.signal) || sig.dataset.signal === 'late');
    }
  }

  function paintOutcome(result) {
    verb.textContent = result.switched ? 'Switched to:' : 'Kept:';
    option.textContent = result.option;
    chip.textContent = result.right ? 'Right' : 'Wrong';
    chip.dataset.verdict = result.right ? 'right' : 'wrong';
    outcome.dataset.verdict = chip.dataset.verdict;
    sentence.textContent = explain(model, result, consequence);
    tally.replaceChildren(...Object.keys(STATES).map((key) => {
      const ids = result.rows.filter((r) => r.state === key).map((r) => r.item.id);
      if (!ids.length) return null;
      return h('li', { 'data-state': key }, h('span', { class: 'c-ledger-demo__tally-k' }, STATES[key].tally), ' ', ids.join(' · '));
    }).filter(Boolean));
  }

  function select(next, announce = true) {
    state.router = next;
    state.result = evaluate(model, next);
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.router === next.id));
    rule.textContent = next.rule;
    paintOutcome(state.result);
    paintList(state.result);
    paintTimeline();
    root.dataset.router = next.id;
    if (announce) {
      const r = state.result;
      ctx.announce(`${next.label}: ${r.switched ? 'switched to' : 'kept'} ${r.option}. ${r.right ? 'Right' : 'Wrong'} at action time.`);
    }
  }

  select(state.router, false);
  draw();
  if ('ResizeObserver' in window) {
    let frameReq = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(frameReq);
      frameReq = requestAnimationFrame(draw);
    }).observe(frame);
  }
  // Labels are fitted with measured widths: measure again once fonts load.
  document.fonts?.ready.then(() => { if (state.result) paintTimeline(); });

  /* Theory widgets */
  const ceiling = $('[data-ledger="ceiling"]', root);
  if (ceiling) mountCeiling(ceiling, { dFresh: Number(ceiling.dataset.dFresh), dAct: Number(ceiling.dataset.dAct), ctx });
  const accuracy = $('[data-ledger="accuracy"]', root);
  if (accuracy) mountAccuracy(accuracy, { ctx });
}

function legend() {
  const glyph = (cls, d, extra = null) => s('svg', { class: `c-ledger-demo__lg-glyph ${cls}`, viewBox: '0 0 22 14', width: 22, height: 14, 'aria-hidden': 'true' },
    s('path', { d }), extra);
  const items = [
    [glyph('is-delivered', 'M11 1 V10 M7.5 7.5 L11 12 L14.5 7.5'), 'delivered'],
    [glyph('is-noise', 'M11 1 V10 M7.5 7.5 L11 12 L14.5 7.5'), 'noise (false positive)'],
    [glyph('is-dropped', 'M11 1 V5 M8 6 L14 12 M14 6 L8 12'), 'dropped by the time filter'],
    [glyph('is-decisive', 'M11 2 L16 7 L11 12 L6 7 Z'), 'decisive item'],
    [glyph('is-late', 'M2 13 L13 2 M8 13 L19 2 M14 13 L22 5'), h('span', { html: `after <span class="math">${mathHTML('t_r')}</span>: too late` })],
    [glyph('is-activity', 'M1 1 H21 V13 H1 Z'), 'activity window'],
  ];
  return h('ul', { class: 'c-ledger-demo__legend list-plain', 'aria-hidden': 'true' },
    items.map(([g, text]) => h('li', null, g, text)));
}
