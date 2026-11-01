// Site boot script (ES module, loaded on every page).
//
// Interactive figures are progressive enhancements: each page ships readable
// HTML, and an element with data-component="name" is upgraded by
// assets/js/components/name.js once it nears the viewport. A component module
// exports `default function init(root, ctx)`.

const version = new URL(import.meta.url).searchParams.get('v') || '';
const componentsBase = new URL('./components/', import.meta.url);
const root = document.documentElement;
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

/* ---------------------------------------------------------------- theme */

const themeListeners = new Set();

function storedTheme() {
  try { return localStorage.getItem('theme'); } catch { return null; }
}

function currentTheme() {
  return root.dataset.theme || (darkQuery.matches ? 'dark' : 'light');
}

function applyTheme(theme, persist) {
  root.dataset.theme = theme;
  if (persist) {
    try { localStorage.setItem('theme', theme); } catch { /* private mode */ }
  }
  syncThemeButtons();
  for (const cb of themeListeners) cb(theme);
}

function syncThemeButtons() {
  const dark = currentTheme() === 'dark';
  for (const btn of document.querySelectorAll('[data-theme-toggle]')) {
    btn.setAttribute('aria-pressed', String(dark));
    btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  }
}

document.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-theme-toggle]');
  if (btn) applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
});
darkQuery.addEventListener('change', () => {
  if (!storedTheme()) {
    delete root.dataset.theme;
    syncThemeButtons();
    for (const cb of themeListeners) cb(currentTheme());
  }
});
syncThemeButtons();

/* --------------------------------------------------------------- header */

const header = document.querySelector('[data-header]');
if (header) {
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 4);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

const navToggle = document.querySelector('[data-nav-toggle]');
const navList = navToggle && document.getElementById(navToggle.getAttribute('aria-controls'));
function setNav(open) {
  if (!navToggle || !navList) return;
  navToggle.setAttribute('aria-expanded', String(open));
  navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  navList.classList.toggle('is-open', open);
  document.body.classList.toggle('nav-open', open);
}
if (navToggle && navList) {
  navToggle.addEventListener('click', () => setNav(navToggle.getAttribute('aria-expanded') !== 'true'));
  navList.addEventListener('click', (e) => { if (e.target.closest('a')) setNav(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navToggle.getAttribute('aria-expanded') === 'true') {
      setNav(false);
      navToggle.focus();
    }
  });
  window.matchMedia('(min-width: 901px)').addEventListener('change', (e) => { if (e.matches) setNav(false); });
}

/* -------------------------------------------------------------- palette */

let palettePromise = null;
function openPalette(query) {
  palettePromise ||= import(new URL(`palette.js${version ? `?v=${version}` : ''}`, componentsBase));
  palettePromise
    .then((mod) => mod.open({ query, indexUrl: document.body.dataset.searchIndex || '/assets/search.json' }))
    .catch((err) => {
      console.error('[site] search failed to load', err);
      palettePromise = null;
    });
}

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-search-open]');
  if (trigger) {
    event.preventDefault();
    openPalette(trigger.dataset.searchQuery || '');
  }
});
document.addEventListener('keydown', (event) => {
  const typing = event.target.closest('input, textarea, select, [contenteditable="true"]');
  if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    openPalette('');
  } else if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    openPalette('');
  }
});

/* ---------------------------------------------------------- copy button */

document.addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-copy]');
  if (!btn) return;
  const target = btn.dataset.copy.startsWith('#') ? document.querySelector(btn.dataset.copy) : null;
  const text = target ? target.textContent.trim() : btn.dataset.copy;
  const label = btn.querySelector('[data-copy-label]') || btn;
  const original = label.textContent;
  try {
    await navigator.clipboard.writeText(text);
    label.textContent = 'Copied';
  } catch {
    label.textContent = 'Press Ctrl+C';
    if (target) {
      const range = document.createRange();
      range.selectNodeContents(target);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
  announce(label.textContent);
  setTimeout(() => { label.textContent = original; }, 1800);
});

/* ------------------------------------------------------------ live region */

let liveRegion = null;
function announce(message) {
  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.className = 'visually-hidden';
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('role', 'status');
    document.body.append(liveRegion);
  }
  liveRegion.textContent = '';
  requestAnimationFrame(() => { liveRegion.textContent = message; });
}

/* ------------------------------------------------------------ scrollspy */

for (const toc of document.querySelectorAll('[data-toc]')) {
  const links = [...toc.querySelectorAll('a[href^="#"]')];
  const targets = links.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1)))).filter(Boolean);
  if (!targets.length) continue;
  const spy = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const a of links) {
        if (a.hash === `#${entry.target.id}`) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
    }
  }, { rootMargin: '-20% 0px -70% 0px' });
  targets.forEach((t) => spy.observe(t));
}

/* ----------------------------------------------------- component loader */

function readData(el, name) {
  const script = el.querySelector(`script[type="application/json"][data-for="${name}"]`)
    || el.querySelector('script[type="application/json"]');
  if (!script) return null;
  try { return JSON.parse(script.textContent); } catch (err) {
    console.error(`[site] bad JSON for ${name}`, err);
    return null;
  }
}

const ctx = {
  version,
  get reducedMotion() { return reducedMotionQuery.matches; },
  theme: currentTheme,
  onTheme(cb) { themeListeners.add(cb); return () => themeListeners.delete(cb); },
  data: readData,
  announce,
};

async function upgrade(el) {
  if (el.dataset.ready) return;
  el.dataset.ready = 'loading';
  const name = el.dataset.component;
  try {
    const mod = await import(new URL(`${name}.js${version ? `?v=${version}` : ''}`, componentsBase));
    await mod.default(el, ctx);
    el.dataset.ready = 'true';
  } catch (err) {
    el.dataset.ready = 'error';
    console.error(`[site] component "${name}" failed`, err);
  }
}

const pending = [...document.querySelectorAll('[data-component]')];
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        io.unobserve(entry.target);
        upgrade(entry.target);
      }
    }
  }, { rootMargin: '600px 0px' });
  for (const el of pending) {
    if (el.hasAttribute('data-eager')) upgrade(el);
    else io.observe(el);
  }
} else {
  pending.forEach(upgrade);
}

// Deep links into a figure (e.g. /research/persistent-state/#audit) should
// find it upgraded.
if (location.hash) {
  const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  const comp = target && (target.closest('[data-component]') || target.querySelector('[data-component]'));
  if (comp) upgrade(comp);
}

export { announce, currentTheme };
