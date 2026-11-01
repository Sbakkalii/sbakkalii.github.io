// Shared model for the two reconciliation demos (reconcile.js on the paper
// page, doc-inspector.js on the products page).
//
// It replays the fictional document stream of _data/demo.yml into a claims
// ledger: each extracted field either opens a new claim or meets the claims
// already stored for the same key, with the outcome the data assigns to it
// (support, supersede, scope-coexist, retain-conflict, escalate). The paper
// names these five outcomes; "new" (nothing stored yet) is ours.

import { h, s } from '../lib/dom.js';

export const NEW = 'new';
export const REJECTED = 'rejected';

/* ------------------------------------------------------------------ dates */

const DAY = 86400000;

/** "2026-03-02" → UTC milliseconds (no time-zone drift). */
export function parseDay(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
export const dayBefore = (iso) => isoDay(parseDay(iso) - DAY);

// Three-letter months ("Sep", not en-GB's "Sept"), day first.
const MON = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
export const monthShort = (ms) => MON.format(ms);

/** 2 Mar */
export function fmtDay(iso) {
  const ms = parseDay(iso);
  return `${new Date(ms).getUTCDate()} ${monthShort(ms)}`;
}
/** 2 Mar 2026 */
export const fmtDate = (iso) => `${fmtDay(iso)} ${new Date(parseDay(iso)).getUTCFullYear()}`;

/** A document's claims hold from its effective date, or else from its date. */
export const validFrom = (doc) => doc.effective || doc.date;

/* ------------------------------------------------------------- documents */

/** Short handle for a document: "MSA-2026-014" → "MSA"; "SOW-2" stays. */
export function shortRef(ref) {
  const m = /^([A-Z]+)-\d{4}-\d+$/.exec(String(ref));
  return m ? m[1] : String(ref);
}

/**
 * The table cell a field value was read from, as [row, column], matched on
 * the printed text ("€3.10" for "€3.10 / pallet-week"). Null for text regions.
 */
export function matchCell(region, value) {
  if (!region || !Array.isArray(region.rows)) return null;
  const v = String(value).trim();
  for (let r = 1; r < region.rows.length; r++) {
    const row = region.rows[r];
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c]).trim();
      if (cell && (cell === v || v.startsWith(`${cell} `))) return [r, c];
    }
  }
  return null;
}

/* ---------------------------------------------------------------- replay */

function newClaim(doc, field) {
  return {
    id: `${doc.id}:${field.key}`,
    key: field.key,
    label: field.label,
    value: field.value,
    scope: field.scope || '',
    doc,
    field,
    from: validFrom(doc),
    to: '',
    outcome: field.outcome || NEW,
    closedBy: null,
    corroborations: [],
    conflicts: [],
    coexists: [],
  };
}

const copy = (claim) => ({ ...claim });

/**
 * Read the first `count` documents in order.
 *
 * Returns
 *   claims  ledger rows, mutated as later documents close or flag them;
 *   events  one per field read: { doc, field, outcome, claim, prior, active,
 *           closed, target, read, why };
 *   queue   escalated observations, held for a person (not in the ledger).
 *
 * `noisy` (demo.noisy_observation) replaces one observation by a misreading
 * that the pre-write gate rejects: its event is "rejected" and nothing is
 * written.
 */
export function replay(documents, { count = documents.length, noisy = null } = {}) {
  const claims = [];
  const events = [];
  const queue = [];

  for (const doc of documents.slice(0, count)) {
    for (const field of doc.fields || []) {
      const history = claims.filter((c) => c.key === field.key);
      const active = history.filter((c) => !c.to);
      const event = { doc, field, prior: history.map(copy), active, closed: [] };

      if (noisy && noisy.document === doc.id && noisy.key === field.key) {
        events.push({ ...event, outcome: REJECTED, read: noisy.read, why: noisy.why });
        continue;
      }

      const claim = newClaim(doc, field);
      const sameScope = active.filter((c) => c.scope === claim.scope);
      event.outcome = claim.outcome;
      event.claim = claim;

      switch (claim.outcome) {
        case 'supersede':
          // Close the earlier claim the day before the new one takes effect.
          for (const old of sameScope) {
            old.to = dayBefore(claim.from);
            old.closedBy = claim;
          }
          event.closed = sameScope;
          claims.push(claim);
          break;
        case 'support':
          // No new row: the stored claim gains a corroborating source.
          event.target = sameScope[0] || active[0] || null;
          if (event.target) event.target.corroborations.push(claim);
          break;
        case 'scope-coexist':
          claim.coexists = active.slice();
          for (const c of active) c.coexists.push(claim);
          claims.push(claim);
          break;
        case 'retain-conflict':
          claim.conflicts = active.slice();
          for (const c of active) c.conflicts.push(claim);
          claims.push(claim);
          break;
        case 'escalate':
          // Held for review; the state does not change.
          queue.push({ doc, field, claim, against: active.slice() });
          break;
        default:
          claims.push(claim);
      }
      events.push(event);
    }
  }
  return { claims, events, queue };
}

