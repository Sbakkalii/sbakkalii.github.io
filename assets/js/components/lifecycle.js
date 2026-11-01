// State lifecycle figure: Eq. 4's six registers and Algorithm 1 as a stepper.
//
// The include ships the paper's definitions and Algorithm 1 as text. This
// module adds three scenarios, a step rail with Previous / Play / Next /
// Reset, and six registers whose illustrative contents change as the steps
// run: a dashed outline marks a register the current step reads, a tint one
// it writes, and every entry the step adds, changes or removes is marked.

import { h, s, $, $$, mount, uid } from '../lib/dom.js';
import { math } from '../lib/math.js';
import { REGISTERS, buildScenarios, invariant } from './lifecycle-model.js';

const STEP_MS = 1200; // Play: time on a step that does something
const QUIET_MS = 650; // Play: time on a step with nothing to do in this scenario
const MARK = { added: '+', removed: '−', changed: '~' };
const CHANGE_TEXT = { added: 'added by this step', removed: 'removed by this step', changed: 'changed by this step' };
const STATUS_BADGE = {
  quiet: ['Nothing to do', 'badge--muted'],
  off: ['Not triggered', 'badge--muted'],
  skip: ['Skipped', 'badge--muted'],
};

// Notation inside prose (E_t, S_t+1, 𝒰_unl, X_del …), not preceded by a letter.
const NOTATION = /(?<![\p{L}\p{N}])\p{L}_[\p{L}\p{N}]+(?:\+1)?/gu;
// Document references ("MSA-2026-014", "AMD-1 §1"), kept on one line.
const REF = /\b[A-Z]{2,}(?:-\d+)+(?: §[\d.]+)?|\b[A-Z]{2,} §[\d.]+/g;

function withRefs(text) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(REF)) {
    parts.push(text.slice(last, m.index), h('span', { class: 'c-lifecycle__ref' }, m[0]));
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

/** Prose with its notation set as math (real subscripts). */
function rich(text) {
  const str = String(text);
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of str.matchAll(NOTATION)) {
    frag.append(...withRefs(str.slice(last, m.index)), math('span', m[0], { class: 'math' }));
    last = m.index + m[0].length;
  }
  frag.append(...withRefs(str.slice(last)));
  return frag;
}

/** A state component as a coloured symbol chip. */
const symChip = (comp) => h('span', { class: 'sym-chip', dataset: { st: comp.key } }, math('span', comp.symbol, { class: 'math' }));

/** The same prose for a screen-reader announcement ("E_t" → "E t"). */
const spokenText = (text) => String(text).replace(NOTATION, (m) => m.replace('_', ' '));

const ICON_PATHS = {
  prev: ['M14.5 6 8.5 12l6 6'],
  next: ['M9.5 6l6 6-6 6'],
  reset: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5'],
};

