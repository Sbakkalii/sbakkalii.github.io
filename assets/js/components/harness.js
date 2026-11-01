// The longitudinal harness as an explorer.
//
// The static figure shows the counterfactual design, the five metrics and
// the success criterion. This module adds: a metric selector that highlights
// what each metric compares, hypothetical inputs with the metrics computed
// from the paper's equations, scenarios, a verdict against the success
// criterion, and a checklist of the eight mandatory properties. Nothing here
// is a measurement: the paper specifies the harness and reports no results.
import { h, s, $, $$, uid, roving } from '../lib/dom.js';
import { mathHTML } from '../lib/math.js';

/* Hypothetical inputs. Q is a quality score on 0–1 (higher is better),
   C a cost in arbitrary units, Leak a probe score on 0–1. */
const INPUTS = {
  qWarm: { sym: 'Q(D_k+1 | S_k)', label: 'warm state', min: 0, max: 1, step: 0.01 },
  qRet: { sym: 'Q(D_k+1 | R_k)', label: 'retrieval-only', min: 0, max: 1, step: 0.01 },
  qClean: { sym: 'Q(D_k+1 | S_k^clean)', label: 'clean twin', min: 0, max: 1, step: 0.01 },
  cWarm: { sym: 'C(D_k+1 | S_k)', label: 'warm state, cost units', min: 0, max: 1000, step: 10 },
  cCold: { sym: 'C(D_k+1 | S_0)', label: 'cold baseline, cost units', min: 0, max: 1000, step: 10 },
  leakBefore: { sym: 'Leak(X_del | S_t)', label: 'before deletion', min: 0, max: 1, step: 0.01 },
  leakAfter: { sym: 'Leak(X_del | S′_t)', label: 'after deletion', min: 0, max: 1, step: 0.01 },
  retBefore: { sym: 'Q(Y_ret | S_t)', label: 'before deletion', min: 0, max: 1, step: 0.01 },
  retAfter: { sym: 'Q(Y_ret | S′_t)', label: 'after deletion', min: 0, max: 1, step: 0.01 },
  mhBound: { sym: 'ε', label: 'your bound for “bounded”', min: 0, max: 0.3, step: 0.01, threshold: true },
  ffHigh: { sym: 'FF ≥', label: 'your threshold for “high”', min: 0.5, max: 1, step: 0.01, threshold: true },
  crHigh: { sym: 'CR ≥', label: 'your threshold for “high”', min: 0.5, max: 1, step: 0.01, threshold: true },
};

const BASE = {
  qWarm: 0.82, qRet: 0.74, qClean: 0.84, cWarm: 600, cCold: 1000,
  leakBefore: 0.8, leakAfter: 0.04, retBefore: 0.8, retAfter: 0.79,
};
const THRESHOLDS = { mhBound: 0.05, ffHigh: 0.9, crHigh: 0.95 };

const SCENARIOS = [
  { id: 'works', label: 'Memory that works', body: 'Consolidation helps, saves cost and forgets cleanly.', values: {} },
  { id: 'retrieval', label: 'Retrieval is enough', body: 'Warm state does no better than an index of the same documents.', values: { qWarm: 0.74, qRet: 0.75, qClean: 0.75, cWarm: 980 } },
  { id: 'poisoned', label: 'Poisoned state', body: 'A wrong observation was consolidated and now misleads.', values: { qWarm: 0.61 } },
  { id: 'leaky', label: 'Leaky deletion', body: 'The file is gone, but consolidated knowledge still reveals it.', values: { leakAfter: 0.36, retAfter: 0.8 } },
  { id: 'overdeleted', label: 'Over-deletion', body: 'Forgetting also removed knowledge that should have stayed.', values: { leakAfter: 0, retAfter: 0.58 } },
];

const EPS = 1e-9;
const minus = (x) => String(x).replace('-', '−');
const signed = (x, d = 2) => (Math.abs(x) < EPS ? (0).toFixed(d) : `${x > 0 ? '+' : ''}${minus(x.toFixed(d))}`);
const fix = (x, d = 2) => minus(x.toFixed(d));
const cost = (x) => x.toLocaleString('en-US');

