// Publication explorer for /publications/.
//
// The include renders every publication, grouped by year, plus the js-only
// controls. This module filters, highlights and reorders those nodes in place
// (so the markup has a single source), keeps the URL in sync with
// history.replaceState, and opens a Cite dialog with the BibTeX embedded as
// JSON. "/" and Ctrl/Cmd+K belong to the site search and are not bound here.

import { h, $, $$, uid, roving } from '../lib/dom.js';

const PARAM_KEYS = ['q', 'theme', 'type', 'first', 'sort'];
const SEARCH_DELAY = 140;
const ANNOUNCE_DELAY = 650;

/* ------------------------------------------------------------ text folding */

// Lower case without diacritics, so "rusinol" finds "Rusiñol".
function fold(text) {
  return String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// Folded text plus, for every folded character, the [start, end) of the source
// character it came from, so a match in the folded text can be marked in the
// original string.
function foldMapped(text) {
  let norm = '';
  const from = [];
  const to = [];
  let i = 0;
  for (const ch of text) {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) { from.push(i); to.push(i + ch.length); }
    norm += f;
    i += ch.length;
  }
  return { norm, from, to };
}

function tokenize(query) {
  return fold(query)
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
}

function mergeRanges(ranges) {
  const out = [];
  for (const r of ranges.sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

// Source ranges of every token occurrence in a field, merged.
function matchRanges(mapped, tokens) {
  const hits = [];
  for (const t of tokens) {
    for (let at = mapped.norm.indexOf(t); at !== -1; at = mapped.norm.indexOf(t, at + 1)) {
      hits.push([mapped.from[at], mapped.to[at + t.length - 1]]);
    }
  }
  return mergeRanges(hits);
}

// Offsets of the <strong> runs (the site owner's name) in an authors line.
function strongRanges(el) {
  const ranges = [];
  let at = 0;
  for (const node of el.childNodes) {
    const len = node.textContent.length;
    if (node.nodeName === 'STRONG') ranges.push([at, at + len]);
    at += len;
  }
  return ranges;
}

const inside = (ranges, a, b) => ranges.some(([x, y]) => x <= a && b <= y);

// Rewrite a field's text with <mark> around matches, keeping its <strong> runs.
function paint(field, marks) {
  if (!marks.length && !field.painted) return;
  const { el, text, bold } = field;
  const cuts = new Set([0, text.length]);
  for (const [a, b] of [...marks, ...bold]) { cuts.add(a); cuts.add(b); }
  const points = [...cuts].sort((a, b) => a - b);
  const nodes = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    let node = document.createTextNode(text.slice(a, b));
    if (inside(marks, a, b)) node = h('mark', null, node);
    if (inside(bold, a, b)) node = h('strong', null, node);
    nodes.push(node);
  }
  el.replaceChildren(...nodes);
  field.painted = marks.length > 0;
}

function debounce(fn, ms) {
  let timer = 0;
  const run = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  run.cancel = () => clearTimeout(timer);
  return run;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* --------------------------------------------------------------- URL state */

function readState(themeIds, typeIds) {
  const params = new URLSearchParams(location.search);
  const list = (key, valid) => [...new Set((params.get(key) || '')
    .split(',').map((v) => v.trim().toLowerCase()).filter((v) => valid.includes(v)))];
  const first = (params.get('first') || '').toLowerCase();
  return {
    q: (params.get('q') || '').slice(0, 200),
    themes: new Set(list('theme', themeIds)),
    types: new Set(list('type', typeIds)),
    first: first === '1' || first === 'true',
    sort: params.get('sort') === 'oldest' ? 'oldest' : 'newest',
  };
}

// Commas stay literal so the URL reads ?theme=text,memory.
const encodeParam = (v) => encodeURIComponent(v).replace(/%2C/gi, ',');

function writeState(state, themeIds, typeIds) {
  const params = new URLSearchParams(location.search);
  PARAM_KEYS.forEach((k) => params.delete(k));
  const pairs = [...params];
  const q = state.q.trim();
  if (q) pairs.push(['q', q]);
  if (state.themes.size) pairs.push(['theme', themeIds.filter((t) => state.themes.has(t)).join(',')]);
  if (state.types.size) pairs.push(['type', typeIds.filter((t) => state.types.has(t)).join(',')]);
  if (state.first) pairs.push(['first', '1']);
  if (state.sort === 'oldest') pairs.push(['sort', 'oldest']);
  const search = pairs.map(([k, v]) => `${encodeParam(k)}=${encodeParam(v)}`).join('&');
  const url = `${location.pathname}${search ? `?${search}` : ''}${location.hash}`;
  if (url !== `${location.pathname}${location.search}${location.hash}`) {
    try { history.replaceState(history.state, '', url); } catch { /* sandboxed */ }
  }
}

/* ---------------------------------------------------------------- citation */

const endWithStop = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);

// A plain-text reference composed only from front-matter fields.
function plainCitation(p) {
  const venue = [p.venue, p.pages && `pp. ${p.pages}`, p.year].filter(Boolean).join(', ');
  let link = '';
  if (p.doi && !p.doi.startsWith('10.48550')) link = `https://doi.org/${p.doi}`;
  else if (p.arxiv) link = `arXiv:${p.arxiv}`;
  else if (p.hal) link = `https://hal.science/${p.hal}`;
  else if (p.url_ext) link = p.url_ext;
  return [p.authors && endWithStop(p.authors.trim()), p.title && endWithStop(p.title), venue && endWithStop(venue), link]
    .filter(Boolean).join(' ');
}

function selectContents(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

async function copyText(text, fallbackEl) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // No async clipboard (insecure context, denied): select the entry and try
    // the legacy command; the selection stays so Ctrl+C works either way.
    selectContents(fallbackEl);
    try { return document.execCommand('copy'); } catch { return false; }
  }
}

