// Verifiable forgetting: run an erasure request for the fictional SOW-2
// through the five levels of Fig. 6, one level at a time.
//
// The include lists the five levels. This module turns the list into a ladder
// that is applied level by level (Next level / Run all / Reset), shows where
// SOW-2 still lives after each level, and probes the state with two
// questions: one about the erased document (does it still leak?) and one
// about knowledge that must survive. Leakage is qualitative: present or
// removed. Levels 4 and 5 are described, not demonstrated.

import { h, $, mount } from '../lib/dom.js';
import { math } from '../lib/math.js';

const STEP_MS = 800; // Run all: pause between levels
const TODAY = 2; // current Document AI implements Levels 1–2

const NOTATION = /(?<![\p{L}\p{N}])\p{L}_[\p{L}\p{N}]+/gu;
function rich(text) {
  const str = String(text);
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of str.matchAll(NOTATION)) {
    frag.append(str.slice(last, m.index), math('span', m[0], { class: 'math' }));
    last = m.index + m[0].length;
  }
  frag.append(str.slice(last));
  return frag;
}

export default function init(root, ctx) {
  const data = ctx.data(root, 'unlearning');
  const list = $('[data-unlearning-levels]', root);
  if (!data || !data.unlearning || !data.demo || !list) return;
  const levels = data.unlearning.levels || [];
  const erase = data.demo.deletion_request || {};
  const docs = Object.fromEntries((data.demo.documents || []).map((d) => [d.id, d]));
  const target = docs[erase.target];
  const msa = (data.demo.documents || []).find((d) => d.id !== erase.target && d.fields.some((f) => f.key === 'liability_cap'));
  if (!levels.length || !target || !msa) return;

  const effects = Object.fromEntries((erase.effects || []).map((e) => [e.level, e.text]));
  const demonstrated = (n) => Boolean(effects[n]);
  const exception = target.fields.find((f) => f.scope);
  const general = msa.fields.find((f) => f.key === (exception ? exception.key : 'liability_cap'));
  const regionOf = (doc, id) => doc.regions.find((r) => r.id === id) || {};
  const srcOf = (doc, field) => `${doc.ref.replace(/^([A-Z]+)-\d{4}-\d+$/, '$1')} ${regionOf(doc, field.region).section || ''}`.trim();
  const sections = target.regions.filter((r) => r.section).map((r) => r.section);

  const view = { applied: 0, stop: false, running: false, timer: 0 };

  /* ---- where the erased document lives, and which level removes it */
  const stores = [
    { level: 1, name: 'Raw file', what: `${target.ref} · page image and text` },
    { level: 2, name: 'Embeddings and graph nodes', what: `${sections.join(', ')} · node ${target.ref}` },
    exception && { level: 3, name: 'Semantic store', sym: 'K_t', what: `${exception.label}: ${exception.scope} exception, ${exception.value}` },
    { level: 4, name: 'Model weights', sym: 'θ', what: 'whatever the model absorbed' },
    { level: 5, name: 'Certificate', what: 'none issued' },
  ].filter(Boolean);

  /* ---- controls */
  const nextBtn = h('button', { type: 'button', class: 'btn c-unlearning__next', onClick: () => { halt(); apply(view.applied + 1); } });
  const runBtn = h('button', { type: 'button', class: 'btn btn--secondary', onClick: runAll }, 'Run all');
  const resetBtn = h('button', { type: 'button', class: 'btn btn--ghost', onClick: () => { halt(); apply(0); } }, 'Reset');
  const stopChip = h('button', {
    type: 'button', class: 'chip c-unlearning__stop', 'aria-pressed': 'false',
    onClick: () => {
      view.stop = !view.stop;
      stopChip.setAttribute('aria-pressed', String(view.stop));
      halt();
      if (view.stop && view.applied > TODAY) apply(TODAY);
      else render();
    },
  }, `Stop where today’s systems stop (after Level ${TODAY})`);

  const request = h('div', { class: 'c-unlearning__request' },
    h('p', { class: 'c-unlearning__request-k' }, rich('Deletion request X_del')),
    h('p', { class: 'c-unlearning__request-v' }, `“${erase.reason}”`),
    h('p', { class: 'c-unlearning__request-doc' }, `${target.ref} · ${target.title}`));
  const controls = h('div', { class: 'c-unlearning__controls' },
    h('div', { class: 'cluster c-unlearning__buttons', role: 'group', 'aria-label': `Run the erasure request for ${target.ref}` }, nextBtn, runBtn, resetBtn),
    stopChip);

  /* ---- ladder: enhance the static list */
  const rungs = levels.map((l) => {
    const li = $(`[data-level="${l.level}"]`, list);
    const out = h('p', { class: 'c-unlearning__effect', hidden: true });
    if (li) $('.c-unlearning__rung', li).append(out);
    return { level: l.level, li, out };
  });
  const todayLine = h('li', { class: 'c-unlearning__today', 'aria-hidden': 'true' },
    h('span', {}, `Current Document AI stops here`));
  const afterToday = rungs.find((r) => r.level === TODAY);
  if (afterToday && afterToday.li) afterToday.li.after(todayLine);

  /* ---- stores and probes */
  const storeList = h('ul', { class: 'c-unlearning__stores' });
  const leak = h('div', { class: 'c-unlearning__probes' });
  const status = h('p', { class: 'c-unlearning__status' });
  const callout = h('div', { class: 'c-unlearning__callout', hidden: true });
  const panel = h('div', { class: 'c-unlearning__panel' },
    h('p', { class: 'c-unlearning__panel-title' }, `Where ${target.ref} still lives`),
    storeList, leak);

  const note = $('.c-unlearning__note', root);
  const layout = h('div', { class: 'c-unlearning__layout' }, h('div', { class: 'c-unlearning__ladder' }, list), panel);
  const app = h('div', { class: 'c-unlearning__app' }, request, controls, status, callout, layout);
  const body = $('.c-unlearning__body', root);
  body.prepend(app);
  if (note) app.append(note);

  /* ------------------------------------------------------------ render */

  function probe(question, answer, cite, verdict, tone) {
    return h('div', { class: 'c-unlearning__probe', dataset: { tone } },
      h('p', { class: 'c-unlearning__probe-q' }, question),
      h('p', { class: 'c-unlearning__probe-a' }, h('span', { class: 'c-unlearning__probe-v' }, answer), cite ? h('span', { class: 'c-unlearning__probe-cite' }, rich(cite)) : null),
      h('p', { class: 'c-unlearning__probe-verdict' }, verdict));
  }

  function leakState() {
    if (view.applied === 0) return { key: 'none', label: `${target.ref} on file`, badge: 'badge--muted' };
    if (view.applied < 3) return { key: 'present', label: 'Residual leakage: present', badge: 'badge--warn' };
    return { key: 'removed', label: 'Residual leakage: removed', badge: 'badge--ok' };
  }

  function render() {
    const n = view.applied;
    const atStop = view.stop && n === TODAY;
    nextBtn.textContent = n >= levels.length ? 'All levels applied' : atStop ? `Continue to Level ${n + 1}` : n === 0 ? 'Apply Level 1' : `Apply Level ${n + 1}`;
    nextBtn.setAttribute('aria-disabled', String(n >= levels.length));
    runBtn.setAttribute('aria-disabled', String(n >= levels.length || view.running || atStop));
    runBtn.textContent = view.running ? 'Running…' : 'Run all';

    for (const r of rungs) {
      if (!r.li) continue;
      const done = r.level <= n;
      r.li.classList.toggle('is-done', done);
      r.li.classList.toggle('is-next', r.level === n + 1);
      r.li.classList.toggle('is-held', view.stop && r.level > TODAY && !done);
      r.out.hidden = !done;
      if (done) {
        mount(r.out, demonstrated(r.level)
          ? [h('span', { class: 'c-unlearning__effect-k' }, 'Applied'), ' ', effects[r.level]]
          : [h('span', { class: 'c-unlearning__effect-k' }, 'Not demonstrated here'), ' requires certification.']);
      }
    }
    todayLine.classList.toggle('is-active', view.stop);

    mount(storeList, stores.map((st) => {
      const shown = demonstrated(st.level);
      const state = !shown ? 'na' : n >= st.level ? 'removed' : 'present';
      const label = { na: n >= st.level ? 'not demonstrated' : 'not modelled', removed: `removed · Level ${st.level}`, present: 'present' }[state];
      return h('li', { class: 'c-unlearning__store', dataset: { state } },
        h('span', { class: 'c-unlearning__store-name' }, st.sym ? [math('span', st.sym, { class: 'math' }), ' '] : null, st.name),
        h('span', { class: 'c-unlearning__store-what' }, st.what),
        h('span', { class: 'c-unlearning__store-state' }, label));
    }));

    const ls = leakState();
    const fq = exception ? `${exception.label} for ${exception.scope}?` : 'Erased fact?';
    const fa = n === 0
      ? probe(fq, exception.value, srcOf(target, exception), `${target.ref} is still on file.`, 'none')
      : n < 3
        ? probe(fq, exception.value, 'K_t · source deleted', `Leaks: ${target.ref} is gone, its exception is not.`, 'present')
        : probe(fq, general.value, srcOf(msa, general), `The exception was removed; the general cap answers.`, 'removed');
    const rq = `${general.label} for ${general.scope}?`;
    const ra = probe(rq, general.value, srcOf(msa, general), 'Retained: knowledge that should survive still does.', 'kept');
    mount(leak,
      h('p', { class: 'c-unlearning__probes-head' }, h('span', { class: `badge ${ls.badge}` }, ls.label)),
      h('div', { class: 'c-unlearning__probe-pair' },
        h('div', {}, h('p', { class: 'c-unlearning__probe-k' }, 'Forgetting probe · FF'), fa),
        h('div', {}, h('p', { class: 'c-unlearning__probe-k' }, 'Retention probe · CR'), ra)),
      n >= 3 && data.conjecture ? h('p', { class: 'c-unlearning__caveat' }, 'In general, repair is not proven to reach zero leakage. ', data.conjecture) : null);

    mount(status, n === 0
      ? `No level applied yet. ${target.ref} is everywhere the pipeline put it.`
      : `Level ${n} of ${levels.length} applied: ${levels[n - 1].name}.`);

    callout.hidden = !atStop;
    if (atStop) {
      mount(callout,
        h('p', {}, h('strong', {}, 'Today’s systems stop here. '),
          `The file and its representations are gone, but the semantic store still holds the ${exception.scope.replace(/ services$/, '')} exception (${exception.value}). Continue to Level ${TODAY + 1} to repair it.`));
    }
  }

  function apply(n, { announce = true } = {}) {
    view.applied = Math.max(0, Math.min(levels.length, n));
    render();
    if (!announce) return;
    const k = view.applied;
    if (k === 0) ctx.announce('Reset: no level applied.');
    else {
      const l = levels[k - 1];
      const what = demonstrated(l.level) ? effects[l.level] : 'Not demonstrated here: requires certification.';
      ctx.announce(`Level ${l.level}, ${l.name}. ${what} ${leakState().label}.`);
    }
  }

  function runAll() {
    if (view.running || runBtn.getAttribute('aria-disabled') === 'true') return;
    const end = view.stop && view.applied < TODAY ? TODAY : levels.length;
    if (ctx.reducedMotion) {
      apply(end);
      return;
    }
    view.running = true;
    const tick = () => {
      if (view.applied >= end) { halt(); return; }
      apply(view.applied + 1);
      if (view.applied >= end) { halt(); return; }
      view.timer = setTimeout(tick, STEP_MS);
    };
    tick();
  }

  function halt() {
    clearTimeout(view.timer);
    if (view.running) {
      view.running = false;
      render();
    }
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) halt(); });
  apply(0, { announce: false });
}
