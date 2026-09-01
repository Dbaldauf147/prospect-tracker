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
// What comes back is only ever *added*: unticking an auto-added service
// leaves it unticked, because nothing here removes anything.

// Explicit .js extension: pinned by a plain-Node test
// (scripts/serviceAutoAdd.test.mjs), which resolves the path itself rather
// than through Vite.
import { getEffectiveServiceMetadata } from '../data/serviceCatalog.js';

// A stored list of service names ("A, B"), as an array. '-' is the app's
// blank sentinel and reads as an empty list, same as an empty cell.
export function parseAutoAddList(value) {
  return String(value ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s && s !== '-');
}

// The list back as it's stored.
export function formatAutoAddList(names) {
  return (names || []).map(n => String(n || '').trim()).filter(Boolean).join(', ');
}

// What one service pulls in, per the user's Services tab overrides.
export function autoAddListFor(name, overrides) {
  return parseAutoAddList(getEffectiveServiceMetadata(name, overrides)?.autoAdd);
}

// Which services list `name` as one of their auto-adds — the reverse of the
// column, which nothing stores. Derived from every service's own cell, so
// the detail popup can show both directions.
export function autoAddedByMap(names, overrides) {
  const map = new Map();
  for (const name of names || []) {
    for (const target of autoAddListFor(name, overrides)) {
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
// Transitive: a service pulled in brings its own auto-adds with it, so a
// chain doesn't have to be spelled out on every row. Cycles are fine — each
// trigger is expanded once — and the result keeps the order things were
// pulled in, so the message naming them reads in the order they'd be ticked.
//
// `canonical` maps a stored name to the board's spelling, so a cell typed
// with different casing still ticks the row rather than adding a second
// off-board entry. `present` is what's already in Scope.
export function collectAutoAdds(triggers, overrides, { canonical, present = [] } = {}) {
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
    for (const raw of autoAddListFor(trigger, overrides)) {
      const name = spell(raw);
      const nameKey = String(name || '').trim().toLowerCase();
      // Already in Scope (or already added by another trigger this round):
      // nothing to do, and no second pass over its own list.
      if (!nameKey || have.has(nameKey)) continue;
      have.add(nameKey);
      added.push(name);
      queue.push(name);
    }
  }
  return added;
}
