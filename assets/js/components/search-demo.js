// MTRACE research prototype: ask the fictional contract file a question, in
// English or French, as of a date. search-demo-engine.js expands the query, ranks the
// passages with BM25 for every phrasing, fuses the rankings, filters them by
// validity and either cites a passage in force or abstains. This module
// renders the answer with its evidence, and the trace of how it was found.

import { h, s, mount, roving } from '../lib/dom.js';
import { createEngine, segments, status as statusAt, targetStems, K1, B, RRF_K, RESTATE } from './search-demo-engine.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY = 86400000;
const C = 'c-search-demo';

/* ----------------------------------------------------------- dates */

const toDays = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY;

/** "2026-11-05" → "5 Nov 2026" (or "5 November 2026" when long). */
function fmtDate(iso, long = false) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${long ? MONTHS[m - 1] : MONTHS[m - 1].slice(0, 3)} ${y}`;
}

const looksFrench = (q) => /[àâçéèêëîïôûùüÿœ]/i.test(q) || /\s\?$/.test(q);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listText = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/**
 * Two dates make the point: the day the amendment was signed (in the
 * collection, not yet in force) and the date of the latest document.
 */
function asOfOptions(documents) {
  const amendment = documents.find((d) => d.effective && d.date && d.date < d.effective) || null;
  const latest = documents.map((d) => d.date).filter(Boolean).sort().pop();
  const dates = [...new Set([amendment && amendment.date, latest].filter(Boolean))].sort();
  return { amendment, dates };
}

export default function init(root, ctx) {
  const data = ctx.data(root, 'search-demo');
  const app = root.querySelector('[data-app]');
  if (!data || !app || !Array.isArray(data.passages) || !data.passages.length) return;

  const engine = createEngine({ passages: data.passages, expansions: data.expansions });
  const docs = new Map((data.documents || []).map((d) => [d.id, d]));
  const page = data.page || { width: 600, height: 848 };
  const uid = root.id || 'search-demo';
  const corpus = root.querySelector('[data-corpus]');
  const { amendment, dates } = asOfOptions(data.documents || []);
  if (!dates.length) return;

  const questions = (data.questions || []).filter(Boolean);
  const state = { query: questions[0] || '', asOf: dates[dates.length - 1] };
  const P = (id) => engine.passage(id);

  /* ------------------------------------------------ passage helpers */

  const doc = (p) => docs.get(p.doc) || { ref: p.doc, title: '', regions: [] };

  function regionOf(p) {
    const regions = doc(p).regions || [];
    return regions.find((r) => r.section && r.section === p.section)
      || regions.find((r) => r.text && r.text.replace(/[.:]\s*$/, '') === p.section) || null;
  }

  /** "AMD-1 §1", "INV-2026-0117 · Lines"; with page: "AMD-1 §1 · p.1". */
  function ref(p, withPage = false) {
    const d = doc(p);
    const base = p.section.startsWith('§') ? `${d.ref} ${p.section}` : `${d.ref} · ${p.section}`;
    // The fictional documents are single pages: a passage with a region is on p.1.
    return withPage && regionOf(p) ? `${base} · p.1` : base;
  }

  const noun = (p) => (doc(p).kind === 'Invoice' ? 'passage' : 'clause');

  // Clause headings ("Payment terms.", "Liability.") name what the collection covers.
  const topics = [...new Set(engine.passages.map((p) => {
    const segs = segments(p.text);
    const head = segs.length > 1 && segs[0].text.replace(/[.:]$/, '');
    return head && !/\d/.test(head) && head.split(/\s+/).length <= 3 ? head : null;
  }).filter(Boolean))];

  function validity(p, asOf) {
    const st = statusAt(p, asOf);
    if (st === 'upcoming') return `in force from ${fmtDate(p.valid_from)}`;
    if (p.valid_to) return `in force ${fmtDate(p.valid_from)} – ${fmtDate(p.valid_to)}`;
    return `in force since ${fmtDate(p.valid_from)}`;
  }

  /* --------------------------------------------------------- build */

  const ids = { input: `${uid}-q`, tryLabel: `${uid}-try`, hint: `${uid}-hint`, result: `${uid}-result` };

  const input = h('input', {
    class: `input ${C}__input`, id: ids.input, type: 'search', name: 'q',
    autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search',
    placeholder: 'Ask in English or French…', value: state.query,
  });
  const form = h('form', { class: `${C}__form`, role: 'search', 'aria-label': 'Ask the documents', onSubmit: onAsk },
    h('label', { class: `${C}__label`, for: ids.input }, 'Ask the documents'),
    h('div', { class: `${C}__bar` },
      h('span', { class: `${C}__field` },
        h('span', { class: `${C}__icon`, 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' }),
        input),
      h('button', { class: `btn ${C}__go`, type: 'submit' }, 'Ask')));

  const chips = questions.map((q) => h('button', {
    class: `chip ${C}__chip`, type: 'button', 'aria-pressed': 'false', lang: looksFrench(q) ? 'fr' : null,
    dataset: { q }, onClick: () => ask(q),
  }, looksFrench(q) ? h('span', { class: `${C}__lang`, 'aria-hidden': 'true' }, 'FR') : null, q));
  roving(chips, { orientation: 'horizontal' });
  const tryGroup = h('div', { class: `${C}__try`, role: 'group', 'aria-labelledby': ids.tryLabel },
    h('span', { class: `${C}__k`, id: ids.tryLabel }, 'Try'),
    h('div', { class: `${C}__chips` }, chips));

  const radios = dates.map((value) => h('label', { class: `${C}__opt` },
    h('input', { type: 'radio', name: `${uid}-asof`, value, checked: value === state.asOf, onChange: () => setAsOf(value) }),
    h('span', null, fmtDate(value))));
  const asOfBox = h('fieldset', { class: `${C}__asof`, 'aria-describedby': amendment ? ids.hint : null },
    h('legend', { class: `${C}__k` }, 'As of'),
    h('div', { class: `${C}__seg` }, radios),
    amendment ? h('p', { class: `${C}__hint`, id: ids.hint },
      `${amendment.ref} signed ${fmtDate(amendment.date)}, in force from ${fmtDate(amendment.effective)}`) : null);

  const result = h('section', { class: `${C}__result`, id: ids.result, 'aria-label': 'Answer' });
  const traceInfo = h('span', { class: `${C}__trace-info` });
  const steps = h('ol', { class: `${C}__steps` });
  const trace = h('details', { class: `${C}__trace` },
    h('summary', { class: `${C}__trace-summary` },
      h('span', { class: `${C}__trace-title` }, 'How this answer was found'), traceInfo),
    steps);

  mount(app,
    h('div', { class: `${C}__console` },
      form,
      h('div', { class: `${C}__controls` }, tryGroup, asOfBox),
      result),
    trace);
  app.hidden = false;

  // The interactive answer now leads; the collection stays one click away,
  // unless the page was opened on one of its rows.
  const target = location.hash && root.querySelector(`[id="${CSS.escape(decodeURIComponent(location.hash.slice(1)))}"]`);
  if (corpus && !(target && corpus.contains(target))) corpus.open = false;

  function onAsk(event) {
    event.preventDefault();
    ask(input.value);
  }

  function ask(q) {
    state.query = String(q).trim();
    input.value = state.query;
    run(true);
  }

  function setAsOf(value) {
    state.asOf = value;
    run(true);
  }

  /* ---------------------------------------------------------- run */

  function run(userAction) {
    const r = engine.ask(state.query, state.asOf);
    const fusedById = new Map(r.fused.map((f) => [f.id, f]));
    r.targets = (id) => {
      const f = fusedById.get(id);
      if (r.answer && id === r.answer.id && !(f && f.grounded)) return new Set(r.answer.shared || []);
      return targetStems(f);
    };
    r.entry = (id) => fusedById.get(id) || null;

    for (const chip of chips) chip.setAttribute('aria-pressed', String(chip.dataset.q === state.query));
    mount(result, renderResult(r));
    if (userAction && !ctx.reducedMotion) {
      result.classList.remove('is-fresh');
      void result.offsetWidth; // restart the entrance animation
      result.classList.add('is-fresh');
    }
    renderTrace(r);
    updateCorpus(r);
    if (userAction) ctx.announce(announcement(r));
  }

  /* -------------------------------------------------------- answer */

  function verdict(tone, label, r) {
    return h('div', { class: `${C}__verdict` },
      h('span', { class: `badge badge--${tone}` }, label),
      h('span', { class: `${C}__when` }, `as of ${fmtDate(r.asOf)}`));
  }

  /** The passage text, its evidence clause highlighted and matched words set off. */
  function quote(p, targets, cls) {
    const { segment, hits } = engine.evidence(p.id, targets || new Set());
    const text = p.text;
    let a = segment ? segment.start : -1;
    let z = segment ? segment.end : -1;
    while (z > a && /[.;:,]/.test(text[z - 1])) z -= 1;
    const cuts = [...new Set([0, text.length, a, z, ...hits.flatMap((x) => [x.start, x.end])].filter((i) => i >= 0))].sort((m, n) => m - n);
    const out = h('p', { class: cls });
    let mark = null;
    for (let k = 0; k < cuts.length - 1; k += 1) {
      const [from, to] = [cuts[k], cuts[k + 1]];
      const piece = text.slice(from, to);
      const node = hits.some((x) => x.start <= from && to <= x.end) ? h('span', { class: `${C}__hit` }, piece) : document.createTextNode(piece);
      if (a >= 0 && from >= a && to <= z) {
        if (!mark) { mark = h('mark', { class: `${C}__span` }); out.append(mark); }
        mark.append(node);
      } else {
        mark = null;
        out.append(node);
      }
    }
    return out;
  }

  function refLink(p, cls = '') {
    return h('a', { class: `${C}__ref ${cls}`.trim(), href: `#${uid}-${p.id}`, onClick: () => { if (corpus) corpus.open = true; } }, ref(p, true));
  }

  function cite(p, r) {
    const d = doc(p);
    return h('p', { class: `${C}__cite` },
      refLink(p),
      h('span', { class: `${C}__cite-meta` }, [d.title, `dated ${fmtDate(d.date)}`, validity(p, r.asOf)].filter(Boolean).join(' · ')));
  }

  function evidence(p, r, tone) {
    return h('div', { class: `bbox ${C}__evidence ${C}__evidence--${tone}`, dataset: { label: `Evidence · ${ref(p)}` } },
      h('div', { class: `${C}__evidence-main` },
        h('blockquote', { class: `${C}__quote` }, quote(p, r.targets(p.id), `${C}__quote-text`)),
        cite(p, r)),
      pageThumb(p));
  }

  function item(p, r, badge, note) {
    return h('li', { class: `${C}__item` },
      h('div', { class: `${C}__item-head` },
        h('span', { class: `badge badge--${badge[0]}` }, badge[1]),
        refLink(p, `${C}__ref--sm`)),
      quote(p, r.targets(p.id), `${C}__item-quote`),
      note ? h('p', { class: `${C}__item-note` }, note) : null);
  }

  function historyNote(p) {
    const next = p.superseded_by && P(p.superseded_by);
    const span = `In force ${fmtDate(p.valid_from)} – ${fmtDate(p.valid_to)}`;
    return next ? `${span}; superseded by ${ref(next)} on ${fmtDate(next.valid_from)}.` : `${span}.`;
  }

  function groups(r) {
    const answer = r.answer && P(r.answer.id);
    const out = [];
    const group = (title, items) => h('section', { class: `${C}__group` }, h('h3', { class: `divider-label ${C}__group-title` }, title), h('ul', { class: `${C}__items` }, items));
    if (r.history.length) {
      out.push(group('History', r.history.map((id) => item(P(id), r, ['muted', 'Superseded'], historyNote(P(id))))));
    }
    if (r.upcoming.length) {
      out.push(group('Not yet in force', r.upcoming.map((id) => {
        const p = P(id);
        const replaces = answer && answer.superseded_by === id;
        const signed = `${doc(p).kind === 'Amendment' ? 'Signed' : 'Dated'} ${fmtDate(doc(p).date)}`;
        return item(p, r, ['warn', `From ${fmtDate(p.valid_from)}`], replaces
          ? `${signed}; replaces the answer above from ${fmtDate(p.valid_from, true)}.`
          : `${signed}; takes effect on ${fmtDate(p.valid_from, true)}.`);
      })));
    }
    if (r.related.length) {
      out.push(group('Related context', r.related.map((id) => item(P(id), r, ['ok', 'In force'],
        `Also matches ${r.entry(id).covered} of the ${plural(r.concepts.length, 'key term')}; not used for the answer.`))));
    }
    return out.length ? h('div', { class: `${C}__groups` }, out) : null;
  }

  function renderResult(r) {
    return h('div', { class: `${C}__card`, dataset: { outcome: r.outcome } }, resultBody(r));
  }

  /** The card's children for each outcome (falsy entries are skipped by h()). */
  function resultBody(r) {
    if (r.outcome === 'answer') {
      const p = P(r.answer.id);
      return [
        verdict('ok', 'Answer', r),
        evidence(p, r, 'answer'),
        r.answer.via && h('p', { class: `${C}__via` }, `Found through ${ref(P(r.answer.via))}, the clause it replaces.`),
        groups(r),
      ];
    }
    if (r.outcome === 'upcoming') {
      const p = P(r.upcoming[0]);
      return [
        verdict('warn', 'Not yet in force', r),
        h('p', { class: `${C}__headline` }, `No ${noun(p)} on this is in force on ${fmtDate(r.asOf, true)}.`),
        h('p', { class: `${C}__sub` }, `One takes effect on ${fmtDate(p.valid_from, true)}:`),
        evidence(p, r, 'upcoming'),
        laterButton(p.valid_from),
      ];
    }
    if (r.outcome === 'history') {
      const p = P(r.history[0]);
      const next = p.superseded_by && P(p.superseded_by);
      return [
        verdict('warn', 'Superseded', r),
        h('p', { class: `${C}__headline` }, `Nothing in force on ${fmtDate(r.asOf, true)} states this.`),
        h('p', { class: `${C}__sub` }, `Until ${fmtDate(p.valid_to, true)}, ${ref(p)} did:`),
        evidence(p, r, 'history'),
        next && h('p', { class: `${C}__via` }, `${ref(next)} superseded it on ${fmtDate(next.valid_from, true)} without restating it, so the demo abstains rather than guess.`),
      ];
    }
    if (r.outcome === 'abstain') {
      const best = r.fused[0];
      const terms = listText(r.concepts.map((c) => `“${c.label}”`));
      return [
        verdict('muted', 'Abstained', r),
        h('p', { class: `${C}__headline` }, 'I can’t answer that from these documents.'),
        h('p', { class: `${C}__sub` },
          `Searched the ${engine.size} passages${r.variants.length > 1 ? ` in ${plural(r.variants.length, 'phrasing')}` : ''} for ${terms}. `,
          best
            ? `The closest, ${ref(P(best.id))}, covers ${best.covered} of the ${plural(r.concepts.length, 'key term')}; an answer needs ${r.needed}.`
            : 'No passage contains any of them.'),
        best && h('ul', { class: `${C}__items ${C}__items--closest` }, item(P(best.id), r, ['muted', 'Closest'], null)),
        topics.length && h('p', { class: `${C}__topics` }, `The collection covers ${listText(topics.map((t) => t.toLowerCase()))}.`),
      ];
    }
    return [
      h('p', { class: `${C}__headline` }, state.query ? 'Nothing to search for.' : 'Ask a question about the documents.'),
      h('p', { class: `${C}__sub` }, state.query
        ? `“${state.query}” has only common words. Try one of the questions above.`
        : 'Or pick one of the suggested questions.'),
    ];
  }

  /** In the "not yet in force" case, a shortcut to a date when it is. */
  function laterButton(from) {
    const later = dates.find((d) => d >= from);
    if (!later || later === state.asOf) return null;
    return h('p', { class: `${C}__later` },
      h('button', { class: `btn btn--secondary btn--sm`, type: 'button', onClick: () => {
        const radio = radios.map((l) => l.querySelector('input')).find((i) => i.value === later);
        if (radio) { radio.checked = true; radio.focus(); }
        setAsOf(later);
      } }, `See it as of ${fmtDate(later)}`));
  }

  function announcement(r) {
    const when = fmtDate(r.asOf, true);
    if (r.outcome === 'answer') {
      const p = P(r.answer.id);
      const { segment } = engine.evidence(p.id, r.targets(p.id));
      return `Answer as of ${when}, from ${ref(p)}: ${segment ? segment.text : p.text}`;
    }
    if (r.outcome === 'upcoming') return `Nothing in force on ${when}. ${ref(P(r.upcoming[0]))} takes effect on ${fmtDate(P(r.upcoming[0]).valid_from, true)}.`;
    if (r.outcome === 'history') return `Nothing in force on ${when} states this; ${ref(P(r.history[0]))} was superseded.`;
    if (r.outcome === 'abstain') return 'Abstained: no passage in force supports an answer.';
    return 'Nothing to search for.';
  }

  /* --------------------------------------------- page thumbnail */

  function regionShape(r, cited) {
    const [x, y, w, hh] = r.box;
    const g = s('g', { class: `${C}__region${cited ? ' is-cited' : ''}` });
    const bar = (bx, by, bw, bh) => g.append(s('rect', { x: bx, y: by, width: Math.max(bw, 1), height: Math.max(bh, 1), rx: Math.min(3, bh / 2) }));
    if (r.type === 'Title') bar(x, y + hh * 0.18, w * 0.72, hh * 0.64);
    else if (r.type === 'Header') bar(x, y + hh * 0.2, w * 0.78, hh * 0.6);
    else if (r.type === 'Footer') bar(x + w * 0.65, y + hh * 0.2, w * 0.35, hh * 0.6);
    else if (r.type === 'Signature') { bar(x, y + hh - 12, w * 0.38, 5); bar(x + w * 0.62, y + hh - 12, w * 0.38, 5); }
    else if (r.type === 'Table') {
      const rows = Math.max(2, Math.round(hh / 24));
      const rh = hh / rows;
      for (let k = 0; k < rows; k += 1) {
        const ry = y + k * rh + rh * 0.3;
        bar(x, ry, w * 0.4, rh * 0.42);
        bar(x + w * 0.5, ry, w * 0.18, rh * 0.42);
        bar(x + w * 0.8, ry, w * 0.2, rh * 0.42);
      }
    } else {
      const lines = Math.max(1, Math.round(hh / 17));
      const lh = hh / lines;
      for (let k = 0; k < lines; k += 1) bar(x, y + k * lh + lh * 0.25, lines > 1 && k === lines - 1 ? w * 0.58 : w, Math.min(9, lh * 0.5));
    }
    return g;
  }

  function pageThumb(p) {
    const cited = regionOf(p);
    if (!cited) return null;
    const d = doc(p);
    const [x, y, w, hh] = cited.box;
    return h('div', { class: `${C}__page` },
      s('svg', { viewBox: `0 0 ${page.width} ${page.height}`, role: 'img', 'aria-label': `${d.ref}, page 1, with ${p.section} outlined`, preserveAspectRatio: 'xMidYMid meet' },
        s('rect', { class: `${C}__sheet`, x: 2, y: 2, width: page.width - 4, height: page.height - 4, rx: 12 }),
        (d.regions || []).map((r) => regionShape(r, r === cited)),
        s('rect', { class: `${C}__box`, x: x - 12, y: y - 9, width: w + 24, height: hh + 18, rx: 6 })),
      h('span', { class: `${C}__page-label`, 'aria-hidden': 'true' }, 'p.1'));
  }

  /* --------------------------------------------------------- trace */

  function step(num, title, note, ...body) {
    return h('li', { class: `${C}__step` },
      h('div', { class: `${C}__step-head` },
        h('span', { class: `${C}__step-num`, 'aria-hidden': 'true' }, num),
        h('h3', { class: `${C}__step-title` }, title)),
      note ? h('p', { class: `${C}__step-note` }, note) : null,
      h('div', { class: `${C}__step-body` }, ...body));
  }

  function phrasingText(v) {
    return v.parts.map((part) => {
      if (part.from) return h('ins', { class: `${C}__swap`, title: `for “${part.from}”` }, part.text);
      if (part.key) return h('span', { class: `${C}__key` }, part.text);
      return part.text;
    }).flatMap((node, k) => (k ? [' ', node] : [node]));
  }

  function stepExpand(r) {
    const extra = r.variants.length - 1;
    const maps = r.slots.length
      ? h('ul', { class: `${C}__maps` }, r.slots.map((slot) => h('li', null,
          h('span', { class: `${C}__key` }, slot.text), h('span', { class: `${C}__arrow`, 'aria-hidden': 'true' }, ' → '),
          h('span', { class: 'visually-hidden' }, ' expands to '), slot.values.join(' · '))))
      : h('p', { class: `${C}__none` }, 'No phrase of the question is in the expansion table, so only the original is searched.');
    return step('01', 'Expand the query',
      `The original${extra ? ` plus ${plural(extra, 'phrasing')}` : ''} from the bilingual expansion table: longest phrases first, accents and case ignored.`,
      maps,
      h('ol', { class: `${C}__variants` }, r.variants.map((v) => h('li', null,
        h('span', { class: `${C}__vid` }, v.id),
        h('span', { class: `${C}__vtext` }, phrasingText(v)),
        v.original ? h('span', { class: `${C}__vtag` }, 'original') : null))));
  }

  function stepRank(r) {
    const top = Math.max(0, ...r.variants.flatMap((v) => v.hits.map((hit) => hit.score))) || 1;
    const cards = r.variants.map((v) => h('div', { class: `${C}__vcard` },
      h('p', { class: `${C}__vcard-head` },
        h('span', { class: `${C}__vid` }, v.id),
        h('span', { class: `${C}__vterms` }, v.terms.length ? v.terms.map((t) => t.surface).join(' · ') : 'no key terms')),
      v.hits.length
        ? h('ol', { class: `${C}__hits` }, v.hits.slice(0, 3).map((hit) => h('li', { style: `--w: ${(hit.score / top).toFixed(3)}` },
            h('span', { class: `${C}__hit-ref` }, ref(P(hit.id))),
            h('span', { class: `${C}__score`, title: `matches ${hit.matched.join(', ')}` }, hit.score.toFixed(2)))))
        : h('p', { class: `${C}__none` }, 'No passage matches.'),
      v.hits.length > 3 ? h('p', { class: `${C}__more` }, `+ ${v.hits.length - 3} more`) : null));
    return step('02', 'Rank each phrasing with BM25',
      `k1 = ${K1}, b = ${B}, over all ${engine.size} passages. Lowercased, accents stripped, English and French stopwords dropped, light stemming (capped → cap). Top 3 per phrasing.`,
      h('div', { class: `${C}__vgrid` }, cards));
  }

  function stepFuse(r) {
    const body = r.fused.length
      ? h('div', { class: `table-wrap ${C}__mini-wrap`, role: 'region', tabindex: '0', 'aria-label': 'Fused ranking' },
          h('table', { class: `table ${C}__mini` },
            h('thead', null, h('tr', null,
              h('th', { scope: 'col', class: 'num' }, '#'), h('th', { scope: 'col' }, 'Passage'),
              h('th', { scope: 'col' }, 'Rank per phrasing'), h('th', { scope: 'col', class: 'num' }, 'Score'))),
            h('tbody', null, r.fused.slice(0, 6).map((f, k) => h('tr', null,
              h('td', { class: 'num' }, String(k + 1)),
              h('th', { scope: 'row' }, ref(P(f.id))),
              h('td', null, f.ranks.map((x) => `${x.variant} #${x.rank}`).join(' · ')),
              h('td', { class: 'num' }, f.score.toFixed(4)))))))
      : h('p', { class: `${C}__none` }, 'Nothing to fuse: no phrasing matched a passage.');
    return step('03', 'Fuse the rankings', `Reciprocal rank fusion: score = Σ 1 / (${RRF_K} + rank) over the phrasings that retrieve the passage.`, body);
  }

  function stepTime(r) {
    const idsShown = r.fused.slice(0, 6).map((f) => f.id);
    const reached = r.answer && r.answer.via && !idsShown.includes(r.answer.id) ? r.answer.id : null;
    if (reached) idsShown.push(reached);
    if (!idsShown.length) return step('04', `Filter by date, as of ${fmtDate(r.asOf)}`, null, h('p', { class: `${C}__none` }, 'No passage to filter.'));
    return step('04', `Filter by date, as of ${fmtDate(r.asOf)}`,
      'A passage whose validity ended before the date becomes history; one that starts after it is not yet in force.',
      timeline(idsShown.map(P), r.asOf, reached ? { [reached]: `replaces ${ref(P(r.answer.via))}` } : {}));
  }

  function timeline(list, asOf, extra = {}) {
    const all = engine.passages;
    const first = all.map((p) => p.valid_from).filter(Boolean).sort()[0];
    const last = [...all.flatMap((p) => [p.valid_from, p.valid_to]), ...dates].filter(Boolean).sort().pop();
    const start = toDays(`${first.slice(0, 7)}-01`);
    const [ly, lm] = last.split('-').map(Number);
    const end = toDays(`${lm === 12 ? ly + 1 : ly}-${String(lm === 12 ? 1 : lm + 1).padStart(2, '0')}-01`);
    const pct = (iso) => `${(((toDays(iso) - start) / (end - start)) * 100).toFixed(2)}%`;
    const months = [];
    for (let m = new Date(start * DAY); m.getTime() / DAY < end; m.setUTCMonth(m.getUTCMonth() + 1)) months.push(m.toISOString().slice(0, 10));

    const rows = list.map((p) => {
      const st = statusAt(p, asOf);
      const next = p.superseded_by && P(p.superseded_by);
      let label = `In force since ${fmtDate(p.valid_from)}`;
      if (st === 'history') label = next ? `History · superseded by ${ref(next)} on ${fmtDate(next.valid_from)}` : `History · ended ${fmtDate(p.valid_to)}`;
      else if (st === 'upcoming') label = `Not yet in force · from ${fmtDate(p.valid_from)}`;
      else if (p.valid_to) label = `In force until ${fmtDate(p.valid_to)}`;
      if (extra[p.id]) label += ` · ${extra[p.id]}`;
      const endIso = p.valid_to ? new Date((toDays(p.valid_to) + 1) * DAY).toISOString().slice(0, 10) : null;
      const left = pct(p.valid_from);
      const width = `calc(${endIso ? pct(endIso) : '100%'} - ${left})`;
      return h('li', { class: `${C}__tl-row`, dataset: { status: st } },
        h('span', { class: `${C}__tl-ref` }, ref(P(p.id))),
        h('span', { class: `${C}__tl-track`, 'aria-hidden': 'true' },
          h('span', { class: `${C}__tl-bar${endIso ? '' : ' is-open'}`, style: { left, width } }),
          h('span', { class: `${C}__tl-now`, style: { left: pct(asOf) } })),
        h('span', { class: `${C}__tl-status` }, label));
    });

    return h('div', { class: `${C}__tl` },
      h('div', { class: `${C}__tl-axis`, 'aria-hidden': 'true' },
        h('span', { class: `${C}__tl-ref` }),
        h('span', { class: `${C}__tl-scale` },
          months.map((m) => h('span', { class: `${C}__tl-month`, style: { left: pct(m) } }, MONTHS[+m.slice(5, 7) - 1].slice(0, 3))),
          h('span', { class: `${C}__tl-asof`, style: { left: pct(asOf) } }, fmtDate(asOf).replace(/ \d{4}$/, ''))),
        h('span', { class: `${C}__tl-status` })),
      h('ol', { class: `${C}__tl-rows` }, rows));
  }

  function trailText(t, r) {
    const f = r.entry(t.id);
    const p = P(t.id);
    const covers = `covers ${f.covered} of ${r.concepts.length}`;
    if (t.verdict === 'weak') return `${covers}; needs ${r.needed}. Not used.`;
    if (t.verdict === 'answer') return `${covers}, in force. Answer.`;
    if (t.verdict === 'handoff') {
      return `${covers}, but superseded. ${ref(P(t.to))} restates it (${t.restate.shared.length} of its ${t.restate.size} words), so the answer comes from ${ref(P(t.to))}.`;
    }
    if (t.verdict === 'history') {
      if (!t.to) return `${covers}, but no longer in force. History.`;
      return `${covers}, but superseded by ${ref(P(t.to))}, which repeats only ${t.restate.shared.length} of its ${t.restate.size} words. History only.`;
    }
    if (t.verdict === 'upcoming') return `${covers}, not in force until ${fmtDate(p.valid_from)}. Noted, not used.`;
    if (r.related.includes(t.id)) return `${covers}, in force. Related context.`;
    return `${covers}. Ranked below the answer.`;
  }

  function stepGround(r) {
    const rule = `Answer only from a passage in force that covers every key term, directly or through an expansion (one may be missing when there are four or more). A superseded passage hands over to its replacement only if the replacement restates it, repeating at least ${Math.round(RESTATE * 100)}% of its words.`;
    let final = 'Nothing to check.';
    if (r.outcome === 'answer') final = `Answer from ${ref(P(r.answer.id))}.`;
    else if (r.outcome === 'upcoming') final = `No passage in force covers the question; ${ref(P(r.upcoming[0]))} will from ${fmtDate(P(r.upcoming[0]).valid_from)}.`;
    else if (r.outcome === 'history') final = 'Only superseded evidence covers the question: abstain.';
    else if (r.outcome === 'abstain') final = 'No passage in force covers the question: abstain.';
    return step('05', 'Check the grounding', rule,
      r.concepts.length
        ? h('p', { class: `${C}__concepts` },
            h('span', { class: `${C}__concepts-k` }, `Key terms (${r.needed} of ${r.concepts.length} needed)`),
            r.concepts.map((c) => h('span', { class: `${C}__concept` }, c.label,
              c.expanded ? h('span', { class: `${C}__concept-alt` }, ` or ${c.expanded.join(' / ')}`) : null)))
        : null,
      r.trail.length
        ? h('ol', { class: `${C}__verdicts` }, r.trail.slice(0, 6).map((t) => h('li', { dataset: { verdict: t.verdict } },
            h('span', { class: `${C}__verdict-ref` }, ref(P(t.id))), ' ', trailText(t, r))))
        : null,
      h('p', { class: `${C}__final` }, final));
  }

  function traceSummary(r) {
    if (!r.concepts.length) return 'nothing to search';
    const bits = [plural(r.variants.length, 'phrasing'), r.fused.length ? `${plural(r.fused.length, 'passage')} fused` : 'no match'];
    const superseded = r.fused.filter((f) => f.status === 'history').length;
    if (superseded) bits.push(`${superseded} superseded`);
    bits.push({ answer: 'answer', upcoming: 'not in force yet', history: 'abstain', abstain: 'abstain' }[r.outcome]);
    return bits.join(' · ');
  }

  function renderTrace(r) {
    traceInfo.textContent = traceSummary(r);
    mount(steps, stepExpand(r), stepRank(r), stepFuse(r), stepTime(r), stepGround(r));
  }

  /* -------------------------------------------------------- corpus */

  const STATUS = { 'in-force': ['ok', 'In force'], history: ['muted', 'Superseded'], upcoming: ['warn', 'Not yet in force'] };

  function updateCorpus(r) {
    const head = root.querySelector('[data-status-head]');
    if (head) head.textContent = `On ${fmtDate(r.asOf)}`;
    const roles = new Map();
    for (const id of r.related) roles.set(id, 'Related');
    for (const id of r.upcoming) roles.set(id, 'Upcoming');
    for (const id of r.history) roles.set(id, 'History');
    if (r.answer) roles.set(r.answer.id, 'Answer');
    else if (r.outcome === 'upcoming') roles.set(r.upcoming[0], 'Evidence');
    else if (r.outcome === 'history') roles.set(r.history[0], 'Evidence');
    for (const row of root.querySelectorAll('tr[data-passage]')) {
      const p = P(row.dataset.passage);
      if (!p) continue;
      const [tone, label] = STATUS[statusAt(p, r.asOf)];
      const cell = row.querySelector('[data-status]');
      if (cell) mount(cell, h('span', { class: `badge badge--${tone}` }, label));
      const role = roles.get(p.id);
      const sec = row.querySelector(`.${C}__sec`);
      sec.querySelector(`.${C}__role`)?.remove();
      if (role) {
        row.dataset.role = role.toLowerCase();
        sec.append(h('span', { class: `${C}__role` }, role));
      } else {
        delete row.dataset.role;
      }
    }
  }

  run(false);
}
