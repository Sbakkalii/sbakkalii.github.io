// Site-wide search palette: Ctrl/Cmd+K, "/", or any [data-search-open]
// trigger. site.js imports this module on first use and calls
// open({ query, indexUrl }). The index (/assets/search.json) is an array of
// {type, title, url, text, year?}; it is fetched once and kept in memory.
//
// Pattern: a modal <dialog> holding an ARIA 1.2 combobox (the input) that
// controls a grouped listbox; focus stays in the input and the active option
// is exposed with aria-activedescendant.

import { h, s, uid } from '../lib/dom.js';

const GROUPS = [
  { type: 'Page', label: 'Pages', limit: 5 },
  { type: 'Product', label: 'Products', limit: 3 },
  { type: 'Paper', label: 'Paper explorer', limit: 6 },
  { type: 'Publication', label: 'Publications', limit: 6 },
];
const ANNOUNCE_DELAY = 500;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let indexPromise = null;
let ui = null;

/* ---------------------------------------------------------------- matching */

function fold(text) {
  return String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// Folded text with a map back to the source characters (for <mark>).
function foldMapped(text) {
  let norm = '';
  const from = [];
  const to = [];
  let i = 0;
  for (const ch of String(text ?? '')) {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) { from.push(i); to.push(i + ch.length); }
    norm += f;
    i += ch.length;
  }
  return { text: String(text ?? ''), norm, from, to };
}

function tokenize(query) {
  return fold(query)
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
}

const isWordChar = (ch) => /[\p{L}\p{N}]/u.test(ch || '');

// Where a token occurs: 3 at the very start, 2 at a word start, 1 inside a
// word, 0 not at all.
function placement(norm, token) {
  let best = 0;
  for (let at = norm.indexOf(token); at !== -1; at = norm.indexOf(token, at + 1)) {
    const p = at === 0 ? 3 : isWordChar(norm[at - 1]) ? 1 : 2;
    if (p > best) best = p;
    if (best === 3) break;
  }
  return best;
}

// Typo-tolerant fallback: the token's letters appear in order inside one word
// that starts with the same letter and is not much longer ("globdoc").
function fuzzyWord(norm, token) {
  if (token.length < 3) return false;
  for (const word of norm.split(/[^\p{L}\p{N}]+/u)) {
    if (!word || word[0] !== token[0] || word.length > token.length * 2 + 2) continue;
    let i = 0;
    for (const ch of word) if (ch === token[i]) i++;
    if (i >= token.length) return true;
  }
  return false;
}

// Title beats text, prefix beats substring; every token must match somewhere.
function score(entry, tokens) {
  let total = 0;
  for (const token of tokens) {
    const inTitle = placement(entry.title.norm, token);
    const inText = placement(entry.text.norm, token);
    let s = 0;
    if (inTitle) s = [0, 6, 9, 12][inTitle];
    else if (inText) s = [0, 2, 3.5, 4][inText];
    else if (fuzzyWord(entry.title.norm, token)) s = 1.5;
    else if (token.length >= 4 && fuzzyWord(entry.text.norm, token)) s = 0.5;
    if (!s) return 0;
    total += s;
  }
  const whole = tokens.join(' ');
  if (entry.title.norm === whole) total += 6;
  else if (entry.title.norm.startsWith(whole)) total += 3;
  return total;
}

function rangesFor(mapped, tokens) {
  const hits = [];
  for (const t of tokens) {
    for (let at = mapped.norm.indexOf(t); at !== -1; at = mapped.norm.indexOf(t, at + 1)) {
      hits.push([mapped.from[at], mapped.to[at + t.length - 1]]);
    }
  }
  hits.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of hits) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

// Text nodes with <mark> around the given source ranges.
function marked(text, ranges, start = 0, end = text.length) {
  const nodes = [];
  let at = start;
  for (const [a, b] of ranges) {
    if (b <= start || a >= end) continue;
    const x = Math.max(a, start);
    const y = Math.min(b, end);
    if (x > at) nodes.push(text.slice(at, x));
    nodes.push(h('mark', null, text.slice(x, y)));
    at = y;
  }
  if (at < end) nodes.push(text.slice(at, end));
  return nodes;
}

// A window of the secondary text around its first match, cut at spaces.
function snippet(mapped, ranges, max = 120) {
  const { text } = mapped;
  if (text.length <= max) return marked(text, ranges);
  const first = ranges[0] ? ranges[0][0] : 0;
  let start = first > max - 40 ? first - 30 : 0;
  if (start > 0) start = Math.max(0, text.lastIndexOf(' ', start) + 1);
  let end = Math.min(text.length, start + max);
  if (end < text.length) end = Math.max(start + 20, text.lastIndexOf(' ', end));
  return [start > 0 ? '…' : '', ...marked(text, ranges, start, end), end < text.length ? '…' : ''];
}