// Modal dialogs leave the page scrollable; lock it the way the mobile nav does
// (overflow on body), padding for the scrollbar so nothing shifts.
function lockScroll() {
  const body = document.body;
  const gap = window.innerWidth - document.documentElement.clientWidth;
  const saved = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
  body.style.overflow = 'hidden';
  if (gap > 0) body.style.paddingRight = `${gap}px`;
  return () => Object.assign(body.style, saved);
}

const ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"/></svg>';

const FORMATS = [
  { id: 'bibtex', label: 'BibTeX', copy: 'Copy BibTeX', name: 'BibTeX entry', done: 'BibTeX copied to the clipboard.' },
  { id: 'text', label: 'Plain text', copy: 'Copy citation', name: 'Plain-text citation', done: 'Citation copied to the clipboard.' },
];

function createCiteDialog(root) {
  const titleId = uid('pe-cite-title');
  const kicker = h('p', { class: 'c-pub-explorer__dialog-kicker' });
  const title = h('h2', { class: 'c-pub-explorer__dialog-title', id: titleId });
  const closeBtn = h('button', { type: 'button', class: 'c-pub-explorer__dialog-close', 'aria-label': 'Close', html: ICON_CLOSE });
  const radios = FORMATS.map((f) => h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', dataset: { format: f.id } }, f.label));
  const group = h('div', { class: 'segmented c-pub-explorer__formats', role: 'radiogroup', 'aria-label': 'Citation format' }, radios);
  const code = h('code');
  const pre = h('pre', { class: 'c-pub-explorer__citation', tabindex: '0' }, code);
  const copyIcon = h('span', { class: 'c-pub-explorer__copy-icon', html: ICON_COPY });
  const copyLabel = h('span');
  const copyBtn = h('button', { type: 'button', class: 'btn btn--sm c-pub-explorer__copy' }, copyIcon, copyLabel);
  const status = h('p', { class: 'c-pub-explorer__dialog-status', role: 'status' });
  const pageLink = h('a', { class: 'link-arrow c-pub-explorer__dialog-link' }, 'Publication page');
  const dialog = h('dialog', { class: 'c-pub-explorer__dialog', 'aria-labelledby': titleId },
    h('div', { class: 'c-pub-explorer__dialog-head' }, h('div', { class: 'c-pub-explorer__dialog-heading' }, kicker, title), closeBtn),
    h('div', { class: 'c-pub-explorer__dialog-body' }, group, pre),
    h('div', { class: 'c-pub-explorer__dialog-foot' }, copyBtn, status, pageLink));
  root.append(dialog);

  let pub = null;
  let format = FORMATS[0];
  let opener = null;
  let unlock = null;
  let resetTimer = 0;
  let pressedOnBackdrop = false;

  function showCopyState(done) {
    clearTimeout(resetTimer);
    copyIcon.innerHTML = done ? ICON_CHECK : ICON_COPY;
    copyLabel.textContent = done ? 'Copied' : format.copy;
    if (done) resetTimer = setTimeout(() => showCopyState(false), 1800);
  }

  function setFormat(id) {
    format = FORMATS.find((f) => f.id === id) || FORMATS[0];
    for (const r of radios) {
      const on = r.dataset.format === format.id;
      r.setAttribute('aria-checked', String(on));
      r.tabIndex = on ? 0 : -1;
    }
    code.textContent = format.id === 'bibtex' ? pub.bibtex : plainCitation(pub);
    pre.setAttribute('aria-label', format.name);
    pre.classList.toggle('is-prose', format.id === 'text');
    pre.scrollTop = 0;
    status.textContent = '';
    showCopyState(false);
  }

  radios.forEach((r) => r.addEventListener('click', () => setFormat(r.dataset.format)));
  roving(radios, { onSelect: (i) => setFormat(radios[i].dataset.format) });

  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(code.textContent, code);
    const mac = /Mac|iPhone|iPad/.test(navigator.userAgent);
    status.textContent = ok ? format.done : `Selected. Press ${mac ? '⌘' : 'Ctrl'}+C to copy.`;
    if (ok) showCopyState(true);
  });

  closeBtn.addEventListener('click', () => dialog.close());
  // Close on a click on the backdrop, but not when a text selection that
  // started inside the dialog ends outside it.
  dialog.addEventListener('pointerdown', (e) => { pressedOnBackdrop = e.target === dialog; });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && pressedOnBackdrop) dialog.close();
    pressedOnBackdrop = false;
  });
  dialog.addEventListener('close', () => {
    clearTimeout(resetTimer);
    if (unlock) unlock();
    unlock = null;
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  });

  return {
    open(record, from) {
      pub = record;
      opener = from;
      kicker.textContent = `Cite · ${record.venue_short || record.year}`;
      title.textContent = record.title;
      pageLink.href = record.url;
      setFormat(format.id);
      if (!dialog.open) {
        unlock = lockScroll();
        dialog.showModal();
      }
      copyBtn.focus();
    },
  };
}

