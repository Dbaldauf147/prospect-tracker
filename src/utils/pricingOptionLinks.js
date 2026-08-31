// Pricing-option ↔ Opp links — a per-user map of `oppId → link` that
// backs the "Pricing Option" column on the Opps 2 tab.
//
// The link is owned by the Pricing tab (that's where the user saves an
// option to an opp). Opps 2 reads this map and renders the value as a
// computed column — the opp record itself never carries the option
// name, so the two tabs can't disagree about which option is current.
//
// A link value is `{ name, source, workbookId }`:
//   • name       — the option / sheet name shown on Opps 2
//   • source     — 'pricing' (SIA workbook subtab) or 'options' (the
//                  hand-built Options subtab). The two surfaces both
//                  use names like "Option 1", so without this a link
//                  saved on one would show up as a chip on the other.
//   • workbookId — for 'pricing' links only: the id of the uploaded SIA
//                  the option came from. Matching on it is what stops a
//                  link from re-attaching itself to a *different* file
//                  that happens to have a sheet with the same name.
// Plain-string values are the legacy shape (name only) and are still
// read; `optionLinkName` normalizes both.
//
// Storage: pricing-cache store, key `optionLinks`. Cross-tab updates
// are broadcast via the `pricing:optionLinksChanged` window event so
// the Opps 2 view re-renders the moment the user saves from Pricing.

import { dbGet } from './db';
import { registerMirroredDbKey, mirrorDbPut } from './localMirrorSync.js';

const PRICING_STORE = 'pricing-cache';
const LINKS_KEY = 'optionLinks';
const EVENT_NAME = 'pricing:optionLinksChanged';

// Mirrored: an opp's link to its pricing option is typed once and read
// for the life of the deal, and nothing can rebuild it from the workbook.
registerMirroredDbKey(PRICING_STORE, LINKS_KEY, EVENT_NAME);

// --- value accessors (tolerate the legacy string shape) -------------

export function optionLinkName(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') return String(value.name || '').trim();
  return '';
}

export function optionLinkSource(value) {
  if (value && typeof value === 'object') return String(value.source || '').trim();
  return ''; // legacy string → unknown surface
}

export function optionLinkWorkbookId(value) {
  if (value && typeof value === 'object') return String(value.workbookId || '').trim();
  return '';
}

// Does this link point at the given option? `source` scopes the match
// to one surface; `workbookId` further scopes 'pricing' links to the
// SIA that's actually loaded. Legacy string links carry neither, so
// they only match when the caller opts in via `allowLegacy` — the
// Pricing subtab does that for a workbook restored from cache (the
// link was made against it, before links were tagged) but never for a
// freshly uploaded file.
function linkMatches(value, { name, source, workbookId, allowLegacy }) {
  const target = String(name || '').trim();
  if (!target || optionLinkName(value) !== target) return false;
  const src = optionLinkSource(value);
  if (!src) return !!allowLegacy;
  if (source && src !== source) return false;
  if (src === 'pricing') {
    // A pricing link belongs to the workbook it was saved from. No id
    // on either side means we can't prove they're the same file, so
    // treat it as a miss rather than guessing.
    const wanted = String(workbookId || '').trim();
    return !!wanted && optionLinkWorkbookId(value) === wanted;
  }
  return true;
}

// First oppId whose link points at the given option, or null.
export function findLinkedOppId(links, criteria) {
  if (!links || typeof links !== 'object') return null;
  for (const [id, v] of Object.entries(links)) {
    if (linkMatches(v, criteria)) return id;
  }
  return null;
}

export async function loadOptionLinks() {
  try {
    const val = await dbGet(PRICING_STORE, LINKS_KEY);
    return (val && typeof val === 'object') ? val : {};
  } catch {
    return {};
  }
}

async function persistOptionLinks(links) {
  try { await mirrorDbPut(PRICING_STORE, LINKS_KEY, links); } catch { /* idb best-effort */ }
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: links }));
  } catch { /* SSR / non-DOM environment */ }
}

// Set / clear a single oppId → option link. Passing a falsy optionName
// removes the link. `meta` carries the owning surface ('pricing' /
// 'options') and, for pricing links, the id of the loaded workbook.
// Returns the new full map.
export async function setOppOptionLink(oppId, optionName, meta = {}) {
  if (oppId == null) return null;
  const links = await loadOptionLinks();
  const next = { ...links };
  const key = String(oppId);
  const name = typeof optionName === 'string' ? optionName.trim() : '';
  if (!name) delete next[key];
  else {
    const entry = { name };
    const source = String(meta.source || '').trim();
    if (source) entry.source = source;
    const workbookId = String(meta.workbookId || '').trim();
    if (workbookId) entry.workbookId = workbookId;
    next[key] = entry;
  }
  await persistOptionLinks(next);
  return next;
}

// When an option is renamed in the Pricing tab, point every link that
// still references the old name at the new one so the Opps 2 column
// stays accurate without a manual re-save. Scoped by surface so an
// Options-subtab rename can't rewrite a same-named pricing link.
export async function renameOptionInLinks(oldName, newName, scope = {}) {
  const oldN = String(oldName || '').trim();
  const newN = String(newName || '').trim();
  if (!oldN || oldN === newN) return null;
  const criteria = { name: oldN, allowLegacy: true, ...scope };
  const links = await loadOptionLinks();
  let touched = false;
  const next = {};
  for (const [k, v] of Object.entries(links)) {
    if (linkMatches(v, criteria)) {
      touched = true;
      next[k] = (v && typeof v === 'object') ? { ...v, name: newN } : { name: newN };
    } else next[k] = v;
  }
  if (!touched) return links;
  await persistOptionLinks(next);
  return next;
}

// Drop every link pointing at an option name — used when the user
// deletes an Option from the Pricing tab. `scope` narrows the match to
// one surface (and, for pricing links, one workbook).
export async function dropOptionFromLinks(optionName, scope = {}) {
  const target = String(optionName || '').trim();
  if (!target) return null;
  const criteria = { name: target, allowLegacy: true, ...scope };
  const links = await loadOptionLinks();
  let touched = false;
  const next = {};
  for (const [k, v] of Object.entries(links)) {
    if (linkMatches(v, criteria)) { touched = true; continue; }
    next[k] = v;
  }
  if (!touched) return links;
  await persistOptionLinks(next);
  return next;
}

// Drop every link belonging to one uploaded SIA — used when the
// Pricing tab clears or replaces the workbook, so no chip (and no
// Opps 2 "Pricing Option" value) survives against data that's no
// longer on screen. `legacyNames` additionally drops untagged legacy
// links by name, for a workbook that predates link tagging.
//
// One read + one write, so replacing a workbook with several linked
// options can't lose drops to interleaved read-modify-write races.
export async function dropLinksForWorkbook(workbookId, legacyNames = []) {
  const wbId = String(workbookId || '').trim();
  const names = new Set(
    (legacyNames || []).map(n => String(n || '').trim()).filter(Boolean)
  );
  if (!wbId && names.size === 0) return null;
  const links = await loadOptionLinks();
  let touched = false;
  const next = {};
  for (const [k, v] of Object.entries(links)) {
    const src = optionLinkSource(v);
    const isThisWorkbook = wbId && src === 'pricing' && optionLinkWorkbookId(v) === wbId;
    const isLegacyMatch = !src && names.has(optionLinkName(v));
    if (isThisWorkbook || isLegacyMatch) { touched = true; continue; }
    next[k] = v;
  }
  if (!touched) return links;
  await persistOptionLinks(next);
  return next;
}

export const OPTION_LINKS_EVENT = EVENT_NAME;
