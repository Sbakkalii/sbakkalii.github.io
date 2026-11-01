// Research trajectory. From 760 px: a swimlane chart (x = time, one lane per
// theme, one dot per publication in each of its themes' lanes, career
// milestones as dashed rules) with a detail card. Below 760 px, or on
// request, the year list rendered by the include. Theme chips emphasise
// lanes in the chart and filter the list.
import { h, $, $$, mount, clamp } from '../lib/dom.js';

const NARROW = '(max-width: 759px)';
const CLEAR = 2;                         // clearance between dots (px)
const RADIUS = { featured: 6.5, other: 4.5 };  // as drawn in timeline.css
const LANE_MIN = 40;                     // lane height (px)
const MS_ROW = 20;                       // milestone label row (px), as --tl-ms-row
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function init(root, ctx) {
  const data = ctx.data(root, 'timeline');
  if (!data || !Array.isArray(data.pubs) || !data.pubs.length) return;
  const list = $('.c-timeline__list', root);
  const body = $('.c-timeline__body', root) || root;

  const pubs = data.pubs.map((p, i) => ({ ...p, i, themes: p.themes || [], year: Number(p.date.slice(0, 4)), t: yearFraction(p.date) }));
  const themes = (data.themes || []).filter((th) => pubs.some((p) => p.themes.includes(th.id)));
  const themeById = new Map(themes.map((th) => [th.id, th]));
  const milestones = (data.milestones || [])
    .filter((m) => /^\d{4}-\d{2}$/.test(m.date))
    .map((m) => ({ ...m, t: yearFraction(`${m.date}-01`) }));
  const allYears = [...pubs.map((p) => p.year), ...milestones.map((m) => Math.floor(m.t))];
  const y0 = Math.min(...allYears);
  const y1 = Math.max(...allYears) + 1;
  const pct = (t) => ((t - y0) / (y1 - y0)) * 100;

  const narrowQuery = window.matchMedia(NARROW);
  const state = {
    selected: defaultSelection(pubs, data.selected),
    emphasis: new Set(),
    view: 'timeline',
    featuredOnly: narrowQuery.matches,
  };

  /* ------------------------------------------------------------ toolbar */
  const chipButtons = themes.map((th) => h('button', {
    type: 'button',
    class: 'chip',
    'aria-pressed': 'false',
    title: th.label,
    dataset: { theme: th.id },
    onClick: () => toggleTheme(th.id),
  }, th.short || th.label, h('span', { class: 'chip__count' }, String(countTheme(th.id)), h('span', { class: 'visually-hidden' }, ' publications'))));
  const clearButton = h('button', { type: 'button', class: 'btn btn--ghost btn--sm c-timeline__clear', hidden: true, onClick: clearThemes }, 'Clear');
  const featuredChip = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.featuredOnly), onClick: toggleFeatured }, 'Featured only');
  const viewButtons = [['timeline', 'Timeline'], ['list', 'List']].map(([id, label]) => h('button', {
    type: 'button',
    'aria-pressed': String(state.view === id),
    dataset: { view: id },
    onClick: () => setView(id),
  }, label));
  const viewSwitch = h('div', { class: 'segmented c-timeline__views', role: 'group', 'aria-label': 'Show as' }, viewButtons);
  const chipsLabel = h('span', { class: 'c-timeline__chips-label', id: `${root.id || 'timeline'}-themes` }, 'Themes');
  const toolbar = h('div', { class: 'c-timeline__toolbar' },
    h('div', { class: 'c-timeline__chips', role: 'group', 'aria-labelledby': chipsLabel.id }, chipsLabel, chipButtons, clearButton),
    h('div', { class: 'c-timeline__tools' }, featuredChip, viewSwitch));

  /* -------------------------------------------------------------- chart */
  const msRow = h('div', { class: 'c-timeline__milestones', role: 'list', 'aria-label': 'Career milestones' });
  const msItems = milestones.map((m) => {
    const el = h('p', { class: 'c-timeline__ms', role: 'listitem', title: `${monthYear(m.date)} · ${m.detail}` },
      h('span', { class: 'visually-hidden' }, `${monthYear(m.date)}: `), m.label);
    msRow.append(el);
    return { m, el, row: 0 };
  });

  const lanesEl = h('div', {
    class: 'c-timeline__lanes',
    role: 'group',
    'aria-label': `Publications by theme, ${y0} to ${y1 - 1}. Arrow keys move between publications: left and right in time, up and down between themes.`,
  });
  const dots = [];
  const lanes = themes.map((th) => {
    const lanePubs = pubs.filter((p) => p.themes.includes(th.id));
    const track = h('div', { class: 'c-timeline__track' });
    const el = h('div', { class: 'c-timeline__lane', role: 'group', 'aria-label': `${th.label}: ${count(lanePubs.length, 'publication')}`, dataset: { theme: th.id } },
      h('div', { class: 'c-timeline__lane-label', 'aria-hidden': 'true' },
        h('span', { class: 'c-timeline__lane-name' }, th.label),
        h('span', { class: 'c-timeline__lane-count' }, String(lanePubs.length))),
      track);
    const lane = { theme: th, el, track, dots: [] };
    lane.dots = lanePubs.map((pub, k) => {
      const dot = { pub, lane, k, off: 0, btn: null };
      dot.btn = h('button', {
        type: 'button',
        class: ['c-timeline__dot', pub.featured && 'is-featured'],
        tabindex: '-1',
        'aria-pressed': 'false',
        'aria-label': `${pub.title}. ${pub.venue}, ${monthYear(pub.date)}${pub.featured ? ', featured' : ''}.`,
        style: { left: `${pct(pub.t)}%` },
        onClick: () => { setCurrent(dot); select(pub.i); },
        onPointerenter: () => showTip(dot),
        onPointerleave: hideTip,
      });
      track.append(dot.btn);
      dots.push(dot);
      return dot;
    });
    lanesEl.append(el);
    return lane;
  });
  const dotByButton = new Map(dots.map((d) => [d.btn, d]));
  let current = dots.find((d) => d.pub.i === state.selected) || dots[0];

  const grid = h('div', { class: 'c-timeline__grid', 'aria-hidden': 'true' });
  const cols = range(y0, y1 - 1).map((y) => h('span', { class: 'c-timeline__col', style: { left: `${pct(y)}%`, width: `${100 / (y1 - y0)}%` } }));
  const rules = milestones.map((m) => h('span', { class: 'c-timeline__rule', style: { left: `${pct(m.t)}%` } }));
  grid.append(...cols, ...rules);
  // The grid comes first so lane borders and emphasis tints paint over it.
  const plot = h('div', { class: 'c-timeline__plot' }, grid, msRow, lanesEl);
  const axis = h('div', { class: 'c-timeline__axis', 'aria-hidden': 'true' },
    range(y0, y1 - 1).map((y) => h('span', { class: 'c-timeline__year-label', style: { left: `${pct(y + 0.5)}%` } }, String(y))));
  const tip = h('div', { class: 'c-timeline__tip', hidden: true, 'aria-hidden': 'true' });
  const chart = h('div', { class: 'c-timeline__chart' }, plot, axis, tip);
  const cardSwap = h('div', { class: 'c-timeline__card-swap' });
  const card = h('div', { class: 'c-timeline__card', 'aria-live': 'off' }, cardSwap);

  lanesEl.addEventListener('keydown', onKey);
  lanesEl.addEventListener('focusin', (e) => { if (dotByButton.has(e.target)) hideTip(); });

  /* ---------------------------------------------------------- list view */
  const listStatus = h('p', { class: 'c-timeline__list-status', role: 'status' });
  const listItems = list ? $$('.c-timeline__item', list).map((el) => ({
    el,
    themes: (el.dataset.themes || '').split(' ').filter(Boolean),
    featured: el.classList.contains('is-featured'),
  })) : [];
  const yearGroups = list ? $$('.c-timeline__year', list).map((el) => ({
    el,
    items: listItems.filter((it) => el.contains(it.el)),
    milestones: $$('.c-timeline__milestone', el).length,
    countEl: $('.c-timeline__year-count', el),
  })) : [];

  body.prepend(toolbar, chart, card, listStatus);
  if (list) listStatus.after(list);

  updateDots();
  renderCard(false);
  applyView();
  narrowQuery.addEventListener('change', applyView);
  let frame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(layout);
  }).observe(chart);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);

  /* ------------------------------------------------------------ layout */

  function layout() {
    if (chart.hidden) return;
    const width = lanes.length ? lanes[0].track.clientWidth : 0;
    if (!width) return;
    // One height for every lane, enough for the tallest stack.
    const reach = Math.max(0, ...lanes.map((lane) => stackDots(lane.dots, width, pct)));
    const laneHeight = `${Math.max(LANE_MIN, Math.ceil(2 * reach + 12))}px`;
    for (const lane of lanes) {
      lane.track.style.height = laneHeight;
      for (const d of lane.dots) d.btn.style.top = `calc(50% + ${d.off}px)`;
    }
    const rows = placeLabels(msItems, width, pct);
    msRow.style.height = `${Math.max(1, rows) * MS_ROW + 6}px`;
    msItems.forEach((item, i) => { rules[i].style.top = `${(item.row + 1) * MS_ROW}px`; });
    const top = `${msRow.offsetHeight}px`;
    for (const col of cols) col.style.top = top;
  }

  /* ----------------------------------------------------------- actions */

  function select(i) {
    if (i === state.selected) return;
    state.selected = i;
    updateDots();
    renderCard(true);
  }

  function setCurrent(dot) {
    current = dot;
    for (const d of dots) d.btn.tabIndex = d === dot ? 0 : -1;
  }

  function updateDots() {
    if (!current || current.pub.i !== state.selected) current = dots.find((d) => d.pub.i === state.selected) || current;
    for (const d of dots) {
      const on = d.pub.i === state.selected;
      d.btn.classList.toggle('is-selected', on);
      d.btn.setAttribute('aria-pressed', String(on));
      d.btn.tabIndex = d === current ? 0 : -1;
    }
  }

  // Left/right: previous/next in time within the lane. Up/down: the nearest
  // dot in time in the lane above/below. Home/End: ends of the lane.
  function onKey(event) {
    const dot = dotByButton.get(event.target);
    if (!dot) return;
    const laneIndex = lanes.indexOf(dot.lane);
    let next = null;
    if (event.key === 'ArrowRight') next = dot.lane.dots[dot.k + 1];
    else if (event.key === 'ArrowLeft') next = dot.lane.dots[dot.k - 1];
    else if (event.key === 'Home') next = dot.lane.dots[0];
    else if (event.key === 'End') next = dot.lane.dots[dot.lane.dots.length - 1];
    else if (event.key === 'ArrowUp') next = nearest(lanes[laneIndex - 1], dot.pub.t);
    else if (event.key === 'ArrowDown') next = nearest(lanes[laneIndex + 1], dot.pub.t);
    else return;
    event.preventDefault();
    if (!next) return;
    setCurrent(next);
    next.btn.focus();
    select(next.pub.i);
  }

  function toggleTheme(id) {
    if (state.emphasis.has(id)) state.emphasis.delete(id);
    else state.emphasis.add(id);
    applyThemes(true);
  }

  function clearThemes() {
    state.emphasis.clear();
    applyThemes(true);
    if (chipButtons[0]) chipButtons[0].focus();
  }

  function toggleFeatured() {
    state.featuredOnly = !state.featuredOnly;
    featuredChip.setAttribute('aria-pressed', String(state.featuredOnly));
    applyList();
  }

  function setView(view) {
    state.view = view;
    applyView();
  }

  function applyView() {
    const narrow = narrowQuery.matches;
    const view = narrow ? 'list' : state.view;
    chart.hidden = view !== 'timeline';
    card.hidden = view !== 'timeline';
    if (list) list.hidden = view !== 'list';
    listStatus.hidden = view !== 'list';
    viewSwitch.hidden = narrow;
    featuredChip.hidden = view !== 'list';
    for (const b of viewButtons) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    root.classList.toggle('is-list', view === 'list');
    applyThemes(false);
    if (view === 'timeline') layout();
  }

  function applyThemes(say) {
    const any = state.emphasis.size > 0;
    for (const b of chipButtons) b.setAttribute('aria-pressed', String(state.emphasis.has(b.dataset.theme)));
    clearButton.hidden = !any;
    for (const lane of lanes) {
      const on = state.emphasis.has(lane.theme.id);
      lane.el.classList.toggle('is-emph', on);
      lane.el.classList.toggle('is-muted', any && !on);
    }
    const shown = applyList();
    if (!say) return;
    if (!chart.hidden) {
      const n = pubs.filter((p) => p.themes.some((t) => state.emphasis.has(t))).length;
      ctx.announce(any ? `${listText([...state.emphasis].map((id) => themeById.get(id).label))}: ${count(n, 'publication')}.` : 'All themes shown.');
    } else {
      ctx.announce(`Showing ${shown} of ${pubs.length} publications.`);
    }
  }

  function applyList() {
    let shown = 0;
    for (const it of listItems) {
      const ok = (!state.emphasis.size || it.themes.some((t) => state.emphasis.has(t))) && (!state.featuredOnly || it.featured);
      it.el.hidden = !ok;
      if (ok) shown += 1;
    }
    for (const g of yearGroups) {
      const visible = g.items.filter((it) => !it.el.hidden).length;
      g.el.hidden = visible === 0 && g.milestones === 0;
      if (g.countEl) g.countEl.textContent = visible === g.items.length ? count(visible, 'publication') : `${visible} of ${count(g.items.length, 'publication')}`;
    }
    listStatus.textContent = shown === pubs.length
      ? `All ${pubs.length} publications, oldest first.`
      : `Showing ${shown} of ${pubs.length} publications, oldest first.`;
    return shown;
  }

  /* ------------------------------------------------------------- card */

  function renderCard(animate) {
    const p = pubs[state.selected];
    if (!p) return;
    const type = (data.pubtypes || {})[p.type] || p.type;
    const content = [
      h('p', { class: 'c-timeline__card-meta' },
        h('span', null, [monthYear(p.date), p.venue, type].filter(Boolean).join(' · ')),
        p.featured ? h('span', { class: 'badge badge--accent' }, 'Featured') : null,
        p.first ? h('span', { class: 'badge badge--muted' }, 'First author') : null),
      h('h3', { class: 'c-timeline__card-title' }, h('a', { href: p.url }, p.title)),
      h('p', { class: 'c-timeline__card-authors' }, boldName(p.authors || '', data.author)),
      h('div', { class: 'c-timeline__card-foot' },
        h('div', { class: 'c-timeline__card-tags' }, p.themes.map((id) => themeById.get(id)).filter(Boolean).map((th) => h('span', { class: 'tag' }, th.short || th.label))),
        h('div', { class: 'c-timeline__card-links' },
          p.explorer ? h('a', { href: p.explorer }, 'Interactive explorer') : null,
          h('a', { class: 'link-arrow', href: p.url }, 'Publication page'))),
    ];
    mount(cardSwap, content);
    if (animate && !ctx.reducedMotion) {
      cardSwap.classList.add('is-swapping');
      requestAnimationFrame(() => requestAnimationFrame(() => cardSwap.classList.remove('is-swapping')));
    }
  }

  /* -------------------------------------------------------------- tip */

  function showTip(dot) {
    const p = dot.pub;
    mount(tip, h('b', null, truncate(p.title, 96)), h('span', null, `${p.venue} · ${monthYear(p.date)}`));
    tip.hidden = false;
    const box = chart.getBoundingClientRect();
    const r = dot.btn.getBoundingClientRect();
    const w = tip.offsetWidth;
    const ht = tip.offsetHeight;
    const cx = r.left + r.width / 2 - box.left;
    let top = r.top - box.top - ht - 6;
    if (top < 0) top = r.bottom - box.top + 6;
    tip.style.left = `${clamp(cx - w / 2, 0, Math.max(0, box.width - w))}px`;
    tip.style.top = `${top}px`;
  }

  function hideTip() {
    tip.hidden = true;
  }

  function countTheme(id) {
    return pubs.filter((p) => p.themes.includes(id)).length;
  }
}