/* -------------------------------------------------------------------- index */

function loadIndex(url) {
  indexPromise ||= fetch(url, { credentials: 'same-origin' })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((items) => items
      .filter((e) => e && e.title && e.url)
      .map((e, order) => ({
        ...e,
        order,
        title: foldMapped(e.title),
        text: foldMapped([e.text, e.year].filter(Boolean).join(' · ')),
        detail: foldMapped(e.text || ''),
      })))
    .catch((err) => {
      indexPromise = null;
      throw err;
    });
  return indexPromise;
}

const endsWithPath = (url, path) => {
  try { return new URL(url, location.href).pathname.endsWith(path); } catch { return false; }
};

// Shown before anything is typed: the main sections, then the paper explorer.
function suggestions(index) {
  const pick = (path) => index.find((e) => e.type === 'Page' && endsWithPath(e.url, path));
  const pages = ['/research/', '/products/', '/publications/'].map(pick).filter(Boolean);
  const explorer = [pick('/research/persistent-state/'), ...index.filter((e) => e.type === 'Paper')].filter(Boolean);
  return [
    { label: 'Go to', items: pages },
    { label: 'Paper explorer', items: explorer },
  ].filter((g) => g.items.length);
}

function search(index, query) {
  const tokens = tokenize(query);
  const scored = index
    .map((entry) => ({ entry, score: score(entry, tokens) }))
    .filter((r) => r.score > 0);
  const groups = [];
  const known = new Set(GROUPS.map((g) => g.type));
  const defs = [...GROUPS, ...[...new Set(scored.map((r) => r.entry.type))].filter((t) => !known.has(t)).map((t) => ({ type: t, label: t, limit: 5 }))];
  for (const def of defs) {
    const hits = scored
      .filter((r) => r.entry.type === def.type)
      .sort((a, b) => b.score - a.score || a.entry.order - b.entry.order);
    if (!hits.length) continue;
    groups.push({
      label: def.label,
      type: def.type,
      best: hits[0].score,
      rank: GROUPS.indexOf(def),
      total: hits.length,
      items: hits.slice(0, def.limit).map((r) => r.entry),
    });
  }
  // The group holding the best match comes first, so it is the first option.
  groups.sort((a, b) => b.best - a.best || a.rank - b.rank);
  return { tokens, groups, count: scored.length };
}

/* ------------------------------------------------------------------- icons */

function icon(type) {
  const attrs = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' };
  if (type === 'Product') {
    return s('svg', attrs, s('path', { d: 'M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z' }), s('path', { d: 'm4 7.5 8 4.5 8-4.5M12 12v9' }));
  }
  if (type === 'Paper') {
    // The layout-annotation motif: a dashed region with a label tab.
    return s('svg', attrs, s('rect', { x: '3.5', y: '7', width: '17', height: '13', rx: '1.5', 'stroke-dasharray': '2.6 2' }), s('rect', { x: '3.5', y: '3.5', width: '8', height: '3.5', rx: '0.8', fill: 'currentColor', stroke: 'none' }));
  }
  if (type === 'Publication') {
    return s('svg', attrs, s('path', { d: 'M3.5 5.5c2.6-1 5.4-1 8.5.6 3.1-1.6 5.9-1.6 8.5-.6v13c-2.6-1-5.4-1-8.5.6-3.1-1.6-5.9-1.6-8.5-.6Z' }), s('path', { d: 'M12 6.1v13' }));
  }
  if (type === 'More') {
    return s('svg', attrs, s('circle', { cx: '11', cy: '11', r: '6.5' }), s('path', { d: 'm20 20-4.2-4.2' }));
  }
  return s('svg', attrs, s('path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z' }), s('path', { d: 'M14 3v5h5M9 13h6M9 17h4' }));
}

/* ---------------------------------------------------------------------- UI */

function lockScroll() {
  const body = document.body;
  const gap = window.innerWidth - document.documentElement.clientWidth;
  const saved = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
  body.style.overflow = 'hidden';
  if (gap > 0) body.style.paddingRight = `${gap}px`;
  return () => Object.assign(body.style, saved);
}

