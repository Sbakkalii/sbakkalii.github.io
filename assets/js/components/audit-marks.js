// Matrix marks shared by the audit, substrates and lineage figures (Tables
// I-IV of the paper). Every cell is a glyph plus the paper's own mark, so no
// reading depends on colour: ✓ and Yes are a filled disc, Partial a half
// disc, Implicit a dotted ring, – an empty ring, and qualified marks (Page,
// Box, Ext. index, Context only …) a dashed chip. The Liquid partials emit
// the same markup for the static tables.
import { h } from '../lib/dom.js';

const KINDS = { '✓': 'full', Yes: 'full', Partial: 'partial', Implicit: 'implicit', '–': 'none' };

// Marks whose glyph already draws the symbol: their text stays for assistive
// technology and copy-paste but is hidden on screen.
const SYMBOLS = new Set(['✓', '–']);

/** 'full' | 'partial' | 'implicit' | 'none' | 'qual' */
export function markKind(value) {
  return KINDS[value] || 'qual';
}

/** <span class="mk mk--full">… for one cell value. */
export function mark(value, extraClass) {
  const text = value == null || value === '' ? '–' : String(value);
  return h('span', { class: ['mk', `mk--${markKind(text)}`, SYMBOLS.has(text) && 'mk--sym', extraClass] },
    h('span', { class: 'mk__g', 'aria-hidden': 'true' }),
    h('span', { class: 'mk__t' }, text));
}

/** Count values in first-seen order: [{ value, count, items }]. */
export function tally(entries) {
  const groups = new Map();
  for (const { value, item } of entries) {
    if (!groups.has(value)) groups.set(value, { value, count: 0, items: [] });
    const g = groups.get(value);
    g.count += 1;
    if (item !== undefined) g.items.push(item);
  }
  return [...groups.values()];
}

/** "A", "A and B", "A, B and C". */
export function listText(items) {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** Small counts as words ("ten document benchmarks"), larger ones as digits. */
export function numberWord(n) {
  return WORDS[n] || String(n);
}

/** Sort tallies: full marks first, then qualified, partial, implicit, none. */
const ORDER = { full: 0, qual: 1, partial: 2, implicit: 3, none: 4 };
export function byMark(a, b) {
  return ORDER[markKind(a.value)] - ORDER[markKind(b.value)] || b.count - a.count;
}