/* Metric logic, keyed by the ids in paper.harness.metrics. Each returns
   { value, text, calc, reading, ok } from the current inputs v. */
const LOGIC = {
  eg: {
    inputs: ['qWarm', 'qRet'],
    nodes: { warm: (v) => `Q = ${fix(v.qWarm)}`, retrieval: (v) => `Q = ${fix(v.qRet)}` },
    test: 'positive',
    run(v) {
      const x = v.qWarm - v.qRet;
      let reading = 'EG > 0: consolidation beats retrieval access.';
      if (Math.abs(x) < EPS) reading = 'EG = 0: consolidation adds nothing beyond retrieval access.';
      else if (x < 0) reading = 'EG < 0: the retrieval-only arm does better than consolidated state.';
      return { value: x, text: signed(x), calc: `EG = ${fix(v.qWarm)} − ${fix(v.qRet)} = ${signed(x)}`, reading, ok: x > EPS };
    },
  },
  ce: {
    inputs: ['cWarm', 'cCold'],
    nodes: { warm: (v) => `C = ${cost(v.cWarm)}`, cold: (v) => `C = ${cost(v.cCold)}` },
    test: 'positive',
    run(v) {
      if (v.cCold === 0) {
        return { value: NaN, text: '—', calc: 'CE = 1 − C(D_k+1 | S_k) / 0', reading: 'Undefined: the cold cost is zero, so there is nothing to divide by.', ok: null };
      }
      const x = 1 - v.cWarm / v.cCold;
      let reading = `CE > 0: warm state saves ${Math.round(x * 100)}% of the cold cost.`;
      if (Math.abs(x) < EPS) reading = 'CE = 0: warm state costs as much as starting cold.';
      else if (x < 0) reading = 'CE < 0: warm state costs more than starting cold.';
      return { value: x, text: fix(x), calc: `CE = 1 − ${cost(v.cWarm)} / ${cost(v.cCold)} = ${fix(x)}`, reading, ok: x > EPS };
    },
  },
  mh: {
    inputs: ['qClean', 'qWarm', 'mhBound'],
    nodes: { clean: (v) => `Q = ${fix(v.qClean)}`, warm: (v) => `Q = ${fix(v.qWarm)}` },
    test: 'bounded',
    run(v) {
      const x = v.qClean - v.qWarm;
      const eps = fix(v.mhBound);
      let reading = `MH ≤ 0: the actual state scores at least as well as its clean twin; memory did not hurt.`;
      if (x > EPS && x <= v.mhBound + EPS) reading = `MH > 0: memory hurt by ${fix(x)}, within your bound ε = ${eps}.`;
      else if (x > v.mhBound + EPS) reading = `MH > ε: memory hurt by ${fix(x)}, more than your bound ε = ${eps}.`;
      return { value: x, text: signed(x), calc: `MH = ${fix(v.qClean)} − ${fix(v.qWarm)} = ${signed(x)}`, reading, ok: x <= v.mhBound + EPS };
    },
  },
  ff: {
    inputs: ['leakBefore', 'leakAfter', 'ffHigh'],
    nodes: { before: (v) => `Leak = ${fix(v.leakBefore)}`, after: (v) => `Leak = ${fix(v.leakAfter)}` },
    test: 'high',
    run(v) {
      if (v.leakBefore === 0) {
        return { value: NaN, text: '—', calc: 'FF = 1 − Leak(X_del | S′_t) / 0', reading: 'Undefined: nothing leaked before the deletion, so there is nothing to remove.', ok: null };
      }
      const x = 1 - v.leakAfter / v.leakBefore;
      const remains = Math.round((v.leakAfter / v.leakBefore) * 100);
      let reading = `High: ${100 - remains}% of the leakage is gone after deletion.`;
      if (x < -EPS) reading = 'FF < 0: the deletion increased leakage.';
      else if (x < v.ffHigh - EPS) reading = `Below your threshold: ${remains}% of the original leakage remains.`;
      return { value: x, text: fix(x), calc: `FF = 1 − ${fix(v.leakAfter)} / ${fix(v.leakBefore)} = ${fix(x)}`, reading, ok: x >= v.ffHigh - EPS };
    },
  },
  cr: {
    inputs: ['retBefore', 'retAfter', 'crHigh'],
    nodes: { before: (v) => `Q(Y_ret) = ${fix(v.retBefore)}`, after: (v) => `Q(Y_ret) = ${fix(v.retAfter)}` },
    test: 'high',
    run(v) {
      const x = Math.exp(v.retAfter - v.retBefore);
      let reading = 'High: knowledge that should survive the deletion is intact.';
      if (x < v.crHigh - EPS) reading = 'Below your threshold: the deletion also damaged knowledge that should survive.';
      else if (x < 1 - EPS) reading = 'High: knowledge that should survive the deletion is nearly intact.';
      return { value: x, text: fix(x, 3), calc: `CR = exp(${fix(v.retAfter)} − ${fix(v.retBefore)}) = ${fix(x, 3)}`, reading, ok: x >= v.crHigh - EPS };
    },
  },
};