/* ------------------------------------------------------------------ layout */

// Beeswarm stacking in one lane: each dot keeps its exact date and moves up
// or down by the smallest amount that clears the dots already placed.
function stackDots(laneDots, width, pct) {
  const placed = [];
  let reach = 0;
  for (const d of laneDots) {
    const x = (pct(d.pub.t) / 100) * width;
    const r = d.pub.featured ? RADIUS.featured : RADIUS.other;
    const blocked = [];
    for (const q of placed) {
      const need = q.r + r + CLEAR;
      const dx = Math.abs(q.x - x);
      if (dx < need) {
        const dy = Math.sqrt(need * need - dx * dx);
        blocked.push([q.y - dy, q.y + dy]);
      }
    }
    const candidates = [0, ...blocked.flat()].sort((a, b) => Math.abs(a) - Math.abs(b));
    const y = candidates.find((c) => blocked.every(([a, b]) => c <= a + 0.01 || c >= b - 0.01)) || 0;
    placed.push({ x, y, r });
    d.off = Math.round(y * 10) / 10;
    reach = Math.max(reach, Math.abs(y) + r);
  }
  return reach;
}

// Milestone labels are flags on their rules: the label's underline starts at
// the rule and runs right, or left when it would pass the right edge. Rows
// are filled greedily; the first row where the label fits wins.
function placeLabels(items, width, pct) {
  const rows = [];
  for (const item of items) {
    const x = (pct(item.m.t) / 100) * width;
    const w = item.el.offsetWidth;
    const end = x + w > width;
    const left = end ? Math.max(0, x - w) : x;
    let row = rows.findIndex((spans) => spans.every(([a, b]) => left > b + 8 || left + w < a - 8));
    if (row === -1) {
      row = rows.length;
      rows.push([]);
    }
    rows[row].push([left, left + w]);
    item.row = row;
    item.el.classList.toggle('is-end', end);
    item.el.style.left = `${left}px`;
    item.el.style.top = `${row * MS_ROW}px`;
  }
  return rows.length;
}

