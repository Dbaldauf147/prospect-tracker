// The commodities a scope covers: Electric, Natural Gas, Water, Waste, and
// whatever else the user adds.
//
// Stored beside the services rather than among them. A commodity is what
// the work is about; a service is what gets done. Putting "Electric" into
// the Scope string would hand it to every reader that treats Scope as a
// list of service names - the Pipeline coverage table, the company card's
// services board, scopeMatch - and each would carry it as a service it has
// never heard of.
//
// The vocabulary is an ordinary Dropdowns list (`commodities`), so adding
// one or renaming the standard four is the same edit as any other list on
// that page, and needs nothing here.

import { getEffectiveDropdownLists } from './dropdownListsStore.js';

/** The opp field the picks are written to. */
export const COMMODITY_COLUMN = 'Commodities';

/** The Dropdowns list the vocabulary comes from. */
export const COMMODITY_LIST_KEY = 'commodities';

const clean = (v) => String(v ?? '').trim();

/**
 * The commodities on offer, as the user's own list has them.
 *
 * Falls back to nothing rather than to the built-in four: an empty list is
 * a deliberate state (somebody cleared it), and quietly restoring the
 * defaults would make it impossible to turn the row off.
 */
export function commodityOptions(settings) {
  const list = getEffectiveDropdownLists(settings).find(l => l.key === COMMODITY_LIST_KEY);
  const out = [];
  const seen = new Set();
  for (const raw of (list?.options || [])) {
    const name = clean(raw);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * A stored value as a list of names.
 *
 * Accepts the comma-separated string the opp field holds and the array the
 * Deal Sizing scope holds, because the same picker writes both.
 */
export function parseCommodities(value) {
  const raw = Array.isArray(value) ? value : clean(value).split(',');
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const name = clean(item);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** How the opp field stores them: comma-separated, like Scope. */
export const formatCommodities = (list) => parseCommodities(list).join(', ');

/**
 * Toggle one commodity in a selection.
 *
 * Kept in the list's own order rather than the order they were clicked, so
 * two opps carrying the same commodities read identically wherever they
 * are shown side by side.
 */
export function toggleCommodity(selected, name, options) {
  const target = clean(name);
  if (!target) return parseCommodities(selected);
  const current = new Set(parseCommodities(selected).map(s => s.toLowerCase()));
  const key = target.toLowerCase();
  if (current.has(key)) current.delete(key);
  else current.add(key);
  const ordered = (options || []).filter(o => current.has(clean(o).toLowerCase()));
  // Anything ticked that the list no longer offers is kept: a commodity
  // removed from the vocabulary should not silently vanish off the opps
  // that already carry it.
  const known = new Set(ordered.map(o => clean(o).toLowerCase()));
  const strays = parseCommodities(selected).filter(s => current.has(s.toLowerCase()) && !known.has(s.toLowerCase()));
  return [...ordered, ...strays];
}

/** Whether a name is ticked, case-insensitively. */
export function hasCommodity(selected, name) {
  const key = clean(name).toLowerCase();
  return parseCommodities(selected).some(s => s.toLowerCase() === key);
}

/**
 * The picks split into the ones the list still offers and the ones it
 * doesn't, so a picker can show a stray as ticked without pretending it is
 * part of the standard vocabulary.
 */
export function splitCommodities(selected, options) {
  const known = new Set((options || []).map(o => clean(o).toLowerCase()));
  const picks = parseCommodities(selected);
  return {
    known: picks.filter(p => known.has(p.toLowerCase())),
    strays: picks.filter(p => !known.has(p.toLowerCase())),
  };
}
