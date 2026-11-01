// Five outcomes of temporal supersession, on a stream (paper page, #reconcile).
//
// The four fictional documents of _data/demo.yml are read one at a time. Each
// read replays the stream (reconcile-model.js): every field meets the claims
// already stored and gets the outcome the demo assigns it. Cards explain each
// outcome, a tally counts them, and the claims ledger (the temporal validity
// index) shows the result: a superseded claim gets its valid-to date. Names
// and descriptions come from _data/paper.yml; outcomes the paper names
// without defining them are labelled as our reading.

import { h, mount, uid } from '../lib/dom.js';
import { replay, icon, outcomeName, shortRef, fmtDate, withSymbols, NEW } from './reconcile-model.js';

// How the read value relates to the stored one: a short visible connector
// for compact lines, and the words a screen reader hears instead.
const RELATION = {
  supersede: ['→', 'replaced by'],
  'scope-coexist': ['+', 'stands beside'],
  support: ['=', 'corroborated by'],
  'retain-conflict': ['vs', 'in conflict with'],
  escalate: ['vs', 'contradicted by'],
};

export default function init(root, ctx) {
  const data = ctx.data(root, 'reconcile');
  const app = root.querySelector('[data-app]');
  const alt = root.querySelector('[data-alt]');
  const docs = (data && Array.isArray(data.documents) ? data.documents : []).filter((d) => Array.isArray(d.fields));
  const outcomes = (data && Array.isArray(data.outcomes) ? data.outcomes : []);
  if (!app || !docs.length || !outcomes.length) return;

  const legendIds = [...outcomes.map((o) => o.id), NEW];
  const state = { count: 0, focus: '' };
  const base = uid('rc');
  const typeset = (text) => withSymbols(text, { sym: 'c-reconcile__sym', keep: 'c-reconcile__keep' });
  const regionOf = (doc, field) => (doc.regions || []).find((r) => r.id === field.region);
  const place = (doc, field) => {
    const r = regionOf(doc, field);
    return r ? r.section || r.type.toLowerCase() : '';
  };
  const cite = (doc, field) => `${shortRef(doc.ref)} ${place(doc, field)}`.trim();
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function counts(run, doc) {
    const out = Object.fromEntries(legendIds.map((id) => [id, 0]));
    for (const e of run.events) if (!doc || e.doc === doc) out[e.outcome] = (out[e.outcome] || 0) + 1;
    return out;
  }

  function badge(outcome, cls = 'c-reconcile__oc') {
    return h('span', { class: cls, dataset: { outcome } }, icon(outcome, 'c-reconcile__oc-icon'), outcomeName(outcome, outcomes));
  }

  /* ------------------------------------------------------------ stream */

  const nodes = docs.map((doc) => h('li', { class: 'c-reconcile__node' },
    h('span', { class: 'c-reconcile__dot', 'aria-hidden': 'true' }),
    h('span', { class: 'c-reconcile__nref' }, shortRef(doc.ref)),
    h('span', { class: 'c-reconcile__nkind' }, doc.kind),
    h('span', { class: 'c-reconcile__ndate' }, fmtDate(doc.date),
      doc.effective && h('span', { class: 'c-reconcile__neff' }, `in force ${fmtDate(doc.effective)}`)),
    h('span', { class: 'c-reconcile__nsum' }),
    h('span', { class: 'visually-hidden', 'data-node-state': '' })));
  const stream = h('ol', { class: 'c-reconcile__stream', 'aria-label': 'Document stream, in reading order' }, nodes);

  /* ----------------------------------------------------------- controls */

  const nextBtn = h('button', { type: 'button', class: 'btn c-reconcile__next', onClick: () => go(state.count + 1) },
    'Read next document', icon('supersede', 'c-reconcile__btn-icon'));
  const backBtn = h('button', { type: 'button', class: 'btn btn--secondary', onClick: () => go(state.count - 1) }, 'Back');
  const resetBtn = h('button', { type: 'button', class: 'btn btn--ghost', onClick: () => go(0) }, 'Reset');
  const status = h('p', { class: 'c-reconcile__status', id: `${base}-status` });
  nextBtn.setAttribute('aria-describedby', status.id);
  const controls = h('div', { class: 'c-reconcile__controls' },
    h('div', { class: 'c-reconcile__buttons' }, nextBtn, backBtn, resetBtn), status);

  /* ------------------------------------------------------------- legend */

  const keys = legendIds.map((id) => h('button', {
    type: 'button',
    class: ['c-reconcile__key', id === NEW && 'is-new'],
    'aria-pressed': 'false',
    dataset: { outcome: id },
    onClick: () => setFocus(state.focus === id ? '' : id),
  },
    h('span', { class: 'c-reconcile__key-top', 'aria-hidden': 'true' },
      icon(id, 'c-reconcile__key-icon'),
      h('span', { class: 'c-reconcile__count' }, '0'),
      h('span', { class: 'c-reconcile__delta' })),
    h('span', { class: 'c-reconcile__key-name', 'aria-hidden': 'true' }, outcomeName(id, outcomes))));
  const legend = h('div', { class: 'c-reconcile__legend', role: 'group', 'aria-label': 'Outcomes so far; choose one to highlight it' }, keys);
  const desc = h('div', { class: 'c-reconcile__desc' });

  function setFocus(id) {
    state.focus = id;
    renderLegend(replay(docs, { count: state.count }), replay(docs, { count: Math.max(0, state.count - 1) }));
    applyFocus();
    if (id) {
      const hits = app.querySelectorAll(`[data-tags~="${id}"]`).length;
      ctx.announce(`${outcomeName(id, outcomes)}: ${plural(hits, 'item')} highlighted.`);
    }
  }

  function applyFocus() {
    app.classList.toggle('has-focus', Boolean(state.focus));
    // Elements without an outcome of their own take the focused one's colour.
    if (state.focus) app.dataset.outcome = state.focus;
    else delete app.dataset.outcome;
    for (const el of app.querySelectorAll('[data-tags]')) {
      el.classList.toggle('is-hit', Boolean(state.focus) && el.dataset.tags.split(' ').includes(state.focus));
    }
  }

  function renderLegend(now, prev) {
    const c = counts(now);
    const p = state.count ? counts(prev) : Object.fromEntries(legendIds.map((id) => [id, 0]));
    keys.forEach((btn) => {
      const id = btn.dataset.outcome;
      const delta = c[id] - p[id];
      btn.setAttribute('aria-pressed', String(state.focus === id));
      btn.querySelector('.c-reconcile__count').textContent = String(c[id]);
      btn.querySelector('.c-reconcile__delta').textContent = delta > 0 ? `+${delta}` : '';
      btn.classList.toggle('is-zero', c[id] === 0);
      btn.setAttribute('aria-label', `${outcomeName(id, outcomes)}: ${c[id]} so far${delta > 0 ? `, ${delta} from the last read` : ''}`);
    });
    renderDesc();
  }

  function renderDesc() {
    const o = outcomes.find((x) => x.id === state.focus);
    desc.dataset.outcome = state.focus || '';
    if (state.focus === NEW) {
      mount(desc,
        h('p', { class: 'c-reconcile__desc-head' }, badge(NEW), h('span', { class: 'c-reconcile__reading' }, 'Not one of the paper’s five outcomes')),
        h('p', { class: 'c-reconcile__desc-body' }, 'Memory holds no claim for this field yet, so the observation is written as it is, valid from its document’s date.'));
    } else if (o) {
      mount(desc,
        h('p', { class: 'c-reconcile__desc-head' }, badge(o.id),
          h('span', { class: o.defined ? 'c-reconcile__defined' : 'c-reconcile__reading' },
            o.defined ? 'Defined in the paper' : 'Named in the paper; description is our reading')),
        h('p', { class: 'c-reconcile__desc-body' }, o.body));
    } else {
      const def = outcomes.filter((x) => x.defined).map((x) => x.name.toLowerCase());
      const named = outcomes.filter((x) => !x.defined).map((x) => x.name.toLowerCase());
      mount(desc, h('p', { class: 'c-reconcile__desc-body c-reconcile__desc-hint' },
        `Choose an outcome above to highlight its cards and ledger rows. The paper defines ${def.join(' and ')}; `,
        `${named.join(', ')} are named only, so their descriptions here are our reading.`));
    }
  }

  /* --------------------------------------------------------------- feed */

  const feedTitle = `${base}-feed`;
  const feedBody = h('div', { class: 'c-reconcile__feed-body' });
  const feed = h('section', { class: 'c-reconcile__panel c-reconcile__feed', 'aria-labelledby': feedTitle },
    h('div', { class: 'c-reconcile__phead' },
      h('h3', { class: 'c-reconcile__ptitle', id: feedTitle }, 'Outcomes'),
      h('p', { class: 'c-reconcile__psub' }, 'latest read first')),
    feedBody);

  /** Stored side and read side of an outcome, with the claims involved. */
  function sides(ev) {
    if (ev.outcome === 'supersede') return ev.closed;
    if (ev.outcome === 'support') return ev.target ? [ev.target] : [];
    return ev.active;
  }

  function valueBox(kicker, value, scope, src) {
    return h('div', { class: 'c-reconcile__vbox' },
      h('span', { class: 'c-reconcile__vk' }, kicker),
      h('span', { class: 'c-reconcile__vv' }, typeset(value)),
      h('span', { class: 'c-reconcile__vm' }, [scope, src].filter(Boolean).join(' · ')));
  }

  function intervalText(ev) {
    const c = ev.claim;
    const old = sides(ev);
    const q = (x) => `“${x.value}”`;
    switch (ev.outcome) {
      case 'supersede':
        return old.map((x) => `${q(x)} valid to ${x.to}`).concat(`${q(c)} valid from ${c.from}`).join(' · ');
      case 'scope-coexist':
        return `Both open: ${old.map((x) => `${q(x)} (${x.scope || 'no scope'})`).join(', ')} and ${q(c)} (${c.scope || 'no scope'}) from ${c.from}`;
      case 'support':
        return old.length ? `No new claim: ${q(old[0])} stays open, now with a second source` : 'No new claim';
      case 'retain-conflict':
        return `Both kept from ${c.from}, flagged as conflicting`;
      case 'escalate':
        return old.length ? `No change: ${q(old[0])} stays in force until a person decides` : 'No change until a person decides';
      default:
        return `Valid from ${c.from}`;
    }
  }

  function fullCard(ev) {
    const old = sides(ev);
    const read = ev.field.value;
    return h('li', { class: 'c-reconcile__card', dataset: { outcome: ev.outcome, tags: ev.outcome } },
      h('div', { class: 'c-reconcile__chead' },
        badge(ev.outcome),
        h('span', { class: 'c-reconcile__cfield' }, ev.field.label)),
      h('div', { class: 'c-reconcile__vs' },
        old.length
          ? valueBox('Stored', old.map((x) => x.value).join(', '), old[0].scope, old.map((x) => cite(x.doc, x.field)).join(', '))
          : valueBox('Stored', '—', '', 'nothing yet'),
        h('span', { class: 'c-reconcile__rel' }, icon(ev.outcome), h('span', { class: 'visually-hidden' }, (RELATION[ev.outcome] || [])[1] || 'then')),
        valueBox('Read', read, ev.field.scope, cite(ev.doc, ev.field))),
      h('p', { class: 'c-reconcile__interval' }, intervalText(ev)),
      ev.field.note && h('p', { class: 'c-reconcile__note' }, typeset(ev.field.note)));
  }

  function compactCard(ev) {
    const old = sides(ev);
    const rel = RELATION[ev.outcome] || ['→', 'then'];
    // The arrow is drawn (the served fonts lack it); the other connectors are text.
    const connector = rel[0] === '→' ? icon('supersede', 'c-reconcile__larrow-icon') : rel[0];
    return h('li', { class: 'c-reconcile__line', dataset: { outcome: ev.outcome, tags: ev.outcome } },
      icon(ev.outcome, 'c-reconcile__line-icon'),
      h('span', { class: 'c-reconcile__ltext' },
        h('span', { class: 'visually-hidden' }, `${outcomeName(ev.outcome, outcomes)}: `),
        h('span', { class: 'c-reconcile__lfield' }, ev.field.label), ' ',
        old.length > 0 && [
          h('span', { class: 'c-reconcile__lold' }, typeset(old.map((x) => x.value).join(', '))),
          h('span', { class: 'c-reconcile__larrow', 'aria-hidden': 'true' }, connector),
          h('span', { class: 'visually-hidden' }, ` ${rel[1]} `),
        ],
        h('span', { class: 'c-reconcile__lnew' }, typeset(ev.field.value))));
  }

  function newClaims(evs, latest) {
    if (!evs.length) return null;
    if (!latest && evs.length > 2) {
      return h('ul', { class: 'c-reconcile__lines' },
        h('li', { class: 'c-reconcile__line', dataset: { outcome: NEW, tags: NEW } },
          icon(NEW, 'c-reconcile__line-icon'),
          h('span', { class: 'c-reconcile__ltext' },
            h('span', { class: 'c-reconcile__lfield' }, `${plural(evs.length, 'new claim')}: `),
            evs.map((e) => e.field.label.toLowerCase()).join(', '))));
    }
    return h('ul', { class: 'c-reconcile__lines' }, evs.map(compactCard));
  }

  function group(doc, run, latest) {
    const evs = run.events.filter((e) => e.doc === doc);
    const reconciled = evs.filter((e) => e.outcome !== NEW);
    const fresh = evs.filter((e) => e.outcome === NEW);
    const sum = counts(run, doc);
    return h('section', { class: ['c-reconcile__group', latest && 'is-latest'], 'aria-label': `${doc.ref}: ${summaryText(sum)}` },
      h('header', { class: 'c-reconcile__ghead' },
        h('span', { class: 'c-reconcile__gref' }, shortRef(doc.ref)),
        h('span', { class: 'c-reconcile__gtitle' }, doc.title),
        h('span', { class: 'c-reconcile__gdate' }, doc.effective
          ? `signed ${fmtDate(doc.date)}, in force ${fmtDate(doc.effective)}`
          : fmtDate(doc.date))),
      reconciled.length > 0 && (latest
        ? h('ol', { class: 'c-reconcile__cards' }, reconciled.map(fullCard))
        : h('ul', { class: 'c-reconcile__lines' }, reconciled.map(compactCard))),
      newClaims(fresh, latest));
  }

  function summaryText(sum) {
    const parts = legendIds.filter((id) => sum[id]).map((id) => `${sum[id]} ${outcomeName(id, outcomes).toLowerCase()}`);
    return parts.join(', ') || 'no fields';
  }

  function renderFeed(now) {
    if (!state.count) {
      mount(feedBody, h('div', { class: 'c-reconcile__empty' },
        h('p', { class: 'c-reconcile__empty-title' }, 'Memory is empty.'),
        h('p', null, `Read ${docs[0].ref} to start: with nothing stored yet, every field it contains is a new claim.`)));
      return;
    }
    const read = docs.slice(0, state.count).reverse();
    mount(feedBody, read.map((doc, i) => group(doc, now, i === 0)));
  }

  /* ------------------------------------------------------------- ledger */

  const ledgerTitle = `${base}-ledger`;
  const ledgerSub = h('p', { class: 'c-reconcile__psub' });
  const tbody = h('tbody');
  const queueEl = h('div', { class: 'c-reconcile__queue-wrap' });
  const ledger = h('div', { class: 'c-reconcile__panel c-reconcile__ledger', role: 'group', 'aria-labelledby': ledgerTitle },
    h('div', { class: 'c-reconcile__phead' },
      h('h3', { class: 'c-reconcile__ptitle', id: ledgerTitle }, 'Claims ledger'),
      ledgerSub),
    h('div', { class: 'table-wrap c-reconcile__twrap', role: 'region', tabindex: '0', 'aria-labelledby': ledgerTitle },
      h('table', { class: 'table c-reconcile__ltable' },
        h('thead', null, h('tr', null, ['Field', 'Value', 'Valid from', 'Valid to', 'Source'].map((t) => h('th', { scope: 'col' }, t)))),
        tbody)),
    queueEl);

  function ledgerRow(c, first, was, contradicted) {
    const added = !was;
    const closedNow = Boolean(c.to && was && !was.to);
    const corroboratedNow = Boolean(was && c.corroborations.length > was.corroborations.length);
    const conflictNow = Boolean(was && c.conflicts.length > was.conflicts.length);
    const tags = [c.outcome,
      c.corroborations.length && 'support',
      c.conflicts.length && 'retain-conflict',
      c.closedBy && 'supersede',
      c.coexists.length && 'scope-coexist',
      contradicted.has(c.id) && 'escalate'].filter(Boolean);
    const change = added ? ' (added by this read)' : (closedNow || corroboratedNow || conflictNow) ? ' (changed by this read)' : '';
    return h('tr', {
      class: [added && 'is-added', (closedNow || corroboratedNow || conflictNow) && 'is-changed', !first && 'is-cont', c.to && 'is-closed'],
      dataset: { tags: [...new Set(tags)].join(' ') },
    },
      h('th', { scope: 'row' }, c.label, change && h('span', { class: 'visually-hidden' }, change)),
      h('td', { class: 'c-reconcile__lv' },
        h('span', { class: 'c-reconcile__lvalue' }, typeset(c.value)),
        c.scope && h('span', { class: 'c-reconcile__lscope' }, c.scope),
        c.conflicts.length > 0 && h('span', { class: ['c-reconcile__flag', conflictNow && 'is-now'], dataset: { outcome: 'retain-conflict' } },
          icon('retain-conflict'), 'conflict'),
        c.corroborations.length > 0 && h('span', { class: ['c-reconcile__flag', corroboratedNow && 'is-now'], dataset: { outcome: 'support' } },
          icon('support'), 'corroborated')),
      h('td', { class: 'c-reconcile__ldate' }, c.from),
      h('td', { class: 'c-reconcile__ldate' }, c.to
        ? (closedNow ? h('mark', null, c.to) : c.to)
        : h('span', { class: 'c-reconcile__open' }, 'open')),
      h('td', { class: 'c-reconcile__lsrc' }, cite(c.doc, c.field),
        c.corroborations.map((x) => [h('br'), h('span', { class: 'c-reconcile__also' }, `+ ${cite(x.doc, x.field)}`)])));
  }

  function renderLedger(now, prev) {
    ledgerSub.textContent = `after ${state.count} of ${docs.length} documents`;
    if (!now.claims.length) {
      mount(tbody, h('tr', null, h('td', { colspan: 5, class: 'c-reconcile__lempty' }, 'No claims yet.')));
    } else {
      const was = new Map((state.count ? prev.claims : []).map((c) => [c.id, c]));
      const order = [];
      for (const c of now.claims) if (!order.includes(c.key)) order.push(c.key);
      // Claims an escalated observation contradicts are part of that outcome.
      const contradicted = new Set(now.queue.flatMap((q) => q.against.map((c) => c.id)));
      mount(tbody, order.flatMap((key) => now.claims.filter((c) => c.key === key)
        .map((c, i) => ledgerRow(c, i === 0, was.get(c.id), contradicted))));
    }
    mount(queueEl, now.queue.length > 0 && h('p', { class: 'c-reconcile__queue', dataset: { tags: 'escalate' } },
      icon('escalate', 'c-reconcile__queue-icon'),
      h('span', null, h('b', null, 'Awaiting review, not in the ledger: '),
        now.queue.map((q) => `${q.field.label} “${q.field.value}” (${cite(q.doc, q.field)})${q.against.length ? `, against ${q.against.map((a) => `“${a.value}”`).join(', ')}` : ''}`).join('; '),
        '.')));
  }

  /* ------------------------------------------------------------ render */

  function renderStream(now) {
    nodes.forEach((node, i) => {
      const read = i < state.count;
      node.classList.toggle('is-read', read);
      node.classList.toggle('is-current', i === state.count - 1);
      node.classList.toggle('is-next', i === state.count);
      node.classList.toggle('is-linked', i + 1 < state.count);
      const sum = counts(now, docs[i]);
      mount(node.querySelector('.c-reconcile__nsum'), read
        ? legendIds.filter((id) => sum[id]).map((id) => h('span', { class: 'c-reconcile__chip', dataset: { outcome: id }, title: outcomeName(id, outcomes) },
          icon(id), String(sum[id])))
        : null);
      node.querySelector('[data-node-state]').textContent = read ? `, read: ${summaryText(sum)}` : (i === state.count ? ', next' : ', not read yet');
    });
  }

  function renderControls() {
    const done = state.count >= docs.length;
    nextBtn.setAttribute('aria-disabled', String(done));
    backBtn.setAttribute('aria-disabled', String(state.count === 0));
    resetBtn.setAttribute('aria-disabled', String(state.count === 0));
    const next = docs[state.count];
    mount(status,
      h('b', null, `${state.count} of ${docs.length} read`),
      next ? [' · Next: ', h('span', { class: 'c-reconcile__status-ref' }, next.ref), ` (${next.kind.toLowerCase()}, ${fmtDate(next.date)})`] : ' · the stream is complete');
  }

  function render() {
    const now = replay(docs, { count: state.count });
    const prev = replay(docs, { count: Math.max(0, state.count - 1) });
    renderStream(now);
    renderControls();
    renderLegend(now, prev);
    renderFeed(now);
    renderLedger(now, prev);
    applyFocus();
    return now;
  }

  function go(n) {
    const count = Math.min(docs.length, Math.max(0, n));
    if (count === state.count) return;
    const forward = count > state.count;
    state.count = count;
    app.classList.toggle('is-stepping', forward && !ctx.reducedMotion);
    const now = render();
    if (!count) ctx.announce('Reset: memory is empty.');
    else {
      const doc = docs[count - 1];
      ctx.announce(forward
        ? `Read ${doc.ref}: ${summaryText(counts(now, doc))}. ${now.claims.length} claims in the ledger.`
        : `Back to ${count} of ${docs.length} read; ${now.claims.length} claims in the ledger.`);
    }
  }

  mount(app,
    h('div', { class: 'c-reconcile__top' }, stream, controls),
    h('div', { class: 'c-reconcile__keys' }, legend, desc),
    h('div', { class: 'c-reconcile__main' }, feed, ledger));
  app.hidden = false;
  if (alt) alt.open = false;
  render();
}