function nearest(lane, t) {
  if (!lane || !lane.dots.length) return null;
  return lane.dots.reduce((best, d) => (Math.abs(d.pub.t - t) < Math.abs(best.pub.t - t) ? d : best));
}

/* ----------------------------------------------------------------- helpers */

function defaultSelection(pubs, url) {
  const hit = pubs.findIndex((p) => p.url === url);
  if (hit >= 0) return hit;
  const featured = pubs.filter((p) => p.featured);
  return (featured.length ? featured[featured.length - 1] : pubs[pubs.length - 1]).i;
}

function yearFraction(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const start = Date.UTC(y, 0, 1);
  return y + (Date.UTC(y, (m || 1) - 1, d || 1) - start) / (Date.UTC(y + 1, 0, 1) - start);
}

function monthYear(iso) {
  const [y, m] = iso.split('-').map(Number);
  return `${MONTHS[(m || 1) - 1]} ${y}`;
}

function boldName(authors, name) {
  if (!name || !authors.includes(name)) return authors;
  const out = [];
  authors.split(name).forEach((part, i) => {
    if (i > 0) out.push(h('strong', null, name));
    if (part) out.push(part);
  });
  return out;
}

function truncate(text, n) {
  return text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text;
}

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i += 1) out.push(i);
  return out;
}

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function listText(words) {
  if (words.length < 2) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}
