// The services an email campaign is about (Advisory, Utility Bill Mgmt,
// ...): a campaign carries `services`, a list of names off the Dropdowns >
// Services board, set by hand from the open campaign's header or the Saved
// Campaigns table.
//
// Pure: scripts/campaignServices.test.mjs runs it under plain Node.
import { getEffectiveDropdownLists } from './dropdownListsStore.js';
import { buildServiceBoard, graveyardTest } from './serviceCategoriesStore.js';

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** A campaign's services, tidied, once each (case-insensitive), in order. */
export function campaignServices(c) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(c?.services) ? c.services : []) {
    const name = clean(raw);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

/** The campaign with `services` set to `list` (removed when empty). */
export function withServices(c, list) {
  const next = campaignServices({ services: list });
  const { services: _drop, ...rest } = c || {};
  return next.length ? { ...rest, services: next } : rest;
}

/** Whether two campaigns carry the same services, order aside. */
export function sameServices(a, b) {
  const x = campaignServices(a).map(s => s.toLowerCase()).sort();
  const y = campaignServices(b).map(s => s.toLowerCase()).sort();
  return x.length === y.length && x.every((s, i) => s === y[i]);
}

/**
 * The services to offer, A to Z: every service on the Services board (the
 * user's boxes plus the Solutions list), less the graveyard (services nobody
 * sells any more).
 */
export function campaignServiceOptions(settings) {
  const solutions = getEffectiveDropdownLists(settings).find(l => l.key === 'solutions')?.options || [];
  const isGraveyard = graveyardTest(settings);
  const names = buildServiceBoard(settings, solutions).flatMap(c => c.items || []).map(clean).filter(Boolean);
  const seen = new Map();
  for (const n of names) if (!isGraveyard(n) && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