/** Which diagram nodes a metric compares, and on what. */
const FOCUS = {
  eg: { nodes: ['stream', 'warm', 'retrieval', 'eval'], on: 'quality' },
  ce: { nodes: ['stream', 'warm', 'cold', 'eval'], on: 'cost' },
  mh: { nodes: ['stream', 'clean', 'warm', 'eval'], on: 'quality' },
  ff: { nodes: ['before', 'after'], on: 'leak' },
  cr: { nodes: ['before', 'after'], on: 'retained' },
};
const COMPARES = {
  eg: 'Compares the warm state with the retrieval-only arm, on the quality of the answer to the same next document.',
  ce: 'Compares the warm state with the cold baseline, on the cost of processing the same next document.',
  mh: 'Compares the actual warm state with its clean twin, on the quality of the answer to the same next document.',
  ff: 'Compares the state before and after a deletion request, on how much of the deleted target still leaks.',
  cr: 'Compares the state before and after a deletion request, on knowledge that should survive it.',
};

/* ------------------------------------------------------------- wiring */

/** Curved connectors between diagram nodes, drawn over the grid. */
function drawWires(design, svg, nodes, active) {
  const box = design.getBoundingClientRect();
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { l: r.left - box.left, r: r.right - box.left, t: r.top - box.top, b: r.bottom - box.top, cy: (r.top + r.bottom) / 2 - box.top };
  };
  const stream = rect(nodes.stream);
  const evalBox = rect(nodes.eval);
  const horizontal = evalBox.l > stream.r + 24;
  design.classList.toggle('has-wires', horizontal);
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${Math.round(box.width)} ${Math.round(box.height)}`);
  if (!horizontal) return;

  const link = (x1, y1, x2, y2, on, dashed) => {
    const dx = (x2 - x1) / 2;
    svg.append(s('path', {
      class: ['wire', on && 'is-on', dashed && 'is-dashed'],
      d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2 - 7},${y2}`,
    }));
    svg.append(s('path', { class: ['tip', on && 'is-on'], d: `M${x2 - 7},${y2 - 4} L${x2},${y2} L${x2 - 7},${y2 + 4} Z` }));
  };
  const fed = ['clean', 'warm', 'retrieval'];
  const sx = stream.r;
  const sy = stream.cy;
  const ex = evalBox.l;
  const ey = evalBox.cy;
  // Draw inactive links first so highlighted ones sit on top.
  const order = ['clean', 'warm', 'retrieval', 'cold'].sort((a, b) => active.includes(a) - active.includes(b));
  for (const id of order) {
    const n = rect(nodes[id]);
    const on = active.includes(id);
    if (fed.includes(id)) link(sx, sy, n.l, n.cy, on && active.includes('stream'), id === 'clean');
    link(n.r, n.cy, ex, ey + (on ? 0 : 0), on && active.includes('eval'), id === 'clean');
  }
}

/* ----------------------------------------------------------------- init */

