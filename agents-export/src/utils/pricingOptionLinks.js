// Pricing-option ↔ Opp links — a per-user map of `oppId → optionName`
// that backs the "Pricing Option" column on the Opps 2 tab.
//
// The link is owned by the Pricing tab (that's where the user saves an
// option to an opp). Opps 2 reads this map and renders the value as a
// computed column — the opp record itself never carries the option
// name, so the two tabs can't disagree about which option is current.
//
// Storage: pricing-cache store, key `optionLinks`. Cross-tab updates
// are broadcast via the `pricing:optionLinksChanged` window event so
// the Opps 2 view re-renders the moment the user saves from Pricing.

import { dbGet, dbPut } from './db';

const PRICING_STORE = 'pricing-cache';
const LINKS_KEY = 'optionLinks';
const EVENT_NAME = 'pricing:optionLinksChanged';

export async function loadOptionLinks() {
  try {
    const val = await dbGet(PRICING_STORE, LINKS_KEY);
    return (val && typeof val === 'object') ? val : {};
  } catch {
    return {};
  }
}

async function persistOptionLinks(links) {
  try { await dbPut(PRICING_STORE, links, LINKS_KEY); } catch { /* idb best-effort */ }
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: links }));
  } catch { /* SSR / non-DOM environment */ }
}

// Set / clear a single oppId → optionName entry. Passing a falsy
// optionName removes the link. Returns the new full map.
export async function setOppOptionLink(oppId, optionName) {
  if (oppId == null) return null;
  const links = await loadOptionLinks();
  const next = { ...links };
  const key = String(oppId);
  const name = typeof optionName === 'string' ? optionName.trim() : '';
  if (!name) delete next[key];
  else next[key] = name;
  await persistOptionLinks(next);
  return next;
}

// When an option is renamed in the Pricing tab, point every link that
// still references the old name at the new one so the Opps 2 column
// stays accurate without a manual re-save.
export async function renameOptionInLinks(oldName, newName) {
  const oldN = String(oldName || '').trim();
  const newN = String(newName || '').trim();
  if (!oldN || oldN === newN) return null;
  const links = await loadOptionLinks();
  let touched = false;
  const next = {};
  for (const [k, v] of Object.entries(links)) {
    if (v === oldN) { next[k] = newN; touched = true; }
    else next[k] = v;
  }
  if (!touched) return links;
  await persistOptionLinks(next);
  return next;
}

// Drop every link pointing at an option name — used when the user
// deletes an Option from the Pricing tab.
export async function dropOptionFromLinks(optionName) {
  const target = String(optionName || '').trim();
  if (!target) return null;
  const links = await loadOptionLinks();
  let touched = false;
  const next = {};
  for (const [k, v] of Object.entries(links)) {
    if (v === target) { touched = true; continue; }
    next[k] = v;
  }
  if (!touched) return links;
  await persistOptionLinks(next);
  return next;
}

export const OPTION_LINKS_EVENT = EVENT_NAME;
