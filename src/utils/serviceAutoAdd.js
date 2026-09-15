// Services that come with other services.
//
// Some services are never sold alone: putting CSRD readiness in an opp's
// Scope means the GHG inventory behind it is in scope too, and typing both
// every time is how one of them gets forgotten. The Dropdowns › Services tab
// carries an "Auto-add Services" cell per service naming what it pulls in;
// this module reads those cells and answers the one question the Scope
// picker asks: given what was just ticked, what else belongs in Scope?
//
// The rule fires where a person picks services (the Scope board), not on
// import or paste — an existing opp's Scope is what it is, and rewriting it
// behind a sync would change history rather than help someone choose.
//
// What comes back is only ever *added*: nothing here removes anything, so
// unticking an auto-added service leaves it unticked - until a later tick
// implies it again, which is the point of the rule rather than a hole in
// it. See collectAutoAdds.

// Explicit .js extension: pinned by a plain-Node test
// (scripts/serviceAutoAdd.test.mjs), which resolves the path itself rather
// than through Vite.
import { getEffectiveServiceMetadata } from '../data/serviceCatalog.js';
import { splitServiceNames, joinServiceNames } from './serviceNameList.js';

// A stored list of service names ("A, B"), as an array. '-' is the app's
// blank sentinel and reads as an empty list, same as an empty cell.
//
// `known` — every service name there is — lets a name with a comma in it
// ("Cat 3, 5, 6, and 7 (part of GHG)") come back whole instead of as four
// fragments; see src/utils/serviceNameList.js. Callers that have the list to
// hand should pass it, and every caller that can, does.
export function parseAutoAddList(value, known) {
  return splitServiceNames(value, known).filter(s => s !== '-');
}

// The list back as it's stored.
export function formatAutoAddList(names) {
  return joinServiceNames(names);
}

// What one service pulls in, per the user's Services tab overrides.
export function autoAddListFor(name, overrides, known) {
  return parseAutoAddList(getEffectiveServiceMetadata(name, overrides)?.autoAdd, known);
}

// Which services list `name` as one of their auto-adds — the reverse of the
// column, which nothing stores. Derived from every service's own cell, so
// the detail popup can show both directions.
export function autoAddedByMap(names, overrides) {
  const map = new Map();
  for (const name of names || []) {
    // The rows themselves are the list of known names, so a cell naming a
    // service with a comma in it lands on that service's row.
    for (const target of autoAddListFor(name, overrides, names)) {
      const key = target.trim().toLowerCase();
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(name);
    }
  }
  return map;
}

// Everything `triggers` implies that isn't already there.
//
// Transitive, and transitive THROUGH what is already in Scope: a service
// pulled in brings its own auto-adds with it, and so does one the Scope
// already held. Ticking Strategic sourcing, which names Client sends
// invoices, which names Client management, puts Client management in Scope
// whether or not Client sends invoices was already there - because what the
// tick implies does not depend on the order somebody got here in. A Scope
// that arrived by paste or import never ran this at all, so the service in
// the middle of a chain is exactly the one likely to be sitting there with
// its own list unresolved.
//
// The cost, which is real: a service taken off an opp by hand comes back if
// something ticked later implies it. It is the same trade the rule makes
// everywhere else - an auto-add is a statement that these are sold together
// - and the picker names what it added, so a second removal is one click.
//
// Cycles are fine (each service is expanded once) and the result keeps the
// order things were pulled in, so the message naming them reads in the
// order they'd be ticked.
//
// `canonical` maps a stored name to the board's spelling, so a cell typed
// with different casing still ticks the row rather than adding a second
// off-board entry. `present` is what's already in Scope.
// `names` is every service the board knows, used both to rebuild a name with
// a comma in it and (via `canonical`) to spell it the way the board does.
//
// `stopAtPresent` puts the old behaviour back for the one caller that wants
// it: Account Potential's bundling, where `present` is the services other
// bundles have already claimed and walking through one would drag that
// bundle's tail into this one's money. A deal is being divided up there,
// not chosen.
export function collectAutoAdds(
  triggers,
  overrides,
  { canonical, present = [], names, stopAtPresent = false } = {},
) {
  const spell = typeof canonical === 'function' ? canonical : (n => n);
  const have = new Set(present.map(n => String(n || '').trim().toLowerCase()).filter(Boolean));
  const expanded = new Set();
  const queue = [...(triggers || [])];
  const added = [];

  while (queue.length > 0) {
    const trigger = queue.shift();
    const key = String(trigger || '').trim().toLowerCase();
    if (!key || expanded.has(key)) continue;
    expanded.add(key);
    for (const raw of autoAddListFor(trigger, overrides, names)) {
      const name = spell(raw);
      const nameKey = String(name || '').trim().toLowerCase();
      if (!nameKey) continue;
      // Already in Scope (or already added by another trigger this round):
      // nothing to add. Its own list is still walked, since that list is
      // just as true today as it was when the service arrived - unless the
      // caller is dividing a deal rather than choosing one.
      if (have.has(nameKey)) {
        if (!stopAtPresent) queue.push(name);
        continue;
      }
      have.add(nameKey);
      added.push(name);
      queue.push(name);
    }
  }
  return added;
}
