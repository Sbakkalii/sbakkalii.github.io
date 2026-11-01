// Register contents and scenario scripts for the lifecycle figure.
//
// Everything is built from the fictional documents of _data/demo.yml: values,
// sections, dates and page boxes are read from the data. Which register holds
// which entry, and what each step of Algorithm 1 does to them, is our
// illustration of Eq. 4 and Algorithm 1 (the figure is badged Illustrative).
// Pure functions: no DOM.

export const REGISTERS = ['E', 'K', 'G', 'V', 'P', 'A'];

// Facts shown in the registers; every other fact is counted under "+ n more".
const FOCUS = ['payment_terms', 'rate_express', 'liability_cap'];
const PAGE = 1; // every demo document is a single page

/* --------------------------------------------------------------- helpers */

/** "MSA-2026-014" → "MSA"; short refs such as "SOW-2" stay as they are. */
export function shortRef(doc) {
  return /^[A-Z]+-\d{4}-\d+$/.test(doc.ref) ? doc.ref.split('-')[0] : doc.ref;
}

export function dayBefore(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-11-05" → "5 Nov 2026" */
export function longDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const firstWord = (name) => String(name).split(' ')[0];
const regionOf = (doc, id) => doc.regions.find((r) => r.id === id) || {};

/** One field of a document as a claim: a fact, its validity and its source. */
function claimOf(doc, field) {
  const region = regionOf(doc, field.region);
  return {
    id: `${doc.id}:${field.key}`,
    doc: doc.id,
    key: field.key,
    label: field.label,
    value: field.value,
    scope: field.scope,
    outcome: field.outcome,
    src: `${shortRef(doc)} ${region.section || ''}`.trim(),
    box: region.box || [],
    from: doc.effective || doc.date,
    focus: FOCUS.includes(field.key),
  };
}

/* ----------------------------------------------------- register entries */
// An entry is display-ready: lead | main | tag, an optional sub line, plus
// the ids used to diff states and to link an entry to its provenance.

const evidence = (doc, quote) => ({
  id: `E:${doc.id}`, doc: doc.id, focus: true, order: doc.date,
  lead: doc.ref, main: `${doc.fields.length} spans`, tag: doc.date, sub: quote,
});

// A scope is shown only where it narrows a fact ("cold-chain services").
const narrow = (c) => (c.scope && c.scope !== 'all services' ? c.scope : undefined);

const fact = (c, tone) => ({
  id: `K:${c.id}`, doc: c.doc, key: c.key, src: c.src, focus: c.focus, order: c.from, scope: c.scope,
  lead: c.label, main: c.value, tag: c.src,
  sub: tone === 'pending' ? 'pending · to reconcile' : narrow(c), tone,
});

const validity = (c) => ({
  id: `V:${c.id}`, doc: c.doc, key: c.key, src: c.src, focus: c.focus, order: c.from,
  scope: c.scope, value: c.value, from: c.from, to: null,
  lead: c.value, main: `${c.from} → open`, tag: c.src, sub: narrow(c),
});

const link = (c) => ({
  id: `P:${c.id}`, doc: c.doc, key: c.key, src: c.src, focus: c.focus, order: c.from,
  lead: c.src, main: `p.${PAGE} · ${c.box.join(',')}`, tag: c.value,
});

const edge = (id, doc, from, rel, to) => ({ id: `G:${id}`, doc, focus: true, lead: from, main: `${rel} → ${to}` });

// Authorization is not in the demo data at all: these few lines are an
// illustration of what A_t holds (who may read, write or erase).
const policy = (parties) => [
  { id: 'A:tenant', focus: true, lead: 'tenant', main: parties.client },
  { id: 'A:read', focus: true, lead: 'read', main: `${firstWord(parties.client)} analysts` },
  { id: 'A:write', focus: true, lead: 'write', main: 'admitted evidence only' },
  { id: 'A:erase', focus: true, lead: 'erase', main: 'on verified request' },
];

/* --------------------------------------------------------------- states */

const emptyState = () => Object.fromEntries(REGISTERS.map((r) => [r, []]));

/** Apply a step's operations ({reg, op: add|del|set, …}) to a copy of a state. */
export function applyOps(state, ops = []) {
  const next = Object.fromEntries(REGISTERS.map((r) => [r, state[r].slice()]));
  for (const o of ops) {
    if (o.op === 'add') next[o.reg].push(o.entry);
    else if (o.op === 'del') next[o.reg] = next[o.reg].filter((e) => e.id !== o.id);
    else if (o.op === 'set') next[o.reg] = next[o.reg].map((e) => (e.id === o.id ? { ...e, ...o.patch } : e));
  }
  return next;
}

/** A document already admitted and consolidated before the session starts. */
function consolidate(state, doc) {
  state.E.push(evidence(doc));
  for (const c of doc.fields.map((f) => claimOf(doc, f))) {
    state.K.push(fact(c));
    state.V.push(validity(c));
    state.P.push(link(c));
  }
}

/** The claim version valid on `day` for `key` (preferring `scope`). */
export function lookup(state, key, day, scope) {
  const valid = state.V.filter((v) => v.key === key && v.from <= day && (!v.to || day <= v.to));
  return (scope && valid.find((v) => v.scope === scope))
    || valid.find((v) => !v.scope || v.scope === 'all services')
    || valid[0] || null;
}

/** The provenance invariant, checked on a state: every claim cites P_t. */
export function invariant(state) {
  const linked = new Set(state.P.map((p) => p.src));
  const claims = [...state.K, ...state.V];
  return { ok: claims.every((c) => linked.has(c.src)), count: state.V.length };
}

/* ------------------------------------------------------------ scenarios */
// A scenario: label, brief, query, start state and one script entry per
// Algorithm 1 step id. Step status: run (does its job), quiet (runs, nothing
// to do here), off (not triggered), reject (the gate says no) or skip (jumped
// over by the gate's branch).

export function buildScenarios(data) {
  const demo = data && data.demo;
  if (!demo || !Array.isArray(demo.documents)) return [];
  const docs = Object.fromEntries(demo.documents.map((d) => [d.id, d]));
  const { msa, sow2, amend1, inv } = docs;
  const noisy = demo.noisy_observation;
  const erase = demo.deletion_request;
  if (!msa || !sow2 || !amend1 || !inv || !noisy || !erase) return [];

  const target = docs[erase.target];
  if (!target) return [];

  const today = inv.date; // the day the questions are asked in the story
  const admitted = admitAmendment({ msa, sow2, amend1, parties: demo.parties, today });
  // (b) and (c) start where (a) ends: MSA + SOW-2 + AMD-1. The quote shown on
  // the span (a) just wrote is dropped, as nothing new is written there.
  const end = admitted.end;
  const after = { ...end, E: end.E.map(({ sub, ...e }) => e) };
  const keys = [...new Set([msa, sow2, amend1].flatMap((d) => d.fields.map((f) => f.key)))];
  return [
    admitted.scenario,
    rejectOcr({ msa, sow2, amend1, inv, noisy, today, start: after }),
    forgetSow({ msa, sow2, amend1, target, erase, today, start: after }),
  ].map((sc) => ({ ...sc, keys }));
}

const startLine = (...docs) => docs.map((d) => d.ref).join(', ').replace(/, ([^,]+)$/, ' and $1');

/* (a) Admit: an amendment supersedes payment terms and the express rate. */
function admitAmendment({ msa, sow2, amend1, parties, today }) {
  const start = emptyState();
  consolidate(start, msa);
  consolidate(start, sow2);
  const sowScope = sow2.fields.find((f) => f.scope);
  start.G.push(
    edge('msa-parties', 'msa', msa.ref, 'parties', `${firstWord(parties.supplier)}, ${firstWord(parties.client)}`),
    edge('sow2-under', 'sow2', sow2.ref, 'under', msa.ref),
  );
  if (sowScope) {
    const c = claimOf(sow2, sowScope);
    start.G.push(edge('sow2-scope', 'sow2', c.src, 'scopes', sowScope.label));
  }
  start.A = policy(parties);

  const claims = amend1.fields.map((f) => claimOf(amend1, f));
  const supersede = claims.filter((c) => c.outcome === 'supersede');
  const fresh = claims.filter((c) => c.outcome === 'new');
  const old = (c) => start.K.find((k) => k.key === c.key && !narrow(k));
  const pay = supersede.find((c) => c.key === 'payment_terms') || supersede[0];
  const rate = supersede.find((c) => c !== pay);
  const close = dayBefore(amend1.effective);
  const payRegion = regionOf(amend1, amend1.fields.find((f) => f.key === pay.key).region);
  const quote = (payRegion.text.match(/payable within [^.]*? days/) || [payRegion.text])[0];
  const clauses = amend1.regions.filter((r) => r.type === 'Clause').length;
  const lower = (c) => c.label.toLowerCase();

  // Links for the claims the amendment supports stay out of view.
  const linkOf = (c) => ({ ...link(c), focus: c.focus && c.outcome !== 'support' });

  const reconcileOps = [];
  for (const c of supersede) {
    const k = old(c);
    if (!k) continue;
    const v = start.V.find((e) => e.id === `V:${k.id.slice(2)}`);
    reconcileOps.push(
      { reg: 'V', op: 'set', id: v.id, patch: { to: close, main: `${v.from} → ${close}`, tone: 'closed' } },
      { reg: 'V', op: 'add', entry: validity(c) },
      { reg: 'K', op: 'del', id: k.id },
      { reg: 'K', op: 'set', id: `K:${c.id}`, patch: { tone: null, sub: narrow(c) || null } },
      { reg: 'P', op: 'set', id: `P:${k.id.slice(2)}`, patch: { sub: `superseded by ${c.src} from ${amend1.effective}` } },
    );
  }
  for (const c of fresh) reconcileOps.push({ reg: 'V', op: 'add', entry: validity(c) });

  const oldPay = old(pay);
  const oldRate = rate && old(rate);
  const script = {
    observe: {
      status: 'run',
      log: `o_t ← ${amend1.ref}, “${amend1.title}”: ${clauses} clauses on p.${PAGE}, signed ${amend1.date}, effective ${amend1.effective}.`,
    },
    corroborate: {
      status: 'run',
      log: `${amend1.ref} amends ${msa.ref}, which P_t already traces to its pages; K_t holds its ${lower(pay)} as “${oldPay.main}” (${oldPay.tag}).`,
    },
    validate: {
      status: 'run',
      verdict: 'Admitted',
      log: `e_t ≠ ∅: the ${clauses} clauses are legible and corroborated. Their conflict with ${[oldPay, oldRate].filter(Boolean).map((k) => k.tag).join(' and ')} is not an error: it is left to Reconcile.`,
    },
    write: {
      status: 'run',
      log: `E_t ← ${pay.src} “${quote}” (p.${PAGE}, bbox ${pay.box.join(',')}) and ${claims.length - 1} more clauses; P_t ← one provenance link per clause.`,
      ops: [
        { reg: 'E', op: 'add', entry: evidence(amend1, `${pay.src.split(' ').pop()} “${quote}”`) },
        ...claims.map((c) => ({ reg: 'P', op: 'add', entry: linkOf(c) })),
      ],
    },
    consolidate: {
      status: 'run',
      log: `K_t ← ${supersede.map((c) => `“${c.value}”`).join(' and ')} as pending versions of the ${supersede.map(lower).join(' and the ')}${fresh.length ? `, and the new fact “${fresh[0].label}: ${fresh[0].value}”` : ''}; Γ_t ← ${amend1.ref} amends ${msa.ref}.`,
      ops: [
        ...supersede.map((c) => ({ reg: 'K', op: 'add', entry: fact(c, 'pending') })),
        ...fresh.map((c) => ({ reg: 'K', op: 'add', entry: fact(c) })),
        { reg: 'G', op: 'add', entry: edge('amd1-amends', 'amend1', amend1.ref, 'amends', msa.ref) },
      ],
    },
    reconcile: {
      status: 'run',
      log: `𝒱_t closes “${oldPay.main}” on ${close} and opens “${pay.value}” from ${amend1.effective}${oldRate ? ` (likewise ${oldRate.main} → ${rate.value})` : ''}; K_t now holds “${pay.value}”; P_t keeps the old links, marked superseded.`,
      inv: 'Superseded claims keep their provenance links.',
      ops: reconcileOps,
    },
    authorize: { status: 'run', log: 'A_t is read and kept: no policy event in this session.' },
    forget: { status: 'off', log: 'No deletion request in this session, so 𝒰_unl is not applied.' },
    answer: { status: 'run' },
  };

  const query = { key: pay.key, day: today, text: `${pay.label} on ${longDay(today)}?` };
  const scenario = makeScenario({
    id: 'admit',
    kind: 'Admit',
    name: amend1.title.replace(/\s+to\s+.*$/, ''),
    brief: {
      start: `${startLine(msa, sow2)}, consolidated`,
      input: `${amend1.ref} · ${amend1.title}, effective ${amend1.effective}`,
    },
    query,
    start,
    script,
    note: (hit, state) => {
      const prev = hit && state.V.find((v) => v.key === hit.key && v.to === dayBefore(hit.from));
      return prev ? `supersedes ${prev.src}` : '';
    },
  });
  return { scenario, end: scenario.states[scenario.states.length - 1] };
}

/* (b) Reject at the gate: a misread invoice cell never enters the state. */
function rejectOcr({ msa, sow2, amend1, inv, noisy, today, start }) {
  const field = inv.fields.find((f) => f.key === noisy.key) || { label: noisy.key };
  const cur = lookup(start, noisy.key, today);
  const prev = cur && start.V.find((v) => v.key === noisy.key && v.to === dayBefore(cur.from));
  const skipped = { status: 'skip', log: 'Skipped: the gate rejected the observation, so S_t+1 = S_t.' };
  const script = {
    observe: {
      status: 'run',
      log: `o_t ← ${inv.ref}, the invoice of ${inv.date}: its ${field.label.toLowerCase()} is read as “${noisy.read}”.`,
    },
    corroborate: {
      status: 'run',
      log: `P_t and K_t give the ${field.label.toLowerCase()} on file: ${cur ? `“${cur.value}” from ${cur.from} (${cur.src})` : 'none'}${prev ? `, “${prev.value}” before (${prev.src})` : ''}.`,
    },
    validate: { status: 'reject', verdict: 'Rejected', log: noisy.why, inv: 'Nothing was written: S_t+1 = S_t.' },
    write: skipped,
    consolidate: skipped,
    reconcile: skipped,
    authorize: skipped,
    forget: skipped,
    answer: { status: 'run' },
  };
  return makeScenario({
    id: 'reject',
    kind: 'Reject at the gate',
    name: 'OCR misread',
    brief: {
      start: startLine(msa, sow2, amend1),
      input: `${inv.ref} · its ${field.label.toLowerCase()} read as “${noisy.read}”`,
    },
    query: { key: noisy.key, day: today, text: `${field.label} on ${longDay(today)}?` },
    start,
    script,
    note: () => `the misread “${noisy.read}” never entered the state`,
  });
}

/* (c) Forget: an erasure request removes SOW-2 from every store. */
function forgetSow({ msa, sow2, amend1, target, erase, today, start }) {
  const scoped = target.fields.find((f) => f.scope);
  const ops = [];
  for (const reg of ['E', 'K', 'G', 'V', 'P']) {
    for (const e of start[reg]) if (e.doc === target.id) ops.push({ reg, op: 'del', id: e.id });
  }
  const quiet = (log) => ({ status: 'quiet', log });
  const script = {
    observe: { status: 'run', log: `No new document this session. X_del ← “${erase.reason}”` },
    corroborate: quiet('No new observation, so there is nothing to corroborate.'),
    validate: quiet('Nothing to admit (e_t = ∅), so nothing is written before Forget.'),
    write: quiet('Nothing admitted: E_t is unchanged.'),
    consolidate: quiet('Nothing new to consolidate.'),
    reconcile: quiet('Nothing new to reconcile.'),
    authorize: { status: 'run', log: 'A_t is read and kept: an erasure request changes data, not policy.' },
    forget: {
      status: 'run',
      log: `𝒰_unl(S_t, X_del) removes ${target.ref} from every store, and its provenance links with it:`,
      list: (erase.effects || []).map((e) => ({ label: `Level ${e.level}`, text: e.text })),
      inv: `The links to ${target.ref} were removed with it, by design.`,
      ops,
    },
    answer: { status: 'run' },
  };
  return makeScenario({
    id: 'forget',
    kind: 'Forget',
    name: 'Erasure request',
    brief: { start: startLine(msa, sow2, amend1), input: `X_del · ${erase.reason}` },
    query: scoped
      ? { key: scoped.key, day: today, scope: scoped.scope, text: `${scoped.label} for ${scoped.scope}?` }
      : { key: 'liability_cap', day: today, text: 'Liability cap?' },
    start,
    script,
    note: (hit) => (hit && scoped && hit.scope !== scoped.scope
      ? `the ${scoped.scope.replace(/ services$/, '')} exception was erased with ${target.ref}`
      : ''),
  });
}

/** Replay the script into one state per step (index 0 = before the session). */
function makeScenario({ id, kind, name, brief, query, start, script, note }) {
  const states = [start];
  const steps = Object.entries(script).map(([stepId, s]) => ({ id: stepId, ...s }));
  for (const s of steps) states.push(applyOps(states[states.length - 1], s.ops));
  const end = states[states.length - 1];
  const hit = lookup(end, query.key, query.day, query.scope);
  const answer = hit
    ? { value: hit.value, cite: `${hit.src}, p.${PAGE}`, note: note(hit, end) }
    : { value: 'no answer in the state', cite: '', note: '' };
  return { id, kind, name, brief, query, steps, states, answer };
}