/* -------------------------------------------------------------------- init */

export default function init(root, ctx) {
  const data = ctx.data(root, 'pub-explorer');
  if (!data || !Array.isArray(data.pubs)) return;

  const themeIds = (data.themes || []).map((t) => t.id);
  const typeIds = Object.keys(data.types || {});
  const themeShort = Object.fromEntries((data.themes || []).map((t) => [t.id, t.short || t.label]));
  const byId = new Map(data.pubs.map((p) => [p.id, p]));

  const input = $('#pub-explorer-q', root);
  const clearQ = $('[data-pe-clear-q]', root);
  const toggle = $('[data-pe-toggle]', root);
  const toggleCount = $('[data-pe-active]', root);
  const facets = $('#pub-explorer-facets', root);
  const themeChips = $$('[data-pe-theme]', root);
  const typeChips = $$('[data-pe-type]', root);
  const firstChip = $('[data-pe-first]', root);
  const sortButtons = $$('[data-pe-sort]', root);
  const status = $('[data-pe-status]', root);
  const resets = $$('[data-pe-reset]', root);
  const groupsEl = $('[data-pe-groups]', root);
  const empty = $('[data-pe-empty]', root);
  const emptyDetail = $('[data-pe-empty-detail]', root);
  const navList = $('.c-pub-explorer__year-list', root);
  if (!input || !groupsEl) return;

  const records = $$('[data-pe-id]', root).map((li) => {
    const pub = byId.get(li.dataset.peId) || {};
    const fields = $$('[data-pe-field]', li).map((el) => {
      const text = el.textContent;
      return { el, text, mapped: foldMapped(text), bold: strongRanges(el), painted: false };
    });
    const hay = fold([pub.title, pub.authors, pub.venue, pub.venue_short, pub.summary, pub.note].filter(Boolean).join('\n'));
    return { li, pub, fields, hay, themes: pub.themes || [], type: pub.type, first: Boolean(pub.first), visible: true };
  });
  const total = records.length;

  const years = $$('[data-pe-year]', root).map((section) => {
    const year = section.dataset.peYear;
    const navItem = navList && $(`[data-pe-nav="${year}"]`, navList);
    const link = navItem && $('a', navItem);
    return {
      year,
      section,
      list: $('ol', section),
      count: $('[data-pe-year-count]', section),
      records: records.filter((r) => section.contains(r.li)),
      navItem,
      link,
      href: link && link.getAttribute('href'),
      bar: navItem && $('.c-pub-explorer__year-bar', navItem),
      navCount: navItem && $('[data-pe-nav-count]', navItem),
    };
  });

  const state = readState(themeIds, typeIds);
  input.value = state.q;
  const cite = createCiteDialog(root);
  let lastAnnounced = '';
  let ready = false;

  const isFiltered = () => tokenize(state.q).length > 0 || state.themes.size > 0 || state.types.size > 0 || state.first;

  function setChip(chip, count, pressed) {
    chip.setAttribute('aria-pressed', String(pressed));
    chip.classList.toggle('is-empty', count === 0);
    const n = $('[data-pe-count]', chip);
    if (n) n.textContent = String(count);
  }

  function describeFilters() {
    const parts = [];
    const q = state.q.trim();
    if (q) parts.push(`Search “${q}”`);
    if (state.themes.size) parts.push(`Theme: ${themeIds.filter((t) => state.themes.has(t)).map((t) => themeShort[t]).join(' or ')}`);
    if (state.types.size) parts.push(`Type: ${typeIds.filter((t) => state.types.has(t)).map((t) => data.types[t]).join(' or ')}`);
    if (state.first) parts.push('First-authored');
    return parts.join(' · ');
  }

  const announce = debounce((message) => {
    if (message === lastAnnounced) return;
    lastAnnounced = message;
    ctx.announce(message);
  }, ANNOUNCE_DELAY);

  function render() {
    const tokens = tokenize(state.q);
    const filtered = isFiltered();
    let shown = 0;

    for (const r of records) {
      r.textHit = tokens.every((t) => r.hay.includes(t));
      r.themeOk = !state.themes.size || r.themes.some((t) => state.themes.has(t));
      r.typeOk = !state.types.size || state.types.has(r.type);
      r.firstOk = !state.first || r.first;
      const visible = r.textHit && r.themeOk && r.typeOk && r.firstOk;
      if (visible && r.li.hidden && ready && !ctx.reducedMotion && r.li.animate) {
        r.li.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
      }
      r.li.hidden = !visible;
      r.visible = visible;
      if (visible) shown++;
      for (const f of r.fields) paint(f, visible && tokens.length ? matchRanges(f.mapped, tokens) : []);
    }

    // Facet counts are disjunctive: each group is counted against the other
    // groups (and the search), so a count says what pressing the chip gives.
    for (const chip of themeChips) {
      const id = chip.dataset.peTheme;
      setChip(chip, records.filter((r) => r.textHit && r.typeOk && r.firstOk && r.themes.includes(id)).length, state.themes.has(id));
    }
    for (const chip of typeChips) {
      const id = chip.dataset.peType;
      setChip(chip, records.filter((r) => r.textHit && r.themeOk && r.firstOk && r.type === id).length, state.types.has(id));
    }
    if (firstChip) setChip(firstChip, records.filter((r) => r.textHit && r.themeOk && r.typeOk && r.first).length, state.first);

    for (const y of years) {
      const n = y.records.filter((r) => r.visible).length;
      const all = y.records.length;
      y.section.hidden = n === 0;
      if (y.count) y.count.textContent = filtered ? `${n} of ${all}` : plural(all, 'publication');
      if (y.bar) y.bar.style.setProperty('--m', String(n));
      if (y.navCount) y.navCount.textContent = filtered ? `${n}/${all}` : String(all);
      if (y.link) {
        // A year with no match is not a destination: drop the href so it
        // leaves the tab order and reads as unavailable.
        if (n === 0) { y.link.removeAttribute('href'); y.link.setAttribute('aria-disabled', 'true'); }
        else { y.link.setAttribute('href', y.href); y.link.removeAttribute('aria-disabled'); }
      }
    }

    const message = filtered ? `${shown} of ${total} publications` : `${total} publications`;
    status.replaceChildren(h('b', null, String(shown)), filtered ? ` of ${total} publications` : ' publications');
    root.classList.toggle('is-filtered', filtered);
    for (const btn of resets) if (!empty.contains(btn)) btn.hidden = !filtered;
    empty.hidden = shown > 0;
    if (shown === 0) emptyDetail.textContent = describeFilters();
    clearQ.hidden = !input.value;

    const active = state.themes.size + state.types.size + (state.first ? 1 : 0);
    if (toggleCount) {
      toggleCount.hidden = active === 0;
      toggleCount.textContent = active ? String(active) : '';
    }
    if (toggle) toggle.setAttribute('aria-label', active ? `Filters, ${active} active` : 'Filters');

    writeState(state, themeIds, typeIds);
    if (ready) announce(shown === 0 ? `No publications match. ${describeFilters()}` : message);
  }

  function applySort() {
    const newest = state.sort !== 'oldest';
    const ordered = newest ? years : [...years].reverse();
    groupsEl.append(...ordered.map((y) => y.section));
    for (const y of years) y.list.append(...(newest ? y.records : [...y.records].reverse()).map((r) => r.li));
    if (navList) navList.append(...ordered.map((y) => y.navItem).filter(Boolean));
    for (const btn of sortButtons) {
      const on = btn.dataset.peSort === state.sort;
      btn.setAttribute('aria-checked', String(on));
      btn.tabIndex = on ? 0 : -1;
    }
  }

  function setSort(value) {
    if (value === state.sort) return;
    state.sort = value;
    applySort();
    writeState(state, themeIds, typeIds);
    ctx.announce(value === 'oldest' ? 'Sorted oldest first' : 'Sorted newest first');
  }

  function resetAll() {
    searchLater.cancel();
    state.q = '';
    state.themes.clear();
    state.types.clear();
    state.first = false;
    input.value = '';
    render();
    input.focus();
  }

  /* ---- events */

  const searchLater = debounce(() => { state.q = input.value; render(); }, SEARCH_DELAY);
  input.addEventListener('input', () => {
    clearQ.hidden = !input.value;
    searchLater();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) {
      e.preventDefault();
      e.stopPropagation();
      searchLater.cancel();
      input.value = '';
      state.q = '';
      render();
    }
  });
  clearQ.addEventListener('click', () => {
    searchLater.cancel();
    input.value = '';
    state.q = '';
    render();
    input.focus();
  });

  const toggleIn = (set, id) => (set.has(id) ? set.delete(id) : set.add(id));
  for (const chip of themeChips) chip.addEventListener('click', () => { toggleIn(state.themes, chip.dataset.peTheme); render(); });
  for (const chip of typeChips) chip.addEventListener('click', () => { toggleIn(state.types, chip.dataset.peType); render(); });
  if (firstChip) firstChip.addEventListener('click', () => { state.first = !state.first; render(); });

  sortButtons.forEach((btn) => btn.addEventListener('click', () => setSort(btn.dataset.peSort)));
  roving(sortButtons, { onSelect: (i) => setSort(sortButtons[i].dataset.peSort) });

  for (const btn of resets) btn.addEventListener('click', resetAll);

  if (toggle && facets) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      facets.classList.toggle('is-open', open);
    });
  }

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pe-cite]');
    const pub = btn && byId.get(btn.dataset.peCite);
    if (pub && pub.bibtex) cite.open(pub, btn);
  });

  if (state.sort !== 'newest') applySort();
  render();
  ready = true;
}
