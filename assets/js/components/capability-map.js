// Capability map (Fig. 2 of the survey). The include renders the whole band
// diagram; this module enhances it in place, so nothing moves on upgrade:
// - each group becomes selectable and fills a detail panel (band, scope,
//   members, and where each member is coded again in Tables I and IV);
// - "Highlight my work" marks the author's own models (Table I rows that
//   carry `own`) wherever they appear on the map.
import { h, $, $$, uid, mount } from '../lib/dom.js';

const PART = /\s*\/\s*/;

export default function init(root, ctx) {
  const data = ctx.data(root, 'capability-map');
  if (!data || !Array.isArray(data.bands)) return;
  const plot = $('.c-capability-map__plot', root);
  const groupEls = $$('.c-capability-map__group', root);
  if (!plot || !groupEls.length) return;

  const own = data.own || {};
  const frontier = data.bands.find((b) => b.groups && b.groups.length);
  const panelId = uid('cm-detail');
  const state = { selected: null, mine: false };

  const groups = groupEls.map((el) => describeGroup(el, data.bands)).filter(Boolean);
  const mineMembers = $$('.c-capability-map__member', root).filter((li) => own[li.textContent.trim()]);
  mineMembers.forEach((li) => li.classList.add('is-mine'));

  /* ------------------------------------------------------------ toolbar */
  const mineToggle = h('button', {
    type: 'button',
    class: 'chip',
    'aria-pressed': 'false',
    onClick: () => setMine(!state.mine),
  }, 'Highlight my work', h('span', { class: 'chip__count', 'aria-hidden': 'true' }, String(Object.keys(own).length)));
  const mineNote = h('p', { class: 'c-capability-map__mine-note', hidden: true });
  mineNote.append(...mineSentence(own, data.bands));
  const toolbar = h('div', { class: 'c-capability-map__toolbar' }, mineToggle, mineNote);
  if (!Object.keys(own).length) mineToggle.hidden = true;
  plot.before(toolbar);

  /* ------------------------------------------------------- detail panel */
  const panel = h('div', { class: 'c-capability-map__detail', id: panelId });
  const panelBody = h('div', { class: 'c-capability-map__detail-panel' });
  panel.append(panelBody);
  plot.after(panel);

  for (const g of groups) upgradeGroup(g, panelId, () => select(state.selected === g ? null : g));
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.selected) {
      const btn = state.selected.button;
      select(null);
      if (root.contains(document.activeElement)) btn.focus();
    }
  });

  renderDetail(null);

  function select(g) {
    state.selected = g;
    root.classList.toggle('has-selection', Boolean(g));
    for (const other of groups) {
      const on = other === g;
      other.el.classList.toggle('is-selected', on);
      other.button.setAttribute('aria-pressed', String(on));
    }
    for (const band of $$('.c-capability-map__band', root)) {
      band.classList.toggle('is-selected-band', Boolean(g) && band.dataset.band === g.band.id);
    }
    renderDetail(g);
    ctx.announce(g
      ? `${g.group.name}: ${g.band.label} band, scope ${g.group.scope}, ${count(g.group.members.length, 'member')}.`
      : 'Selection cleared.');
  }

  function setMine(on) {
    state.mine = on;
    mineToggle.setAttribute('aria-pressed', String(on));
    root.classList.toggle('is-mine-on', on);
    mineNote.hidden = !on;
    if (on) ctx.announce(mineNote.textContent);
  }

  function renderDetail(g) {
    panel.classList.toggle('is-active', Boolean(g));
    const content = g ? detailFor(g) : [
      h('p', { class: 'c-capability-map__detail-hint' }, 'Select a group to see its band, scope and members, and where the paper codes each member again.'),
    ];
    if (ctx.reducedMotion) {
      mount(panelBody, content);
      return;
    }
    panelBody.classList.add('is-swapping');
    mount(panelBody, content);
    requestAnimationFrame(() => requestAnimationFrame(() => panelBody.classList.remove('is-swapping')));
  }

  function detailFor(g) {
    const { band, group } = g;
    const items = group.members.map((name) => memberItem(name));
    const notes = [];
    if (band === frontier) notes.push('This is the highest band any surveyed system reaches: the current frontier.');
    return [
      h('div', { class: 'c-capability-map__detail-top' },
        h('p', { class: 'c-capability-map__detail-kicker' }, h('b', null, `${band.label} band`), ` · Scope · ${group.scope} · ${count(group.members.length, 'member')}`),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => { const btn = g.button; select(null); btn.focus(); } }, 'Clear'),
      ),
      h('h3', { class: 'c-capability-map__detail-title' }, group.name),
      h('ul', { class: 'c-capability-map__detail-list', 'aria-label': 'Members' }, items),
      notes.length ? h('p', { class: 'c-capability-map__detail-foot' }, notes.join(' ')) : null,
    ];
  }

  // A member, its publication when it is the author's model, and links to
  // the tables of the paper that code it again.
  function memberItem(name) {
    const mine = own[name];
    const refs = [];
    if (mine) refs.push(h('span', { class: 'c-capability-map__ref c-capability-map__ref--mine' }, 'My work'));
    if (inTable(name, data.lineage)) refs.push(refLink('Table I', data.links.lineage, name, 'representation lineage'));
    if (inTable(name, data.audit)) refs.push(refLink('Table IV', data.links.audit, name, 'statefulness audit'));
    const label = mine
      ? h('a', { href: mine.url, title: `${mine.title} (${mine.venue})` }, name)
      : h('span', null, name);
    return h('li', { class: refs.length ? null : 'is-plain' }, label, refs);
  }
}