function icon(name) {
  const attrs = { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' };
  if (name === 'play') {
    return s('svg', attrs, s('path', { fill: 'currentColor', d: 'M8 5.5v13a.5.5 0 0 0 .77.42l10.2-6.5a.5.5 0 0 0 0-.84L8.77 5.08A.5.5 0 0 0 8 5.5Z' }));
  }
  if (name === 'pause') {
    return s('svg', attrs,
      s('rect', { x: 6.5, y: 5, width: 4, height: 14, rx: 1, fill: 'currentColor' }),
      s('rect', { x: 13.5, y: 5, width: 4, height: 14, rx: 1, fill: 'currentColor' }));
  }
  return s('svg', { ...attrs, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    ICON_PATHS[name].map((d) => s('path', { d })));
}

/* ---------------------------------------------------- register rendering */

const differs = (a, b) => ['lead', 'main', 'tag', 'sub', 'tone'].some((f) => (a[f] || '') !== (b[f] || ''));

/** Entries before and after a step, in display order, with what changed. */
function mergeRows(before, after, keys) {
  const now = new Map(after.map((e) => [e.id, e]));
  const was = new Set(before.map((e) => e.id));
  const rows = before.map((e) => (now.has(e.id)
    ? { entry: now.get(e.id), change: differs(e, now.get(e.id)) ? 'changed' : '' }
    : { entry: e, change: 'removed' }));
  for (const e of after) if (!was.has(e.id)) rows.push({ entry: e, change: 'added' });
  const rank = (e) => (e.key ? keys.indexOf(e.key) : -1);
  // Stable sort: by fact (in document order), then by date.
  return rows.sort((a, b) => rank(a.entry) - rank(b.entry)
    || String(a.entry.order || '').localeCompare(String(b.entry.order || '')));
}

function entryRow({ entry: e, change }) {
  const dataset = {};
  if (e.src) dataset.src = e.src;
  if (e.doc) dataset.doc = e.doc;
  return h('li', {
    class: ['c-lifecycle__entry', change && `is-${change}`, e.tone && `is-${e.tone}`, !e.focus && 'is-extra'],
    dataset,
  },
  h('span', { class: 'c-lifecycle__mark', 'aria-hidden': 'true' }, MARK[change] || ''),
  h('span', { class: 'c-lifecycle__lead' }, e.lead),
  h('span', { class: 'c-lifecycle__main' }, e.main),
  e.tag ? h('span', { class: 'c-lifecycle__tag' }, e.tag) : null,
  e.sub ? h('span', { class: 'c-lifecycle__sub' }, e.sub) : null,
  change ? h('span', { class: 'visually-hidden' }, ` (${CHANGE_TEXT[change]})`) : null);
}

/* ------------------------------------------------------------------ init */

export default function init(root, ctx) {
  const data = ctx.data(root, 'lifecycle');
  if (!data || !data.state || !Array.isArray(data.algorithm)) return;
  const body = $('.c-lifecycle__body', root);
  const staticBlock = $('[data-lifecycle-static]', root);
  const scenarios = buildScenarios(data);
  if (!body || !staticBlock || !scenarios.length) return;

  const comps = Object.fromEntries(data.state.components.map((c) => [c.key, c]));
  const algo = data.algorithm;
  const last = algo.length; // step 0 is "before the session", 1…last are Algorithm 1
  const lifeOps = Object.fromEntries((data.lifecycle || []).map((o) => [o.id, o]));
  const lifeOpFor = (id) => lifeOps[id === 'observe' ? 'acquire' : id];
  const view = { sc: 0, step: 0, playing: false, timer: 0, expanded: new Set() };
  // Where the rest of the unlearning hierarchy is shown on this page, if anywhere.
  const forgetHref = ['#forgetting', '#fig-unlearning'].find((sel) => $(sel)) || null;

  const scenario = () => scenarios[view.sc];
  const statusOf = (i) => (i === 0 ? 'start' : scenario().steps[i - 1].status);
  const runnable = (i) => i === 0 || statusOf(i) !== 'skip';
  const active = (i) => ['run', 'reject'].includes(statusOf(i));
  function neighbour(i, dir) {
    for (let j = i + dir; j >= 0 && j <= last; j += dir) if (runnable(j)) return j;
    return null;
  }
  const names = (step, io) => REGISTERS.filter((k) => (step.touches || {})[k] === io).map((k) => comps[k].name.toLowerCase());

  /* ---- scenario picker (radio group) */
  const picks = scenarios.map((sc, i) => h('button', {
    type: 'button',
    role: 'radio',
    class: 'c-lifecycle__pick',
    'aria-checked': String(i === 0),
    tabindex: i === 0 ? '0' : '-1',
    onClick: () => choose(i),
  },
  h('span', { class: 'c-lifecycle__pick-kind' }, sc.kind),
  h('span', { class: 'visually-hidden' }, ': '),
  h('span', { class: 'c-lifecycle__pick-name' }, sc.name)));
  const picker = h('div', { class: 'c-lifecycle__picker', role: 'radiogroup', 'aria-label': 'Scenario' }, picks);
  picker.addEventListener('keydown', (e) => {
    const i = picks.indexOf(e.target.closest('[role="radio"]'));
    if (i < 0) return;
    const n = picks.length;
    const moves = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1 + n, ArrowUp: i - 1 + n, Home: 0, End: n - 1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const j = moves[e.key] % n;
    choose(j);
    picks[j].focus();
  });

  /* ---- brief: state before, incoming input, query */
  const brief = h('dl', { class: 'c-lifecycle__brief' });
  function renderBrief() {
    const sc = scenario();
    mount(brief,
      h('div', {}, h('dt', {}, 'State before'), h('dd', {}, rich(sc.brief.start))),
      h('div', {}, h('dt', {}, 'Incoming'), h('dd', {}, rich(sc.brief.input))),
      h('div', {}, h('dt', {}, 'Query'), h('dd', {}, `“${sc.query.text}”`)));
  }

  /* ---- step rail */
  const railItems = algo.map((step, idx) => {
    const name = step.name.replace(/\s*\(.*\)\s*$/, '');
    const cond = (step.name.match(/\(([^)]+)\)/) || [])[1];
    const reads = names(step, 'r');
    const writes = names(step, 'w');
    const footprint = [reads.length && `reads ${reads.join(', ')}`, writes.length && `writes ${writes.join(', ')}`].filter(Boolean).join('; ');
    const state = h('span', { class: 'visually-hidden' });
    const btn = h('button', { type: 'button', class: 'c-lifecycle__step', tabindex: '-1', onClick: () => jump(idx + 1) },
      h('span', { class: 'c-lifecycle__num', 'aria-hidden': 'true' }, String(idx + 1)),
      h('span', { class: 'c-lifecycle__name' }, h('span', { class: 'visually-hidden' }, `Step ${idx + 1}: `), name),
      cond ? h('span', { class: 'c-lifecycle__cond' }, cond) : null,
      h('span', { class: 'c-lifecycle__dots', 'aria-hidden': 'true' },
        REGISTERS.map((k) => h('span', { class: 'c-lifecycle__dot', dataset: { st: k, io: (step.touches || {})[k] || '' } }))),
      h('span', { class: 'visually-hidden' }, footprint ? ` (${footprint})` : ''),
      state);
    return { li: h('li', {}, btn), btn, state };
  });
  const rail = h('ol', { class: 'c-lifecycle__rail', 'aria-label': 'Algorithm 1, step by step' }, railItems.map((r) => r.li));
  const branchLabel = h('span', { class: 'c-lifecycle__branch-label' });
  const branch = h('div', { class: 'c-lifecycle__branch', 'aria-hidden': 'true', hidden: true }, branchLabel);
  branchLabel.append('rejected · ', rich('S_t+1 = S_t'));
  const railWrap = h('div', { class: 'c-lifecycle__railwrap' }, branch, rail);
  railWrap.style.setProperty('--n', String(last));

  rail.addEventListener('keydown', (e) => {
    const i = railItems.findIndex((r) => r.btn === e.target.closest('.c-lifecycle__step')) + 1;
    if (i < 1) return;
    const moves = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let j = null;
    if (e.key in moves) j = neighbour(i, moves[e.key]);
    else if (e.key === 'Home') j = 1;
    else if (e.key === 'End') j = last;
    else return;
    e.preventDefault();
    if (!j) return;
    stop();
    go(j, { animate: j === view.step + 1 });
    railItems[j - 1].btn.focus();
  });

  /* ---- controls */
  const label = (text) => h('span', { class: 'c-lifecycle__btn-label' }, text);
  const playIcon = h('span', { class: 'c-lifecycle__btn-icon' }, icon('play'));
  const playLabel = label('Play');
  const prevBtn = h('button', { type: 'button', class: 'btn btn--secondary c-lifecycle__prev', onClick: () => move(-1) }, icon('prev'), label('Previous'));
  const playBtn = h('button', { type: 'button', class: 'btn btn--secondary c-lifecycle__play', onClick: togglePlay }, playIcon, playLabel);
  const nextBtn = h('button', { type: 'button', class: 'btn c-lifecycle__next', onClick: () => move(1) }, label('Next'), icon('next'));
  const resetBtn = h('button', { type: 'button', class: 'btn btn--ghost c-lifecycle__reset', onClick: reset }, icon('reset'), label('Reset'));
  const counter = h('p', { class: 'c-lifecycle__count', 'aria-hidden': 'true' });
  const legend = h('p', { class: 'c-lifecycle__legend', 'aria-hidden': 'true' },
    h('span', { class: 'c-lifecycle__dot', dataset: { io: 'w' } }), h('span', {}, 'writes'),
    h('span', { class: 'c-lifecycle__dot', dataset: { io: 'r' } }), h('span', {}, 'reads'),
    h('span', { class: 'c-lifecycle__legend-order' }, REGISTERS.map((k) => math('span', comps[k].symbol, { class: 'math' }))));
  const controls = h('div', { class: 'c-lifecycle__controls', role: 'group', 'aria-label': 'Step through Algorithm 1' },
    prevBtn, playBtn, nextBtn, resetBtn, h('div', { class: 'c-lifecycle__status' }, legend, counter));

  /* ---- what the current step does */
  const now = h('div', { class: 'c-lifecycle__now' });

  /* ---- registers */
  const regEls = {};
  const regCards = REGISTERS.map((k) => {
    const c = comps[k];
    const nameId = uid('lc-reg');
    const io = h('span', { class: 'c-lifecycle__io', hidden: true });
    const list = h('ul', { class: 'c-lifecycle__entries' });
    const more = h('button', { type: 'button', class: 'c-lifecycle__more', 'aria-expanded': 'false', hidden: true, onClick: () => toggleMore(k) });
    const el = h('div', { class: 'c-lifecycle__reg', role: 'group', 'aria-labelledby': nameId, dataset: { st: k } },
      h('div', { class: 'c-lifecycle__reg-head' },
        math('span', c.symbol, { class: 'c-lifecycle__reg-sym math', 'aria-hidden': 'true' }),
        h('span', { class: 'c-lifecycle__reg-name', id: nameId }, c.name),
        io),
      list,
      more);
    regEls[k] = { el, io, list, more };
    return el;
  });
  const half = Math.ceil(regCards.length / 2);
  const regs = h('div', { class: 'c-lifecycle__regs' },
    h('div', { class: 'c-lifecycle__regcol' }, regCards.slice(0, half)),
    h('div', { class: 'c-lifecycle__regcol' }, regCards.slice(half)));

  // Point at an entry to see where the same claim (or document) lives in
  // the other registers: its provenance, its validity, its evidence.
  regs.addEventListener('pointerover', (e) => highlightLinks(e.target.closest('.c-lifecycle__entry')));
  regs.addEventListener('pointerleave', () => highlightLinks(null));
  function highlightLinks(entry) {
    for (const el of $$('.is-linked', regs)) el.classList.remove('is-linked');
    if (!entry || (!entry.dataset.src && !entry.dataset.doc)) return;
    const { src, doc } = entry.dataset;
    for (const el of $$('.c-lifecycle__entry', regs)) {
      const same = src ? el.dataset.src === src || (!el.dataset.src && el.dataset.doc === doc) : el.dataset.doc === doc;
      if (same && el !== entry) el.classList.add('is-linked');
    }
  }

  /* ---- invariant, trace, text version */
  const inv = h('div', { class: 'c-lifecycle__inv', dataset: { st: 'P' } });
  const traceList = h('ol', { class: 'c-lifecycle__trace-list' });
  const traceSummary = h('summary', {});
  const trace = h('details', { class: 'disclosure c-lifecycle__trace' }, traceSummary, h('div', { class: 'disclosure__body' }, traceList));
  const altBody = h('div', { class: 'disclosure__body' });
  const alt = h('details', { class: 'disclosure c-lifecycle__alt' }, h('summary', {}, 'The state tuple and Algorithm 1, as text'), altBody);
  altBody.append(staticBlock);

  const app = h('div', { class: 'c-lifecycle__app' },
    picker, brief, railWrap, controls, now, regs, inv, h('div', { class: 'c-lifecycle__extras' }, trace, alt));
  body.prepend(app);

  /* ------------------------------------------------------------ render */

  function renderRail() {
    const sc = scenario();
    railItems.forEach((r, idx) => {
      const i = idx + 1;
      const st = statusOf(i);
      const done = i < view.step && st !== 'skip';
      const cls = r.btn.classList;
      cls.toggle('is-current', i === view.step);
      cls.toggle('is-done', done);
      cls.toggle('is-skip', st === 'skip');
      cls.toggle('is-quiet', st === 'quiet' || st === 'off');
      cls.toggle('is-reject', st === 'reject' && i <= view.step);
      if (i === view.step) r.btn.setAttribute('aria-current', 'step');
      else r.btn.removeAttribute('aria-current');
      r.btn.setAttribute('aria-disabled', String(st === 'skip'));
      r.btn.tabIndex = i === Math.max(1, view.step) ? 0 : -1;
      r.state.textContent = st === 'skip' ? ' (skipped in this scenario)' : done ? ' (done)' : '';
    });
    const from = sc.steps.findIndex((x) => x.status === 'reject');
    branch.hidden = from < 0;
    if (from >= 0) {
      branch.style.setProperty('--from', String(from));
      branch.style.setProperty('--to', String(last - 1));
      branch.classList.toggle('is-taken', view.step > from);
    }
  }

  function renderControls() {
    const atEnd = view.step === last;
    prevBtn.setAttribute('aria-disabled', String(view.step === 0));
    nextBtn.setAttribute('aria-disabled', String(atEnd));
    playBtn.hidden = ctx.reducedMotion;
    playLabel.textContent = view.playing ? 'Pause' : atEnd ? 'Replay' : 'Play';
    mount(playIcon, icon(view.playing ? 'pause' : 'play'));
    counter.textContent = view.step === 0 ? `${last} steps` : `Step ${view.step} of ${last}`;
  }

  function ioChips(step) {
    const chips = (io) => REGISTERS.filter((k) => (step.touches || {})[k] === io).map((k) => symChip(comps[k]));
    const reads = chips('r');
    const writes = chips('w');
    if (reads.length === REGISTERS.length) return h('span', { class: 'c-lifecycle__now-io' }, 'reads all six');
    return h('span', { class: 'c-lifecycle__now-io' },
      reads.length ? h('span', {}, 'reads ', reads) : null,
      writes.length ? h('span', {}, 'writes ', writes) : null);
  }

  function answerBlock(sc) {
    const a = sc.answer;
    return h('dl', { class: 'c-lifecycle__answer' },
      h('div', {}, h('dt', {}, math('span', 'q_t', { class: 'math' })), h('dd', {}, `“${sc.query.text}”`)),
      h('div', {}, h('dt', {}, math('span', 'y_t', { class: 'math' })), h('dd', {},
        h('span', { class: 'c-lifecycle__answer-value' }, a.value),
        a.cite ? h('span', { class: 'c-lifecycle__cite' }, a.cite) : null,
        a.note ? h('span', { class: 'c-lifecycle__answer-note' }, a.note) : null)));
  }

  function renderNow() {
    const sc = scenario();
    if (view.step === 0) {
      now.dataset.status = 'start';
      mount(now,
        h('div', { class: 'c-lifecycle__now-head' },
          h('span', { class: 'c-lifecycle__now-num' }, '00'),
          h('span', { class: 'c-lifecycle__now-name' }, 'Before the session')),
        h('p', { class: 'c-lifecycle__now-log' },
          rich(`S_t holds ${sc.brief.start}. Press Next, or Play, to run Algorithm 1 on the incoming input.`)));
      return;
    }
    const step = algo[view.step - 1];
    const st = sc.steps[view.step - 1];
    const op = lifeOpFor(step.id);
    const badge = st.verdict
      ? [st.verdict, st.status === 'reject' ? 'badge--bad' : 'badge--ok']
      : STATUS_BADGE[st.status];
    now.dataset.status = st.status;
    mount(now,
      h('div', { class: 'c-lifecycle__now-head' },
        h('span', { class: 'c-lifecycle__now-num' }, String(view.step).padStart(2, '0')),
        h('span', { class: 'c-lifecycle__now-name' }, step.name),
        badge ? h('span', { class: `badge ${badge[1]}` }, badge[0]) : null,
        active(view.step) ? ioChips(step) : null,
        op ? h('span', { class: 'c-lifecycle__now-op' }, `Fig. 3 · ${op.name}`) : null),
      h('p', { class: 'c-lifecycle__now-paper' }, rich(step.body)),
      st.status === 'reject' && step.branch ? h('p', { class: 'c-lifecycle__now-branch' }, rich(step.branch)) : null,
      view.step === last
        ? answerBlock(sc)
        : h('p', { class: 'c-lifecycle__now-log' }, rich(st.log || '')),
      st.list ? h('ol', { class: 'c-lifecycle__now-list' },
        st.list.map((l) => h('li', {}, h('span', { class: 'c-lifecycle__now-level' }, l.label), ' ', l.text))) : null,
      st.list && forgetHref ? h('p', { class: 'c-lifecycle__now-more' },
        'These are the first levels of the unlearning hierarchy: see ',
        h('a', { href: forgetHref }, 'Verifiable forgetting'), ' for the rest.') : null);
  }

  function renderRegisters() {
    const sc = scenario();
    const after = sc.states[view.step];
    const before = view.step > 0 ? sc.states[view.step - 1] : after;
    const step = view.step > 0 ? algo[view.step - 1] : null;
    for (const k of REGISTERS) {
      const r = regEls[k];
      const io = step && active(view.step) ? (step.touches || {})[k] || '' : '';
      r.el.classList.toggle('is-read', io === 'r');
      r.el.classList.toggle('is-write', io === 'w');
      r.io.hidden = !io;
      r.io.textContent = io === 'w' ? 'write' : io === 'r' ? 'read' : '';
      const rows = mergeRows(before[k], after[k], sc.keys);
      const extra = rows.filter((x) => !x.entry.focus);
      const open = view.expanded.has(k);
      r.el.classList.toggle('is-expanded', open);
      mount(r.list, rows.map(entryRow));
      const changed = extra.filter((x) => x.change).length;
      r.more.hidden = extra.length === 0;
      r.more.setAttribute('aria-expanded', String(open));
      r.more.textContent = open
        ? 'Show fewer'
        : `+ ${extra.length} more${changed ? ` · ${changed} changed here` : ''}`;
    }
  }

  function renderInvariant() {
    const sc = scenario();
    const { ok, count } = invariant(sc.states[view.step]);
    const note = sc.steps.slice(0, view.step).reduce((acc, x) => x.inv || acc, '');
    mount(inv,
      h('span', { class: 'c-lifecycle__inv-label' }, h('span', { 'aria-hidden': 'true' }, ok ? '✓ ' : '! '), 'Invariant'),
      h('p', { class: 'c-lifecycle__inv-text' },
        h('strong', {}, data.state.invariant),
        ' ',
        rich(ok ? `All ${count} claims in K_t and 𝒱_t cite a source in P_t.` : 'A claim has lost its source.'),
        note ? ' ' : '',
        note ? rich(note) : ''));
  }

  function logText(sc, i) {
    if (i === last) {
      const a = sc.answer;
      return `“${sc.query.text}” → ${a.value}${a.cite ? `, ${a.cite}` : ''}${a.note ? `; ${a.note}` : ''}.`;
    }
    const st = sc.steps[i - 1];
    return `${st.log || ''}${st.list ? ` ${st.list.map((l) => `${l.label}: ${l.text}`).join(' ')}` : ''}`;
  }

  function renderTrace() {
    const sc = scenario();
    const done = [];
    for (let i = 1; i <= view.step; i += 1) if (runnable(i)) done.push(i);
    traceSummary.textContent = done.length
      ? `Trace of this run · ${done.length} step${done.length === 1 ? '' : 's'}`
      : 'Trace of this run · not started';
    mount(traceList, done.map((i) => h('li', { class: `is-${statusOf(i)}` },
      h('span', { class: 'c-lifecycle__trace-step' }, `${String(i).padStart(2, '0')} ${algo[i - 1].name}`),
      h('span', {}, rich(logText(sc, i))))));
  }

  function spoken() {
    const sc = scenario();
    if (view.step === 0) return `${sc.kind}: ${sc.name}. Before the session.`;
    return `Step ${view.step} of ${last}, ${algo[view.step - 1].name}. ${spokenText(logText(sc, view.step))}`;
  }

  /* ------------------------------------------------------------ actions */

  function go(i, { animate = false, announce = true } = {}) {
    view.step = i;
    app.classList.toggle('is-stepping', animate && !ctx.reducedMotion);
    renderRail();
    renderControls();
    renderNow();
    renderRegisters();
    renderInvariant();
    renderTrace();
    if (announce) ctx.announce(spoken());
  }

  function move(dir) {
    stop();
    const j = neighbour(view.step, dir);
    if (j !== null) go(j, { animate: dir > 0 });
  }

  function jump(i) {
    if (!runnable(i)) {
      ctx.announce(`${algo[i - 1].name} is skipped in this scenario: the gate rejected the observation.`);
      return;
    }
    stop();
    go(i, { animate: i === neighbour(view.step, 1) });
  }

  function reset() {
    stop();
    go(0);
  }

  function choose(i) {
    if (i === view.sc) return;
    stop();
    view.sc = i;
    picks.forEach((p, j) => {
      p.setAttribute('aria-checked', String(j === i));
      p.tabIndex = j === i ? 0 : -1;
    });
    renderBrief();
    go(0, { announce: false });
    const sc = scenario();
    ctx.announce(`${sc.kind}: ${sc.name}. Incoming: ${spokenText(sc.brief.input)}. Query: ${sc.query.text}`);
  }

  function toggleMore(k) {
    if (view.expanded.has(k)) view.expanded.delete(k);
    else view.expanded.add(k);
    app.classList.remove('is-stepping');
    renderRegisters();
  }

  // Play advances one step at a time and stops by itself at Answer. It is
  // not offered when reduced motion is requested, and pauses when the tab
  // is hidden.
  function togglePlay() {
    if (view.playing) stop();
    else play();
  }

  function play() {
    if (ctx.reducedMotion) return;
    if (view.step === last) go(0, { announce: false });
    view.playing = true;
    advance();
  }

  function advance() {
    const j = neighbour(view.step, 1);
    if (j === null) {
      stop();
      return;
    }
    go(j, { animate: true });
    if (neighbour(j, 1) === null) {
      stop();
      return;
    }
    view.timer = setTimeout(advance, active(j) ? STEP_MS : QUIET_MS);
  }

  function stop() {
    clearTimeout(view.timer);
    view.timer = 0;
    if (!view.playing) return;
    view.playing = false;
    renderControls();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionQuery.addEventListener('change', () => {
    if (motionQuery.matches) stop();
    renderControls();
  });

  renderBrief();
  go(0, { announce: false });
}
