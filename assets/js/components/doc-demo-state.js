// State engine for the hero demo (doc-demo.js). Pure functions, no DOM.
//
// Reading documents 0..k in date order, starting from an empty memory, gives
// the claims held after document k and, for document k itself, one event per
// extracted field. Each field carries one of the reconciliation outcomes from
// _data/demo.yml, applied as follows:
//   new              write a claim, valid from the document's effective date
//   supersede        close the earlier claim the day before, write the new one
//   scope-coexist    write a claim for a different scope; both stay in force
//   support          add the document as corroborating provenance
//   retain-conflict  write the claim, keep the one in force, flag both
//   escalate         hold the claim for review; the claim in force stands
// A field without an outcome (the first document) is new.

export const FLAG_OUTCOMES = new Set(['retain-conflict', 'escalate']);

/** ISO date one day earlier: "2026-11-01" → "2026-10-31". */
export function dayBefore(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Short reference for chips: "MSA-2026-014" → "MSA", "AMD-1" stays. */
export function shortRef(ref) {
  return String(ref || '').replace(/-\d{4}-\d+$/, '');
}

const sameScope = (a, b) => (a.scope || '') === (b.scope || '');

function makeClaim(field, doc, from, status = 'open') {
  return {
    id: `${doc.id}:${field.key}`,
    key: field.key,
    label: field.label,
    value: field.value,
    scope: field.scope || '',
    doc,
    region: field.region,
    from,
    to: null,
    status,            // open | closed | conflict | review
    flagged: false,
    corroborations: [], // [{ doc, region }]
  };
}

/** Apply one field of `doc` to `claims` (mutated) and describe what happened. */
function reconcile(claims, field, doc) {
  const from = doc.effective || doc.date;
  let outcome = field.outcome || 'new';
  const live = claims.filter((c) => c.key === field.key && c.status === 'open');
  const lineage = live.filter((c) => sameScope(c, field));
  const closed = () => claims.filter((c) => c.key === field.key && c.status === 'closed' && sameScope(c, field));
  const row = (claim, role) => ({ claim, role });
  const event = { outcome, field, doc, note: field.note || '', rows: [] };

  if (outcome === 'support' && !lineage.length) outcome = event.outcome = 'new';

  switch (outcome) {
    case 'supersede': {
      for (const old of lineage) {
        old.status = 'closed';
        old.to = dayBefore(from);
      }
      const claim = makeClaim(field, doc, from);
      claims.push(claim);
      event.rows = [row(claim, 'primary'), ...closed().map((c) => row(c, 'closed'))];
      break;
    }
    case 'scope-coexist': {
      const claim = makeClaim(field, doc, from);
      claims.push(claim);
      event.rows = [row(claim, 'primary'), ...live.filter((c) => !sameScope(c, field)).map((c) => row(c, 'coexists'))];
      break;
    }
    case 'support': {
      const target = lineage[0];
      target.corroborations.push({ doc, region: field.region });
      event.observed = field.value;
      event.rows = [row(target, 'primary')];
      break;
    }
    case 'retain-conflict':
    case 'escalate': {
      const claim = makeClaim(field, doc, doc.date, outcome === 'escalate' ? 'review' : 'conflict');
      claim.flagged = true;
      if (outcome === 'retain-conflict') lineage.forEach((c) => { c.flagged = true; });
      claims.push(claim);
      event.rows = [row(claim, 'primary'), ...lineage.map((c) => row(c, 'in-force'))];
      break;
    }
    default: {
      const claim = makeClaim(field, doc, from);
      claims.push(claim);
      event.rows = [row(claim, 'primary')];
    }
  }
  return event;
}

const RANK = { open: 0, conflict: 0, review: 1, closed: 2 };

/**
 * Replay documents[0..upto]. Returns the current document, its events, the
 * claims carried from earlier documents (grouped by field, current before
 * closed), and counts for the panel.
 */
export function replay(documents, upto) {
  const claims = [];
  let events = [];
  let flags = 0;
  documents.slice(0, upto + 1).forEach((doc) => {
    events = (doc.fields || []).map((field) => reconcile(claims, field, doc));
    flags += events.filter((e) => FLAG_OUTCOMES.has(e.outcome)).length;
  });

  const shown = new Set(events.flatMap((e) => e.rows.map((r) => r.claim)));
  const keyOrder = [...new Set(claims.map((c) => c.key))];
  const carried = claims
    .filter((c) => !shown.has(c))
    .sort((a, b) => keyOrder.indexOf(a.key) - keyOrder.indexOf(b.key)
      || RANK[a.status] - RANK[b.status]
      || claims.indexOf(a) - claims.indexOf(b));

  return {
    doc: documents[upto],
    events,
    carried,
    counts: {
      inForce: claims.filter((c) => c.status === 'open' || c.status === 'conflict').length,
      closed: claims.filter((c) => c.status === 'closed').length,
      flags,
    },
  };
}