function build() {
  const listId = uid('palette-list');
  const titleId = uid('palette-title');
  const input = h('input', {
    class: 'c-palette__input',
    type: 'search',
    role: 'combobox',
    'aria-label': 'Search the site',
    'aria-expanded': 'false',
    'aria-controls': listId,
    'aria-autocomplete': 'list',
    placeholder: 'Search pages, papers, products',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'go',
  });
  const close = h('button', { type: 'button', class: 'c-palette__close' },
    h('span', { class: 'c-palette__close-text' }, 'Close'),
    h('kbd', { 'aria-hidden': 'true' }, 'Esc'));
  const list = h('div', { class: 'c-palette__list', id: listId, role: 'listbox', 'aria-label': 'Search results' });
  const message = h('p', { class: 'c-palette__message', hidden: true });
  const live = h('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
  const footCount = h('span', { class: 'c-palette__foot-count' });
  const foot = h('div', { class: 'c-palette__foot' },
    h('span', null, h('kbd', null, '↑'), h('kbd', null, '↓'), ' to move'),
    h('span', null, h('kbd', null, '↵'), ' to open'),
    h('span', null, h('kbd', null, 'Esc'), ' to close'),
    footCount);
  const dialog = h('dialog', { class: 'c-palette', 'aria-labelledby': titleId },
    h('h2', { class: 'visually-hidden', id: titleId }, 'Search this site'),
    h('div', { class: 'c-palette__head' }, icon('More'), input, close),
    h('div', { class: 'c-palette__body' }, list, message),
    foot,
    live);
  document.body.append(dialog);

  const view = {
    dialog, input, list, message, live, footCount,
    options: [],
    active: -1,
    index: null,
    opener: null,
    unlock: null,
    navigating: false,
    announceTimer: 0,
    pressedOnBackdrop: false,
  };
  bind(view, close);
  return view;
}

function setActive(view, i, { scroll = true } = {}) {
  const { options, input } = view;
  if (!options.length) {
    view.active = -1;
    input.removeAttribute('aria-activedescendant');
    return;
  }
  const next = (i + options.length) % options.length;
  if (view.active >= 0 && options[view.active]) options[view.active].setAttribute('aria-selected', 'false');
  view.active = next;
  const el = options[next];
  el.setAttribute('aria-selected', 'true');
  input.setAttribute('aria-activedescendant', el.id);
  if (scroll) el.scrollIntoView({ block: 'nearest' });
}

function option(view, entry, tokens, { kind = entry.type, extra } = {}) {
  const titleRanges = tokens.length ? rangesFor(entry.title, tokens) : [];
  const detailRanges = tokens.length ? rangesFor(entry.detail, tokens) : [];
  // Explorer sections all share the paper's name as text: show it only when
  // it is what matched.
  const showDetail = Boolean(entry.detail.text) && (kind !== 'Paper' || detailRanges.length > 0);
  const el = h('a', {
    class: 'c-palette__option',
    id: uid('palette-opt'),
    role: 'option',
    href: entry.url,
    tabindex: '-1',
    'aria-selected': 'false',
    dataset: { kind },
  },
  h('span', { class: 'c-palette__icon' }, icon(kind)),
  h('span', { class: 'c-palette__text' },
    h('span', { class: 'c-palette__title' }, ...marked(entry.title.text, titleRanges)),
    showDetail ? h('span', { class: 'c-palette__detail' }, ...snippet(entry.detail, detailRanges)) : null),
  entry.year ? h('span', { class: 'c-palette__meta' }, entry.year) : null,
  extra || null,
  h('span', { class: 'c-palette__enter', 'aria-hidden': 'true' }, '↵'));
  view.options.push(el);
  return el;
}

function group(label, children) {
  const labelId = uid('palette-group');
  return h('div', { class: 'c-palette__group', role: 'group', 'aria-labelledby': labelId },
    h('div', { class: 'c-palette__group-label', role: 'presentation', id: labelId }, label),
    children);
}

function announce(view, text) {
  clearTimeout(view.announceTimer);
  view.announceTimer = setTimeout(() => { view.live.textContent = text; }, ANNOUNCE_DELAY);
}

function render(view) {
  const { list, message, input } = view;
  const query = input.value;
  view.options = [];
  view.active = -1;
  list.replaceChildren();

  if (!view.index) return;
  const tokens = tokenize(query);
  let groups;
  let count = 0;
  if (!tokens.length) {
    groups = suggestions(view.index);
    for (const g of groups) list.append(group(g.label, g.items.map((e) => option(view, e, []))));
    view.footCount.textContent = `${view.index.length} entries`;
  } else {
    const result = search(view.index, query);
    groups = result.groups;
    count = result.count;
    for (const g of groups) {
      const items = g.items.map((e) => option(view, e, result.tokens));
      // More publications than shown: hand the query to the publication
      // explorer, which reads ?q= on load.
      if (g.type === 'Publication' && g.total > g.items.length) {
        const pubs = view.index.find((e) => e.type === 'Page' && endsWithPath(e.url, '/publications/'));
        if (pubs) {
          const url = new URL(pubs.url, location.href);
          url.searchParams.set('q', query.trim());
          items.push(option(view, {
            url: `${url.pathname}${url.search}`,
            title: foldMapped(`Search all publications for “${query.trim()}”`),
            detail: foldMapped(`${g.total} matches here · opens the publication explorer`),
          }, [], { kind: 'More' }));
        }
      }
      list.append(group(g.total > g.items.length ? `${g.label} · ${g.items.length} of ${g.total}` : g.label, items));
    }
    view.footCount.textContent = count === 1 ? '1 result' : `${count} results`;
  }

  const has = view.options.length > 0;
  input.setAttribute('aria-expanded', String(has));
  list.hidden = !has;
  message.hidden = has;
  if (!has) {
    message.replaceChildren(
      h('strong', null, `No matches for “${query.trim()}”.`),
      ' Try a title word, an author, a venue or a year.');
  }
  setActive(view, 0, { scroll: false });
  list.scrollTop = 0;
  if (tokens.length) announce(view, has ? `${count} ${count === 1 ? 'result' : 'results'}` : 'No results');
}

function showMessage(view, nodes) {
  view.list.replaceChildren();
  view.list.hidden = true;
  view.options = [];
  view.input.setAttribute('aria-expanded', 'false');
  view.input.removeAttribute('aria-activedescendant');
  view.message.hidden = false;
  view.message.replaceChildren(...nodes);
}

function go(view, el, { newTab = false } = {}) {
  if (!el) return;
  const href = el.getAttribute('href');
  if (newTab) {
    window.open(href, '_blank', 'noopener');
    return;
  }
  const target = new URL(href, location.href);
  const samePage = target.pathname === location.pathname && target.search === location.search;
  view.navigating = true;
  closePalette(view);
  if (samePage && target.hash) {
    // Same page: let the fragment navigation scroll (and move the focus
    // starting point); if the hash is already current, scroll by hand.
    const id = decodeURIComponent(target.hash.slice(1));
    const node = document.getElementById(id);
    if (location.hash === target.hash && node) node.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
    else location.hash = target.hash;
  } else {
    location.assign(target.href);
  }
}

function closePalette(view) {
  if (view.dialog.open) view.dialog.close();
}

function bind(view, closeBtn) {
  const { dialog, input, list } = view;

  input.addEventListener('input', () => render(view));
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(view, view.active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      if (!view.options.length) return;
      e.preventDefault();
      const step = e.key === 'PageDown' ? 5 : -5;
      setActive(view, Math.max(0, Math.min(view.options.length - 1, view.active + step)));
    } else if (e.key === 'Enter') {
      if (view.active < 0) return;
      e.preventDefault();
      go(view, view.options[view.active], { newTab: e.metaKey || e.ctrlKey });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePalette(view);
    }
  });

  // Hover moves the active option; pointermove (not mouseover) so a list
  // re-rendered under a still pointer keeps the keyboard's choice.
  list.addEventListener('pointermove', (e) => {
    const el = e.target.closest('[role="option"]');
    const i = el ? view.options.indexOf(el) : -1;
    if (i >= 0 && i !== view.active) setActive(view, i, { scroll: false });
  });
  list.addEventListener('mousedown', (e) => {
    // Keep focus in the input when an option is pressed.
    if (e.target.closest('[role="option"]')) e.preventDefault();
  });
  list.addEventListener('click', (e) => {
    const el = e.target.closest('[role="option"]');
    if (!el) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // browser opens a tab/window
    e.preventDefault();
    go(view, el);
  });

  closeBtn.addEventListener('click', () => closePalette(view));
  dialog.addEventListener('pointerdown', (e) => { view.pressedOnBackdrop = e.target === dialog; });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && view.pressedOnBackdrop) closePalette(view);
    view.pressedOnBackdrop = false;
  });
  dialog.addEventListener('close', () => {
    clearTimeout(view.announceTimer);
    view.live.textContent = '';
    if (view.unlock) view.unlock();
    view.unlock = null;
    const opener = view.opener;
    view.opener = null;
    if (view.navigating) {
      view.navigating = false;
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    } else if (opener && opener.isConnected && opener !== document.body) {
      opener.focus({ preventScroll: true });
    }
  });
}

/* -------------------------------------------------------------------- API */

export function open({ query = '', indexUrl = '/assets/search.json' } = {}) {
  ui ||= build();
  const view = ui;
  if (view.dialog.open) {
    view.input.focus();
    view.input.select();
    return;
  }
  view.opener = document.activeElement;
  view.input.value = query;
  view.unlock = lockScroll();
  view.dialog.showModal();
  view.input.focus();

  if (view.index) {
    render(view);
    return;
  }
  showMessage(view, [h('span', { class: 'c-palette__loading' }, 'Loading the search index…')]);
  loadIndex(indexUrl)
    .then((index) => {
      view.index = index;
      if (view.dialog.open) render(view);
    })
    .catch(() => {
      if (!view.dialog.open) return;
      showMessage(view, [h('strong', null, 'Search is unavailable right now.'), ' Use the menu, or try again in a moment.']);
    });
}

