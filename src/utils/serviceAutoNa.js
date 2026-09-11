// Services that stop being questions once something else is sold.
//
// The mirror image of the Auto-add column (src/utils/serviceAutoAdd.js):
// where that one says "selling this means selling that too", this one says
// "selling this means that one is off the table". Sell the full RA platform
// and the standalone data feed underneath it isn't a gap any more — but the
// services board still shows it blank, so it reads as unexplored territory
// on every account that bought the bigger thing, and somebody goes and asks
// about it.
//
// The Dropdowns › Services tab carries an "Auto-N/A Services" cell per
// service naming what it retires; this module reads those cells and answers
// the question both status boards ask: given what this account has already
// bought, which services need no answer?
//
// Derived, never written. Nothing here saves an N/A onto a company record —
// the boards layer it under whatever the account actually says, so:
//
//   manual status  >  the stage of an opp naming the service  >  auto-N/A
//
// A person who disagrees just picks a status, which outranks this and stays
// picked. Clear the cell on the Services tab and every account's board drops
// the N/A again, because none of them ever stored one.
//
// Not transitive, unlike the auto-add chain: the trigger is a service that
// was *sold*, and a service marked N/A by this rule was not sold — it was
// ruled out. So its own list stays dormant, and a chain of retirements
// can't run away from one closed deal.

// Explicit .js extensions: pinned by a plain-Node test
// (scripts/serviceAutoNa.test.mjs), which resolves the paths itself rather
// than through Vite.
import { getEffectiveServiceMetadata } from '../data/serviceCatalog.js';
import { parseAutoAddList, formatAutoAddList } from './serviceAutoAdd.js';

// The stored list shape is the same as the auto-add column's ("A, B", with
// '-' reading as blank, and names that contain commas rebuilt against the
// list of services that exist), so the parsing is too rather than being
// written twice and drifting.
export const parseAutoNaList = parseAutoAddList;
export const formatAutoNaList = formatAutoAddList;

// What counts as sold. Only the closed-won status: "Renewal" and the
// in-flight stages are conversations still running, and retiring a service
// off the back of one would mean un-retiring it if that deal slipped.
export function isSoldStatus(status) {
  return String(status ?? '').trim().toLowerCase() === 'sold';
}

// What one service retires, per the user's Services tab overrides. `known` —
// every service name there is — lets a name with a comma in it come back
// whole rather than as fragments; see src/utils/serviceNameList.js.
export function autoNaListFor(name, overrides, known) {
  return parseAutoNaList(getEffectiveServiceMetadata(name, overrides)?.autoNa, known);
}

// Which services list `name` in their Auto-N/A cell — the reverse of the
// column, which nothing stores. Derived from every service's own cell, so
// the detail popup can show both directions.
export function autoNaedByMap(names, overrides) {
  const map = new Map();
  for (const name of names || []) {
    // The rows themselves are the known names, so a cell naming a service
    // with a comma in it lands on that service's row.
    for (const target of autoNaListFor(name, overrides, names)) {
      const key = target.trim().toLowerCase();
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(name);
    }
  }
  return map;
}

// Everything the sold services imply is N/A, as service → the sold services
// that say so (so a board can name the reason rather than just greying a row
// out).
//
// `canonical` maps a stored name to the board's spelling, so a cell typed
// with different casing still lands on the row rather than on nothing.
// A sold service is never itself N/A — two services that retire each other
// and are both sold simply cancel out.
// `names` is every service the board knows, used both to rebuild a name with
// a comma in it and (via `canonical`) to spell it the way the board does.
export function collectAutoNa(sold, overrides, { canonical, names } = {}) {
  const spell = typeof canonical === 'function' ? canonical : (n => n);
  const soldKeys = new Set(
    (sold || []).map(n => String(n || '').trim().toLowerCase()).filter(Boolean),
  );
  const out = new Map();
  for (const trigger of sold || []) {
    if (!String(trigger || '').trim()) continue;
    for (const raw of autoNaListFor(trigger, overrides, names)) {
      const name = spell(raw);
      const key = String(name || '').trim().toLowerCase();
      if (!key || soldKeys.has(key)) continue;
      if (!out.has(name)) out.set(name, []);
      const reasons = out.get(name);
      if (!reasons.includes(trigger)) reasons.push(trigger);
    }
  }
  return out;
}

// The sentence the boards put on a row that this rule greyed out, so the
// N/A is explainable wherever it shows up.
export function autoNaTitle(item, reasons) {
  const list = (reasons || []).filter(Boolean);
  if (list.length === 0) return '';
  return `N/A automatically: ${list.join(' and ')} ${list.length > 1 ? 'are' : 'is'} sold on this account, `
    + `and the Auto-N/A Services column on Dropdowns › Services retires ${item} with ${list.length > 1 ? 'them' : 'it'}. `
    + 'Pick a status to overrule it.';
}