export default function init(root, ctx) {
  const payload = ctx.data(root, 'harness');
  const data = payload && payload.harness;
  const body = $('[data-body]', root);
  const design = $('[data-design]', root);
  if (!data || !body || !design) return;

  const metrics = (data.metrics || []).filter((m) => LOGIC[m.id]);
  if (!metrics.length) return;
  const v = { ...BASE, ...THRESHOLDS };
  const props = (data.properties || []).map(() => true);
  let current = metrics[0].id;
  let scenario = 'works';
  let announceTimer = 0;

  const nodes = Object.fromEntries($$('[data-node]', design).map((el) => [el.dataset.node, el]));
  const tags = {};
  for (const [id, el] of Object.entries(nodes)) {
    tags[id] = h('span', { class: 'c-harness__tag', 'aria-hidden': 'true' });
    el.append(tags[id]);
  }
  const wires = s('svg', { class: 'c-harness__wires', 'aria-hidden': 'true', focusable: 'false' });
  design.prepend(wires);

  /* --- scenarios --- */
  const scenarioButtons = SCENARIOS.map((sc) => h('button', {
    type: 'button',
    class: 'chip',
    'aria-pressed': String(sc.id === scenario),
    dataset: { scenario: sc.id },
    onClick: () => applyScenario(sc),
  }, sc.label));
  const scenarioNote = h('p', { class: 'c-harness__scenario-note' });
  const scenarios = h('div', { class: 'c-harness__scenarios' },
    h('p', { class: 'c-harness__kicker', id: uid('hs') }, 'Hypothetical scenarios'),
    h('div', { class: 'c-harness__chips', role: 'group', 'aria-label': 'Hypothetical scenarios' }, scenarioButtons),
    scenarioNote);

  /* --- tabs: one per metric, showing its live value and verdict --- */
  const panelId = uid('hp');
  const tabs = metrics.map((m) => {
    const tab = h('button', {
      type: 'button',
      role: 'tab',
      id: uid('ht'),
      class: 'c-harness__tab',
      'aria-selected': 'false',
      'aria-controls': panelId,
      tabindex: '-1',
      dataset: { metric: m.id },
      onClick: () => select(m.id),
    },
    h('span', { class: 'c-harness__tab-top' },
      h('span', { class: 'c-harness__tab-abbr' }, m.abbr),
      h('span', { class: 'c-harness__tab-verdict', dataset: { verdict: '' } })),
    h('span', { class: 'c-harness__tab-name' }, m.name),
    h('span', { class: 'c-harness__tab-value', dataset: { value: '' } }));
    return tab;
  });
  const tablist = h('div', { class: 'c-harness__tabs', role: 'tablist', 'aria-label': 'Metrics' }, tabs);
  roving(tabs, { onSelect: (i) => select(metrics[i].id) });

  /* --- inputs: one slider per input per metric (shared inputs are synced) --- */
  const sliders = [];
  function slider(key) {
    const spec = INPUTS[key];
    const id = uid('hi');
    const input = h('input', { type: 'range', id, min: spec.min, max: spec.max, step: spec.step, value: v[key] });
    const output = h('output', { for: id, 'aria-live': 'off' });
    input.addEventListener('input', () => {
      v[key] = Number(input.value);
      if (!spec.threshold) scenario = null;
      update();
    });
    sliders.push({ key, input, output });
    return h('div', { class: ['range', 'c-harness__range', spec.threshold && 'is-threshold'] },
      h('div', { class: 'range__head' },
        h('label', { for: id }, h('span', { class: 'math', html: mathHTML(spec.sym) }), ' ', h('span', { class: 'c-harness__range-name' }, spec.label)),
        output),
      input);
  }

  const detail = {};
  const groups = {};
  for (const m of metrics) {
    const inputs = LOGIC[m.id].inputs;
    const plain = inputs.filter((k) => !INPUTS[k].threshold);
    const thresholds = inputs.filter((k) => INPUTS[k].threshold);
    groups[m.id] = h('div', { class: 'c-harness__inputs', hidden: true },
      h('p', { class: 'c-harness__kicker' }, 'Hypothetical inputs'),
      plain.map(slider),
      thresholds.length ? h('div', { class: 'c-harness__thresholds' },
        thresholds.map(slider),
        h('p', { class: 'c-harness__fine' }, 'The criterion gives no number; this one is yours.')) : null);
  }
  detail.title = h('p', { class: 'c-harness__def-title' });
  detail.target = h('span', { class: 'badge badge--muted badge--plain' });
  detail.eq = h('p', { class: 'eq c-harness__def-eq' });
  detail.measures = h('p', { class: 'c-harness__measures' });
  detail.compares = h('p', { class: 'c-harness__compares' });
  detail.calc = h('p', { class: 'c-harness__calc' });
  detail.verdict = h('p', { class: 'c-harness__verdict' });
  detail.extra = h('p', { class: 'c-harness__extra' });

  const panel = h('div', { class: 'c-harness__panel', role: 'tabpanel', id: panelId },
    design,
    h('div', { class: 'c-harness__detail' },
      h('div', { class: 'c-harness__def' },
        h('div', { class: 'c-harness__def-head' }, detail.title, detail.target),
        detail.eq, detail.measures, detail.compares,
        h('div', { class: 'c-harness__result' }, detail.calc, detail.verdict),
        detail.extra),
      h('div', { class: 'c-harness__inputcol' }, Object.values(groups))));

  const honesty = $('.c-harness__honesty', body);
  (honesty || body.firstChild).after(scenarios, tablist, panel);

  /* --- success strip --- */
  const success = $('[data-success]', root);
  const checks = h('ul', { class: 'c-harness__checks', 'aria-label': 'Conditions' });
  const overall = h('p', { class: 'c-harness__overall' });
  success.append(checks, overall);

  const defs = $('[data-defs]', root);
  if (defs) defs.open = false;

  /* --- properties checklist --- */
  const propsCount = $('[data-props-count]', root);
  for (const li of $$('[data-prop]', root)) {
    const i = Number(li.dataset.prop);
    const id = uid('hk');
    const box = h('input', { type: 'checkbox', id, class: 'c-harness__check', checked: true });
    box.addEventListener('change', () => { props[i] = box.checked; li.classList.toggle('is-off', !box.checked); update(); });
    const name = $('.c-harness__prop-name', li);
    const label = h('label', { for: id, class: 'c-harness__prop-name' }, name.textContent);
    name.replaceWith(label);
    li.prepend(box);
  }

  /* ----------------------------------------------------------- render */

  function results() {
    return Object.fromEntries(metrics.map((m) => [m.id, LOGIC[m.id].run(v)]));
  }

  function verdictBadge(r, test) {
    if (r.ok === null) return h('span', { class: 'badge badge--muted' }, 'Undefined');
    return h('span', { class: `badge ${r.ok ? 'badge--ok' : 'badge--bad'}` }, `${r.ok ? 'Meets' : 'Fails'} · ${test}`);
  }

  function update() {
    const res = results();
    const m = metrics.find((x) => x.id === current);
    const r = res[current];
    const logic = LOGIC[current];

    // Tabs
    tabs.forEach((tab, i) => {
      const id = metrics[i].id;
      const ri = res[id];
      $('[data-value]', tab).textContent = ri.text;
      const glyph = ri.ok === null ? '–' : ri.ok ? '✓' : '✗';
      const word = ri.ok === null ? 'undefined' : ri.ok ? 'meets' : 'fails';
      $('[data-verdict]', tab).replaceChildren(h('span', { 'aria-hidden': 'true' }, glyph), h('span', { class: 'visually-hidden' }, `, ${word} ${LOGIC[id].test}`));
      tab.dataset.state = word;
    });

    // Detail
    detail.title.innerHTML = `<span class="c-harness__def-abbr">${m.abbr}</span> ${m.name}`;
    detail.target.textContent = `Target: ${m.good}`;
    detail.eq.innerHTML = mathHTML(m.equation);
    detail.measures.textContent = m.measures;
    detail.compares.textContent = COMPARES[current];
    detail.calc.innerHTML = `<span class="math">${mathHTML(r.calc)}</span>`;
    detail.verdict.replaceChildren(verdictBadge(r, logic.test), ' ', r.reading);
    if (current === 'mh') {
      detail.extra.hidden = false;
      detail.extra.innerHTML = `<strong>How the clean twin is built.</strong> ${mathHTML(data.memory_harm_protocol || '')}${payload.harm ? ` ${payload.theorem || 'The theorem'} gives its expected value: <span class="math">${mathHTML(payload.harm)}</span> (<a href="#contamination">calculator</a>).` : ''}`;
    } else {
      detail.extra.hidden = true;
    }
    for (const [id, g] of Object.entries(groups)) g.hidden = id !== current;
    for (const sl of sliders) {
      sl.input.value = String(v[sl.key]);
      const spec = INPUTS[sl.key];
      const text = spec.max > 1 ? cost(v[sl.key]) : fix(v[sl.key]);
      sl.output.textContent = text;
      sl.input.setAttribute('aria-valuetext', text);
    }

    // Diagram focus
    const focus = FOCUS[current];
    design.dataset.on = focus.on;
    for (const [id, el] of Object.entries(nodes)) {
      const on = focus.nodes.includes(id);
      el.classList.toggle('is-on', on);
      const tagFn = logic.nodes[id];
      tags[id].textContent = tagFn ? tagFn(v) : '';
      tags[id].hidden = !tagFn;
    }
    tags.eval.hidden = !['eg', 'ce', 'mh'].includes(current);
    tags.eval.textContent = `${m.abbr} = ${r.text}`;
    design.classList.toggle('is-deletion', current === 'ff' || current === 'cr');
    const note = $('[data-stream-note]', design);
    if (note) note.textContent = current === 'mh' ? 'A fraction of observations is corrupted; the twin sees them clean.' : 'One document per session, before the test.';
    requestWires();

    // Success
    const nProps = props.filter(Boolean).length;
    const items = metrics.map((x) => {
      const ri = res[x.id];
      return h('li', { class: ['c-harness__checkitem', ri.ok ? 'is-ok' : 'is-bad'] },
        h('span', { class: 'c-harness__glyph', 'aria-hidden': 'true' }, ri.ok ? '✓' : '✗'),
        `${x.abbr} ${LOGIC[x.id].test}`,
        h('span', { class: 'visually-hidden' }, ri.ok ? ': met' : ': not met'));
    });
    const propsOk = nProps === props.length;
    items.push(h('li', { class: ['c-harness__checkitem', propsOk ? 'is-ok' : 'is-bad'] },
      h('span', { class: 'c-harness__glyph', 'aria-hidden': 'true' }, propsOk ? '✓' : '✗'),
      `${nProps} of ${props.length} properties`));
    checks.replaceChildren(...items);
    const failed = metrics.filter((x) => !res[x.id].ok).map((x) => `${x.abbr} is not ${LOGIC[x.id].test}`);
    const missing = (data.properties || []).filter((_, i) => !props[i]);
    let text = 'Met, for these hypothetical inputs.';
    if (failed.length) text = `Not met: ${failed.join('; ')}.`;
    else if (missing.length) text = `Not established: the benchmark lacks ${missing.join(', ')}.`;
    overall.textContent = text;
    overall.className = `c-harness__overall ${failed.length || missing.length ? 'is-bad' : 'is-ok'}`;
    if (propsCount) propsCount.textContent = `${nProps} of ${props.length} provided`;

    // Scenarios
    for (const btn of scenarioButtons) btn.setAttribute('aria-pressed', String(btn.dataset.scenario === scenario));
    const sc = SCENARIOS.find((x) => x.id === scenario);
    scenarioNote.textContent = sc ? sc.body : 'Your own inputs.';

    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => ctx.announce(`${m.abbr} = ${r.text}. ${text}`), 800);
  }

  function select(id) {
    current = id;
    tabs.forEach((tab) => {
      const on = tab.dataset.metric === id;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on) panel.setAttribute('aria-labelledby', tab.id);
    });
    update();
  }

  function applyScenario(sc) {
    Object.assign(v, BASE, sc.values);
    scenario = sc.id;
    // Show the metric the scenario is about.
    const focus = { retrieval: 'eg', poisoned: 'mh', leaky: 'ff', overdeleted: 'cr' }[sc.id];
    if (focus && metrics.some((m) => m.id === focus)) select(focus);
    else update();
  }

  /* --- connectors follow layout changes --- */
  let wireFrame = 0;
  function requestWires() {
    cancelAnimationFrame(wireFrame);
    wireFrame = requestAnimationFrame(() => drawWires(design, wires, nodes, FOCUS[current].nodes));
  }
  new ResizeObserver(requestWires).observe(design);
  if (document.fonts) document.fonts.ready.then(requestWires);

  select(current);
}
