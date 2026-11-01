// The stack: the capability layers from _data/products.yml (seven today),
// from acquiring a document to measuring what memory adds. Nothing here
// assumes a number of layers or products, or their ids.
// From 760 px it is a pipeline of tiles that follows the ARIA tabs pattern
// (tiles are tabs, the detail panel is the tabpanel); below that it is an
// accordion stepper. Product chips mark the layers a product covers, with a
// dashed annotation box around each run of covered tiles.
import { h, $, uid, roving, mount } from '../lib/dom.js';
import { mathHTML, escapeHTML } from '../lib/math.js';

const NARROW = '(max-width: 759px)';

export default function init(root, ctx) {
  const data = ctx.data(root, 'stack');
  if (!data || !Array.isArray(data.stack) || !data.stack.length) return;

  const layers = data.stack;
  const products = Array.isArray(data.products) ? data.products : [];
  const productById = new Map(products.map((p) => [p.id, p]));
  const statuses = data.statuses || {};
  const pubs = data.pubs || {};
  const base = uid('stack');
  const narrowQuery = window.matchMedia(NARROW);
  const state = { index: 0, product: null };
  let view = null;

  const chipButtons = products.map((p) => h('button', {
    type: 'button',
    class: 'chip',
    'aria-pressed': 'false',
    dataset: { product: p.id },
    onClick: () => setProduct(state.product === p.id ? null : p.id),
  }, p.name, h('span', { class: 'chip__count' }, String((p.layers || []).length), h('span', { class: 'visually-hidden' }, ' layers'))));
  const chipsLabel = h('span', { class: 'c-stack__chips-label', id: `${base}-chips` }, 'Highlight a product');
  const chipBar = h('div', { class: 'c-stack__chips', role: 'group', 'aria-labelledby': chipsLabel.id }, chipsLabel, chipButtons);
  const stage = h('div', { class: 'c-stack__stage' });

  const body = $('.c-stack__body', root) || root;
  body.prepend(chipBar, stage);
  const staticList = $('.c-stack__static', root);
  if (staticList) staticList.hidden = true;

  render();
  narrowQuery.addEventListener('change', render);
  new ResizeObserver(() => drawSpans()).observe(stage);

  /* ------------------------------------------------------------- views */

  function render() {
    const hadFocus = stage.contains(document.activeElement);
    view = narrowQuery.matches ? accordionView() : tabsView();
    mount(stage, view.el);
    applyProduct(false);
    if (hadFocus && view.controls[state.index]) view.controls[state.index].focus();
  }

  function tabsView() {
    if (state.index < 0) state.index = 0;
    const tabs = layers.map((layer, i) => h('button', {
      type: 'button',
      role: 'tab',
      class: 'c-stack__tile',
      id: `${base}-tab-${i}`,
      'aria-controls': `${base}-panel-${i}`,
      'aria-selected': String(i === state.index),
      tabindex: i === state.index ? '0' : '-1',
      onClick: () => selectTab(i),
    },
    h('span', { class: 'c-stack__tile-num', 'aria-hidden': 'true' }, pad(i + 1)),
    h('span', { class: 'c-stack__tile-name' }, layer.name),
    h('span', { class: 'c-stack__tile-verb' }, layer.verb),
    h('span', { class: 'c-stack__tile-product' }, h('span', { class: 'tag' }, productName(layer.product))),
    i < layers.length - 1 ? h('span', { class: 'c-stack__arrow', 'aria-hidden': 'true' }) : null));
    roving(tabs, { orientation: 'horizontal', onSelect: (i) => selectTab(i) });

    const panels = layers.map((layer, i) => h('div', {
      class: 'c-stack__panel',
      role: 'tabpanel',
      id: `${base}-panel-${i}`,
      'aria-labelledby': `${base}-tab-${i}`,
      tabindex: '0',
      hidden: i !== state.index,
    }, h('div', { class: 'c-stack__panel-swap' }, panelContent(layer, i, true))));

    const spans = h('div', { class: 'c-stack__spans', 'aria-hidden': 'true' });
    const el = h('div', { class: 'c-stack__wide' },
      h('div', { class: 'c-stack__track' }, spans, h('div', { class: 'c-stack__tabs', role: 'tablist', 'aria-label': 'Layers of the stack' }, tabs)),
      h('div', { class: 'c-stack__panels' }, panels));
    return { mode: 'tabs', el, controls: tabs, items: tabs, panels, spans };
  }

  function accordionView() {
    const steps = layers.map((layer, i) => {
      const open = i === state.index;
      const btn = h('button', {
        type: 'button',
        class: 'c-stack__step-btn',
        id: `${base}-step-${i}`,
        'aria-expanded': String(open),
        'aria-controls': `${base}-region-${i}`,
        onClick: () => toggleStep(i),
      },
      h('span', { class: 'c-stack__step-node', 'aria-hidden': 'true' }, pad(i + 1)),
      h('span', { class: 'c-stack__step-label' },
        h('span', { class: 'c-stack__step-name' }, layer.name),
        h('span', { class: 'c-stack__step-verb' }, layer.verb)),
      h('span', { class: 'c-stack__step-product' }, h('span', { class: 'tag' }, productName(layer.product))));
      const panel = h('div', {
        class: 'c-stack__step-panel',
        id: `${base}-region-${i}`,
        role: 'region',
        'aria-labelledby': btn.id,
        hidden: !open,
      }, panelContent(layer, i, false));
      const li = h('li', { class: 'c-stack__step' }, h('h3', { class: 'c-stack__step-head' }, btn), panel);
      return { li, btn, panel };
    });
    const el = h('ol', { class: 'c-stack__steps', 'aria-label': 'Layers of the stack' }, steps.map((s) => s.li));
    return { mode: 'accordion', el, controls: steps.map((s) => s.btn), items: steps.map((s) => s.li), panels: steps.map((s) => s.panel) };
  }

  /* ----------------------------------------------------------- actions */

  function selectTab(i) {
    if (i === state.index) return;
    state.index = i;
    view.controls.forEach((tab, j) => {
      tab.setAttribute('aria-selected', String(j === i));
      tab.tabIndex = j === i ? 0 : -1;
    });
    view.panels.forEach((panel, j) => { panel.hidden = j !== i; });
    fadeIn(view.panels[i].firstElementChild);
  }

  // One step open at a time; activating the open step closes it.
  function toggleStep(i) {
    state.index = state.index === i ? -1 : i;
    view.controls.forEach((btn, j) => btn.setAttribute('aria-expanded', String(j === state.index)));
    view.panels.forEach((panel, j) => { panel.hidden = j !== state.index; });
  }

  function setProduct(id) {
    state.product = id;
    applyProduct(true);
  }

  function applyProduct(say) {
    const prod = state.product ? productById.get(state.product) : null;
    const covered = new Set(prod ? prod.layers : []);
    root.classList.toggle('has-product', Boolean(prod));
    for (const btn of chipButtons) btn.setAttribute('aria-pressed', String(btn.dataset.product === state.product));
    view.items.forEach((el, i) => el.classList.toggle('is-in-product', covered.has(layers[i].id)));
    drawSpans();
    if (!say) return;
    ctx.announce(prod
      ? `${prod.name} covers ${listText(layers.filter((l) => covered.has(l.id)).map((l) => l.name))}.`
      : 'No product highlighted.');
  }

  // Dashed annotation boxes around each run of covered tiles, split where
  // the run wraps onto the next row of the grid.
  function drawSpans() {
    if (!view || view.mode !== 'tabs') return;
    const prod = state.product ? productById.get(state.product) : null;
    if (!prod) {
      view.spans.replaceChildren();
      return;
    }
    const origin = view.spans.getBoundingClientRect();
    const segments = [];
    let run = [];
    const flush = () => {
      if (run.length) segments.push(...splitRows(run));
      run = [];
    };
    view.controls.forEach((tab, i) => {
      if (prod.layers.includes(layers[i].id)) run.push(tab);
      else flush();
    });
    flush();
    mount(view.spans, segments.map((seg) => spanBox(seg, prod.name, origin)));
  }

  /* ------------------------------------------------------------ content */

  function panelContent(layer, i, withHead) {
    const prod = productById.get(layer.product);
    const also = products.filter((p) => p.id !== layer.product && (p.layers || []).includes(layer.id));
    const refs = (layer.research || []).map((slug) => pubs[slug]).filter(Boolean);
    const main = h('div', { class: 'c-stack__panel-main' },
      withHead ? h('p', { class: 'c-stack__kicker' }, `Layer ${pad(i + 1)} · ${layer.name}`) : null,
      withHead ? h('h3', { class: 'c-stack__panel-title' }, layer.verb) : null,
      h('p', { class: 'c-stack__panel-text' }, layer.body),
      h('dl', { class: 'c-stack__facts' },
        h('dt', null, 'Paper'),
        h('dd', { class: 'c-stack__paper', html: notation(layer.paper) }),
        h('dt', null, 'Product'),
        h('dd', null, prod ? productLink(prod) : null, also.map((p) => h('span', { class: 'c-stack__also' }, 'Also in', productLink(p))))));
    const side = h('div', { class: 'c-stack__panel-refs' },
      h('p', { class: 'c-stack__refs-title' }, `Research · ${refs.length}`),
      h('ul', { class: 'c-stack__refs c-stack__refs--rich' }, refs.map(refItem)));
    return h('div', { class: 'c-stack__panel-grid' }, main, side);
  }

  function productLink(p) {
    const st = statuses[p.status] || {};
    return h('span', { class: 'c-stack__prod' },
      h('a', { class: 'c-stack__product', href: `${data.productsUrl || '/products/'}#${p.id}` }, p.name),
      st.label ? h('span', { class: `badge badge--${st.tone || 'muted'}` }, st.label) : null);
  }

  function productName(id) {
    const p = productById.get(id);
    return p ? p.name : id;
  }

  function fadeIn(el) {
    if (!el || ctx.reducedMotion) return;
    el.classList.add('is-swapping');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('is-swapping')));
  }
}