/**
 * Apply the first `level` levels of an erasure request for document
 * `target` to a list of claims (doc-inspector). Level 1 deletes the file
 * only, so every derived claim remains. Level 2 removes the embeddings and
 * graph nodes, i.e. the standalone claims; a claim that was reconciled into
 * an existing field's schema survives in the consolidated store, without its
 * evidence. Level 3 repairs those schemas, and nothing of the target remains.
 */
export function erase(claims, target, level) {
  if (!level || !target) return claims;
  const out = [];
  for (const c of claims) {
    if (c.doc.id !== target) {
      out.push(c);
    } else if (level === 1) {
      out.push({ ...c, residual: 'file' });
    } else if (level === 2 && c.outcome !== NEW) {
      out.push({ ...c, residual: 'schema' });
    }
  }
  return out;
}

/* ------------------------------------------------------------ typesetting */

// Symbols the served font subsets lack (system fallbacks draw them unevenly),
// drawn instead; the character stays in the text for copy and screen readers.
const SYMBOLS = {
  '≠': 'M2.4 4.6h7.2M2.4 7.4h7.2M7.8 2.2 4.2 9.8',
  '↔': 'M1.6 6h8.8M4.2 3.4 1.6 6l2.6 2.6M7.8 3.4 10.4 6 7.8 8.6',
  '→': 'M1.8 6h8.2M7.2 3.2 10 6 7.2 8.8',
};
const SYMBOL_RE = /([≠↔→]|\d{4}-\d{2}-\d{2})/;

/**
 * Typeset a data string: the symbols above become a drawn glyph in a span of
 * class `sym`; ISO dates go in a span of class `keep` that does not break at
 * its hyphens. Returns strings and elements, for h() and mount().
 */
export function withSymbols(text, { sym, keep }) {
  return String(text).split(SYMBOL_RE).filter(Boolean).map((part) => {
    if (SYMBOLS[part]) {
      return h('span', { class: sym },
        s('svg', { viewBox: '0 0 12 12', 'aria-hidden': 'true', focusable: 'false' },
          s('path', { d: SYMBOLS[part], fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })),
        h('span', { class: 'visually-hidden' }, part));
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(part)) return h('span', { class: keep }, part);
    return part;
  });
}

/* ----------------------------------------------------------------- icons */

const ICON_PATHS = {
  [NEW]: 'M6 2.6v6.8M2.6 6h6.8',
  support: 'M2.4 6.3 4.8 8.6 9.6 3.5',
  supersede: 'M2 6h7.3M6.6 3.3 9.3 6 6.6 8.7',
  'scope-coexist': 'M4.3 2.3v7.4M7.7 2.3v7.4',
  'retain-conflict': 'M2.4 4.6h7.2M2.4 7.4h7.2M7.8 2.2 4.2 9.8',
  escalate: 'M6 9.6V2.6M3.3 5.3 6 2.6l2.7 2.7',
  [REJECTED]: 'M3.2 3.2l5.6 5.6M8.8 3.2 3.2 8.8',
  read: 'M2.5 6h7',
};

/** Small stroke icon for an outcome (decorative: always next to a label). */
export function icon(name, cls = '') {
  return s('svg', { class: cls, viewBox: '0 0 12 12', width: 12, height: 12, 'aria-hidden': 'true', focusable: 'false' },
    s('path', { d: ICON_PATHS[name] || ICON_PATHS.read, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
}

/** Display name of an outcome, from the paper's list (_data/paper.yml). */
export function outcomeName(id, outcomes) {
  if (id === NEW) return 'New claim';
  if (id === REJECTED) return 'Rejected at the gate';
  const o = (outcomes || []).find((x) => x.id === id);
  return o ? o.name : id;
}
