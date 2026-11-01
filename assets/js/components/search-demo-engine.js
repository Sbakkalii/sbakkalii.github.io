// Retrieval for the search demo (a research prototype of MTRACE): semantic
// query expansion, BM25 for every phrasing, reciprocal rank fusion, a
// temporal validity filter, and a strict grounding check that abstains when
// no passage in force supports an answer. Pure functions over the fictional
// passages of _data/demo.yml; no DOM, so it can be tested on its own.

export const K1 = 1.2;
export const B = 0.75;
export const RRF_K = 60;
export const RESTATE = 0.5;   // share of words a replacement must repeat

// A small English + French stopword list, accents already stripped.
const STOPWORDS = new Set(`
a about all also am an and any are as at be been but by can could did do does
for from had has have how i if in into is it its many me much my no not of on
or our please so than that the their them then there these they this those to
us was we were what whats when where which who whom whose why will with would
you your
au aux avec ce ces cet cette combien comment d dans de des du elle elles en est
et il ils je l la le les leur leurs lui ma mais mes mon ne nos notre nous ou par
pas pour qu quand que quel quelle quelles quels qui quoi sa se ses son sont sur
ta te tes ton tu un une vos votre y
`.trim().split(/\s+/));

/* ------------------------------------------------------------- text */

/** Lowercase and strip accents: "Délai" → "delai". */
export function normalize(text) {
  return String(text).toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '');
}