/* ------------------------------------------------------------------ helpers */

function refItem(pub) {
  const cut = pub.title.indexOf(': ');
  const title = cut > 0
    ? [h('span', { class: 'c-stack__ref-short' }, pub.title.slice(0, cut)), h('span', { class: 'c-stack__ref-rest' }, `: ${pub.title.slice(cut + 2)}`)]
    : h('span', { class: 'c-stack__ref-short' }, pub.title);
  return h('li', null, h('span', { class: 'c-stack__venue' }, pub.venue), h('a', { href: pub.url }, title));
}

function splitRows(tabs) {
  const rows = new Map();
  for (const tab of tabs) {
    const top = Math.round(tab.getBoundingClientRect().top);
    if (!rows.has(top)) rows.set(top, []);
    rows.get(top).push(tab);
  }
  return [...rows.values()];
}

function spanBox(seg, label, origin) {
  const pad = 8;
  const first = seg[0].getBoundingClientRect();
  const last = seg[seg.length - 1].getBoundingClientRect();
  const bottom = Math.max(...seg.map((t) => t.getBoundingClientRect().bottom));
  return h('span', {
    class: 'c-stack__span',
    dataset: { label },
    style: {
      left: `${first.left - origin.left - pad}px`,
      top: `${first.top - origin.top - pad}px`,
      width: `${last.right - first.left + 2 * pad}px`,
      height: `${bottom - first.top + 2 * pad}px`,
    },
  });
}

// "State S_t · consolidation" → notation tokens set as math, the rest as text.
function notation(text) {
  return String(text).split(/(\s+)/)
    .map((token) => (/[_^]/.test(token) ? `<span class="math">${mathHTML(token)}</span>` : escapeHTML(token)))
    .join('');
}

const pad = (n) => String(n).padStart(2, '0');

function listText(words) {
  if (words.length < 2) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}