/* ----------------------------------------------------------------- helpers */

function describeGroup(el, bands) {
  const [bandId, index] = String(el.dataset.group || '').split(':');
  const band = bands.find((b) => b.id === bandId);
  const group = band && band.groups && band.groups[Number(index)];
  return group ? { el, band, group, button: null } : null;
}

// The group's head line becomes its toggle button; the member list stays a
// real list next to it, and a click anywhere on the cluster toggles it too.
function upgradeGroup(g, panelId, onToggle) {
  const head = $('.c-capability-map__group-head', g.el);
  const button = h('button', { type: 'button', class: 'c-capability-map__group-btn', 'aria-pressed': 'false', 'aria-controls': panelId });
  if (head) {
    button.append(...head.childNodes);
    head.replaceWith(button);
  } else {
    button.textContent = g.group.name;
    g.el.prepend(button);
  }
  g.button = button;
  g.el.classList.add('is-enhanced');
  g.el.addEventListener('click', (event) => {
    if (event.target.closest('a')) return;
    onToggle();
  });
}

function refLink(text, href, member, what) {
  return h('a', { class: 'c-capability-map__ref', href, 'aria-label': `${text}, ${what}: ${member}` }, text);
}

// Exact match on the parts of a name, so "ColPali / ViDoRe" meets "ViDoRe"
// but "DocVQA" never meets "MP-DocVQA".
function inTable(name, names) {
  if (!Array.isArray(names)) return false;
  const mine = String(name).split(PART);
  return names.some((n) => String(n).split(PART).some((p) => mine.includes(p)));
}

function mineSentence(own, bands) {
  const names = Object.keys(own);
  if (!names.length) return [];
  const homes = new Set();
  for (const b of bands) {
    for (const g of b.groups || []) if (g.members.some((m) => own[m])) homes.add(b.label);
  }
  const links = names.map((n) => [h('a', { href: own[n].url }, n), ` (${own[n].venue})`]);
  const where = homes.size === 1 ? `all sit in the ${[...homes][0]} band.` : `sit in the ${listText([...homes])} bands.`;
  return ['My own models, ', ...joinNodes(links), `, ${where}`];
}

function joinNodes(items) {
  const out = [];
  items.forEach((item, i) => {
    if (i > 0) out.push(i === items.length - 1 ? ' and ' : ', ');
    out.push(...item);
  });
  return out;
}

function listText(words) {
  if (words.length < 2) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