/** Word tokens with their offsets in the original text. */
export function words(text) {
  const out = [];
  for (const m of String(text).matchAll(/[\p{L}\p{N}]+/gu)) {
    out.push({ surface: m[0], norm: normalize(m[0]), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export const isStop = (norm) => STOPWORDS.has(norm) || (norm.length === 1 && !/\d/.test(norm));

function undouble(w) {
  const last = w[w.length - 1];
  return w.length > 2 && last === w[w.length - 2] && !'aeiouylsz'.includes(last) ? w.slice(0, -1) : w;
}

/** Light suffix stripping (plural, -ed, -ing, final -e): capped → cap, days → day. */
export function stem(word) {
  let w = word;
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.endsWith('ing') && w.length > 5) w = undouble(w.slice(0, -3));
  else if (w.endsWith('ed') && w.length > 4) w = undouble(w.slice(0, -2));
  if (w.endsWith('e') && w.length > 4) w = w.slice(0, -1);
  return w;
}

/** Informative words of a token list, with their stems. */
const informative = (tokens) => tokens.filter((t) => !isStop(t.norm)).map((t) => ({ ...t, stem: stem(t.norm) }));

/** Stems of the informative words of a text. */
export const terms = (text) => informative(words(text)).map((t) => t.stem);

/* ------------------------------------------------------- expansion */

// "costs" still finds the key "cost", "données" the key "données".
const same = (a, b) => a === b || a === `${b}s` || `${a}s` === b;

function prepareExpansions(table) {
  return Object.entries(table || {})
    .map(([key, values]) => ({ key, values: [].concat(values || []).map(String), toks: words(key).map((w) => w.norm) }))
    .filter((e) => e.toks.length && e.values.length)
    .sort((a, b) => normalize(b.key).length - normalize(a.key).length);
}

/** Phrases of the query found in the expansion table, longest keys first. */
function findSlots(qwords, table) {
  const used = new Array(qwords.length).fill(false);
  const slots = [];
  for (const entry of table) {
    const n = entry.toks.length;
    for (let i = 0; i + n <= qwords.length; i += 1) {
      if (used.slice(i, i + n).some(Boolean)) continue;
      if (!entry.toks.every((t, j) => same(qwords[i + j].norm, t))) continue;
      slots.push({ start: i, end: i + n, key: entry.key, values: entry.values, text: qwords.slice(i, i + n).map((w) => w.surface).join(' ') });
      used.fill(true, i, i + n);
    }
  }
  return slots.sort((a, b) => a.start - b.start);
}

const joinSurface = (tokens) => tokens.map((t) => t.surface).join(' ');

/**
 * Phrasing number `pick` of the query: 0 is the original; k ≥ 1 replaces
 * every matched phrase by its k-th expansion (or its last one).
 */
function phrasing(qwords, slots, pick) {
  const parts = [];
  const tokens = [];
  let i = 0;
  const plain = (to) => {
    if (i >= to) return;
    const seg = qwords.slice(i, to);
    parts.push({ text: joinSurface(seg) });
    tokens.push(...seg);
  };
  for (const slot of slots) {
    plain(slot.start);
    if (pick) {
      const value = slot.values[Math.min(pick, slot.values.length) - 1];
      parts.push({ text: value, from: slot.text });
      tokens.push(...words(value));
    } else {
      const seg = qwords.slice(slot.start, slot.end);
      parts.push({ text: joinSurface(seg), key: true });
      tokens.push(...seg);
    }
    i = slot.end;
  }
  plain(qwords.length);
  return { parts, terms: informative(tokens).map(({ surface, stem: s }) => ({ surface, stem: s })) };
}

/* ------------------------------------------------------------ BM25 */

function buildIndex(passages) {
  const docs = passages.map((p, i) => {
    const t = terms(p.text);
    const tf = new Map();
    for (const s of t) tf.set(s, (tf.get(s) || 0) + 1);
    return { id: p.id, i, len: t.length, tf, set: new Set(t) };
  });
  const n = docs.length || 1;
  const avgdl = docs.reduce((sum, d) => sum + d.len, 0) / n || 1;
  const df = new Map();
  for (const d of docs) for (const s of d.set) df.set(s, (df.get(s) || 0) + 1);
  const idf = (s) => {
    const k = df.get(s) || 0;
    return Math.log(1 + (n - k + 0.5) / (k + 0.5));
  };
  return { docs, byId: new Map(docs.map((d) => [d.id, d])), n, avgdl, idf };
}

/** BM25 (k1 = 1.2, b = 0.75) of one phrasing; every passage that scores. */
function bm25(index, qterms) {
  const unique = [...new Map(qterms.map((t) => [t.stem, t])).values()];
  const hits = [];
  for (const d of index.docs) {
    let score = 0;
    const matched = [];
    for (const t of unique) {
      const f = d.tf.get(t.stem);
      if (!f) continue;
      score += index.idf(t.stem) * (f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / index.avgdl));
      matched.push(t.surface);
    }
    if (score > 0) hits.push({ id: d.id, i: d.i, score, matched });
  }
  hits.sort((a, b) => b.score - a.score || a.i - b.i);
  hits.forEach((h, r) => { h.rank = r + 1; });
  return hits;
}

/** Reciprocal rank fusion: score = Σ 1 / (60 + rank) over the phrasings. */
function fuse(variants) {
  const acc = new Map();
  for (const v of variants) {
    for (const h of v.hits) {
      const e = acc.get(h.id) || { id: h.id, i: h.i, score: 0, ranks: [] };
      e.score += 1 / (RRF_K + h.rank);
      e.ranks.push({ variant: v.id, rank: h.rank });
      acc.set(h.id, e);
    }
  }
  const best = (e) => Math.min(...e.ranks.map((r) => r.rank));
  return [...acc.values()].sort((a, b) => b.score - a.score || best(a) - best(b) || a.i - b.i);
}

/* ------------------------------------------------------------ time */

/** 'history' (superseded or expired), 'upcoming' (not yet in force) or 'in-force'. */
export function status(p, asOf) {
  if (p.valid_to && p.valid_to < asOf) return 'history';
  if (p.valid_from && p.valid_from > asOf) return 'upcoming';
  return 'in-force';
}

/* ------------------------------------------------------- grounding */

/**
 * The key terms of the question. A phrase found in the expansion table is
 * one concept, matched by its own words or by any of its expansions; every
 * other informative word is a concept of its own.
 */
function conceptsOf(qwords, slots) {
  const list = [];
  const seen = new Set();
  const push = (c) => {
    const sig = c.alts.map((a) => a.join('+')).join('|');
    if (!seen.has(sig)) { seen.add(sig); list.push(c); }
  };
  const slotAt = new Map();
  for (const slot of slots) for (let k = slot.start; k < slot.end; k += 1) slotAt.set(k, slot);
  qwords.forEach((w, k) => {
    const slot = slotAt.get(k);
    if (slot) {
      if (k !== slot.start) return;
      const own = informative(qwords.slice(slot.start, slot.end)).map((t) => t.stem);
      const alts = [...new Map([own, ...slot.values.map(terms)].filter((a) => a.length).map((a) => [a.join('+'), a])).values()];
      if (alts.length) push({ label: slot.text, alts, expanded: slot.values });
    } else if (!isStop(w.norm)) {
      push({ label: w.surface, alts: [[stem(w.norm)]] });
    }
  });
  return list;
}

/** Every key term is required; one may be missing when there are four or more. */
export const needed = (n) => (n <= 3 ? n : n - 1);

function coverage(concepts, set) {
  return concepts.map((c) => c.alts.find((alt) => alt.every((s) => set.has(s))) || null);
}

/* ------------------------------------------------------------- ask */

export function createEngine({ passages = [], expansions = {} } = {}) {
  const list = passages.map((p, i) => ({ ...p, i }));
  const byId = new Map(list.map((p) => [p.id, p]));
  const index = buildIndex(list);
  const table = prepareExpansions(expansions);

  /** Words the replacement shares with the passage it replaces. */
  function restates(oldId, newId) {
    const a = index.byId.get(oldId);
    const b = index.byId.get(newId);
    if (!a || !b || !a.set.size) return { shared: [], ratio: 0, size: 0 };
    const shared = [...a.set].filter((s) => b.set.has(s));
    return { shared, ratio: shared.length / a.set.size, size: a.set.size };
  }

  /** The passage in force that replaced p, following superseded_by links. */
  function successor(p, asOf) {
    let next = p.superseded_by && byId.get(p.superseded_by);
    const seen = new Set([p.id]);
    while (next && status(next, asOf) === 'history' && next.superseded_by && !seen.has(next.id)) {
      seen.add(next.id);
      next = byId.get(next.superseded_by);
    }
    return next || null;
  }

  function ask(query, asOf) {
    const text = String(query || '').trim();
    const qwords = words(text);
    const slots = findSlots(qwords, table);
    const concepts = conceptsOf(qwords, slots);
    const need = needed(concepts.length);

    // 1. Expansion: the original plus one phrasing per expansion rank.
    const variants = [];
    const seen = new Set();
    const rounds = slots.reduce((m, s) => Math.max(m, s.values.length), 0);
    for (let pick = 0; pick <= rounds; pick += 1) {
      const v = phrasing(qwords, slots, pick);
      const sig = v.terms.map((t) => t.stem).join(' ');
      if (pick && (seen.has(sig) || !sig)) continue;
      seen.add(sig);
      variants.push({ id: `V${variants.length}`, original: !pick, text: pick ? v.parts.map((p) => p.text).join(' ') : text, ...v });
    }

    // 2–3. BM25 per phrasing, then fusion.
    for (const v of variants) v.hits = bm25(index, v.terms);
    const fused = fuse(variants);

    // 4–5. Time filter and grounding, in fused order.
    for (const f of fused) {
      const p = byId.get(f.id);
      f.status = status(p, asOf);
      f.alts = coverage(concepts, index.byId.get(f.id).set);
      f.covered = f.alts.filter(Boolean).length;
      f.grounded = concepts.length > 0 && f.covered >= need;
    }

    let answer = null;
    const history = [];
    const upcoming = [];
    const trail = [];
    for (const f of fused) {
      const p = byId.get(f.id);
      if (!f.grounded) { trail.push({ id: f.id, verdict: 'weak' }); continue; }
      if (answer) { trail.push({ id: f.id, verdict: f.status === 'in-force' ? 'also' : f.status }); continue; }
      if (f.status === 'in-force') {
        answer = { id: f.id, via: null };
        trail.push({ id: f.id, verdict: 'answer' });
      } else if (f.status === 'history') {
        history.push(f.id);
        const next = successor(p, asOf);
        const r = next ? restates(p.id, next.id) : null;
        if (next && status(next, asOf) === 'in-force' && r.ratio >= RESTATE) {
          answer = { id: next.id, via: p.id, shared: r.shared };
          trail.push({ id: f.id, verdict: 'handoff', to: next.id, restate: r });
        } else {
          trail.push({ id: f.id, verdict: 'history', to: next ? next.id : null, restate: r });
        }
      } else {
        upcoming.push(f.id);
        trail.push({ id: f.id, verdict: 'upcoming' });
      }
    }

    // With an answer, history is what it replaced (its superseded_by chain),
    // and "upcoming" adds what will replace it.
    if (answer) {
      history.length = 0;
      const replaced = (id) => list.filter((p) => p.superseded_by === id && status(p, asOf) === 'history');
      const queue = [answer.id];
      while (queue.length) {
        for (const p of replaced(queue.shift())) {
          if (!history.includes(p.id)) { history.push(p.id); queue.push(p.id); }
        }
      }
      if (answer.via && !history.includes(answer.via)) history.unshift(answer.via);
      const later = byId.get(byId.get(answer.id).superseded_by);
      if (later && status(later, asOf) === 'upcoming' && !upcoming.includes(later.id)) upcoming.unshift(later.id);
      for (const f of fused) {
        if (f.grounded && f.status === 'upcoming' && !upcoming.includes(f.id)) upcoming.push(f.id);
      }
    }

    // Related context: other passages in force covering half the key terms (at least two).
    const related = answer
      ? fused.filter((f) => f.id !== answer.id && f.id !== answer.via && f.status === 'in-force'
          && f.covered >= Math.max(2, Math.ceil(concepts.length / 2))).slice(0, 2).map((f) => f.id)
      : [];

    let outcome = 'abstain';
    if (!concepts.length) outcome = 'empty';
    else if (answer) outcome = 'answer';
    else if (upcoming.length) outcome = 'upcoming';
    else if (history.length) outcome = 'history';

    return { query: text, asOf, slots, variants, fused, concepts, needed: need, outcome, answer, history, upcoming, related, trail };
  }

  /**
   * Where to highlight a passage: the clause body that best matches the
   * target stems (a leading heading such as "Payment terms." is skipped),
   * and the individual words that match.
   */
  function evidence(id, targets) {
    const p = byId.get(id);
    const segs = segments(p.text);
    const skipHead = segs.length > 1 && (segs[0].text.endsWith(':') || words(segs[0].text).length <= 3);
    let best = null;
    segs.forEach((seg, k) => {
      if (skipHead && k === 0) return;
      const n = new Set(informative(words(seg.text)).map((t) => t.stem).filter((s) => targets.has(s))).size;
      if (!best || n > best.n) best = { ...seg, n };
    });
    const hits = informative(words(p.text)).filter((t) => targets.has(t.stem)).map(({ start, end }) => ({ start, end }));
    return { segment: best, hits };
  }

  return { passages: list, passage: (id) => byId.get(id), ask, evidence, restates, size: list.length };
}

/** Clauses of a passage: split after . ; : followed by a space. */
export function segments(text) {
  const out = [];
  const re = /[.;:](?=\s)/g;
  let start = 0;
  let m;
  while ((m = re.exec(text))) {
    out.push([start, m.index + 1]);
    start = m.index + 1;
  }
  out.push([start, text.length]);
  return out.map(([a, z]) => {
    while (a < z && /\s/.test(text[a])) a += 1;
    while (z > a && /\s/.test(text[z - 1])) z -= 1;
    return { start: a, end: z, text: text.slice(a, z) };
  }).filter((s) => s.end > s.start);
}

/** Stems that a passage matched for the question (its covering alternatives). */
export function targetStems(fusedEntry) {
  return new Set((fusedEntry?.alts || []).filter(Boolean).flat());
}
