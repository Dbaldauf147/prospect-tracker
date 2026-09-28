// Folding one service name into another, once per user/browser.
//
// A service that was seeded under two spellings ends up as two services:
// two rows on Dropdowns › Services, two entries in the Scope picker, and —
// worse — two places a client's status can be recorded, so a client marked
// Sold under one spelling reads as untouched under the other. Correcting the
// seed lists alone doesn't fix an account that has been running: the moment
// anyone moves a service between boxes or edits the Solutions list, the
// stored copy in settings takes over from the seed and keeps the old
// spelling alive.
//
// So the seed fix ships with a pass that rewrites the name everywhere it has
// been stored: the board layout, the Solutions list, per-service metadata,
// every settings map keyed by service name (renames, pricing, links,
// presentation links, question lists, Opps SMEs), the hidden set, the
// Contract Services ignore list, and every prospect's Services Explored /
// notes / SME maps. The pass is planned as pure data here — App.jsx runs it
// and writes the result — so what it touches can be tested without a
// Firestore.
//
// Where both names carry a value, the surviving name's own value wins and
// the retired one only fills a blank. A merge should never overwrite what
// the user set on the name they're keeping.

import { SOLUTIONS_CATALOG } from '../data/dropdownLists.js';
import { SERVICE_CATEGORIES } from '../data/enums.js';
import { getServiceMetadata } from '../data/serviceCatalog.js';
import { getTimelineTemplates } from './timelineTemplatesStore.js';
import { getTreeLibrary, hasSavedTrees, LIBRARY_KEY, renameServiceInLibrary } from './treeLibrary.js';
import { splitServiceNames, joinServiceNames } from './serviceNameList.js';

// Every merge to run, each guarded by its own flag. A new merge = a new
// entry with a fresh flag; the flag is what stops the pass re-running on
// every load once the account is clean.
export const SERVICE_MERGES = [
  {
    flag: 'service-merge-rebaseline-2026-08',
    from: 'Rebasline project',
    to: 'Rebaseline project',
  },
  // Three services the board and the Solutions list had each seeded under
  // their own wording — the board's shorter one and the catalogue's SUCON /
  // pull-through one — which read as two services once the two lists were
  // served as one vocabulary. The catalogue's spelling survives in each: it
  // is the one carrying seed metadata (BFO tag, product line, service type)
  // and the one BFO knows the service by.
  {
    flag: 'service-merge-climate-risk-opportunity-2026-08',
    from: 'Climate risk & opportunity assessment',
    to: 'Climate risk & opportunity assessment SUCON',
  },
  {
    flag: 'service-merge-climate-risk-scenario-2026-08',
    from: 'Climate risk Scenario Analysis',
    to: 'Climate risk scenario analysis SUCON',
  },
  {
    flag: 'service-merge-eaas-2026-08',
    from: 'EaaS',
    to: 'EaaS - pull through',
  },
  // A plain misspelling in the seed, the same shape as the Rebasline one
  // above: the service has always been Risk management, and the catalogue
  // had it a letter short. Nothing about the service changes, only how it
  // is written.
  {
    flag: 'service-merge-risk-management-2026-09',
    from: 'Risk managment',
    to: 'Risk management',
  },
  // Another seed misspelling, in the tier below it. The three risk services
  // mirror the three sourcing ones filed just above them on the same board
  // — Strategic / Professional / Insight sourcing against Risk management /
  // Risk - professional / Risk - commodity insight — which is what names the
  // middle one. "Progressional" is not a word the business uses.
  //
  // This one is board-only: it has never been in the Solutions catalogue or
  // carried seed metadata, and reaches the Solutions list through the board
  // union (mergeBoardServices) instead. The merge does not change that, it
  // only corrects the spelling wherever the name has been stored.
  {
    flag: 'service-merge-risk-professional-2026-09',
    from: 'Risk - progressional',
    to: 'Risk - professional',
  },
  // Budgets split in two: the site-level service and Budgets (account
  // level). Every deal that says plain Budgets was sold as the site-level
  // one, so the old name is carried over to it everywhere, open and closed
  // opps alike, and stops being a service of its own.
  {
    flag: 'service-merge-budgets-site-level-2026-09',
    from: 'Budgets',
    to: 'Budgets (site level)',
  },
];

// Renames made on Dropdowns › Services, logged in settings so every browser
// carries them into its own stores: [{ id, from, to, at, sharedDone }]. See
// the rename pass in App.jsx.
export const SERVICE_RENAME_LOG_KEY = 'serviceRenameLog';

// The per-browser flag saying one logged rename has been applied here.
export const serviceRenameFlag = (id) => `service-rename-applied-${id}`;

// A log entry for a rename just made. Appended to the log in the same
// settings write as the rename itself.
export function serviceRenameLogEntry(from, to, now = new Date()) {
  const at = now.toISOString();
  return { id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, from, to, at, sharedDone: false };
}

// The prospect fields keyed by service name. Each is a plain
// { [serviceName]: value } map on the record.
export const SERVICE_KEYED_PROSPECT_FIELDS = ['servicesExplored', 'serviceNotes', 'serviceSMEs'];

// The settings keyed by service name, same { [serviceName]: value } shape and
// all merged by the same rule. Everything the user fills in per service lives
// in one of these, so a name left out here is a fee basis, a link or a
// question list quietly orphaned the moment the service is renamed.
//
// serviceOverrides is NOT in the list: per-service metadata merges field by
// field rather than whole (see mergeOverrides), so it is planned separately.
export const SERVICE_KEYED_SETTINGS = [
  'serviceRenames',
  'servicePricing',
  'serviceLinks',
  'servicePresentationLinks',
  'serviceQuestions',
  'serviceTheirQuestions',
  'oppsServiceSMEs',
];

const norm = s => String(s ?? '').trim().toLowerCase();

// The per-service fields that hold OTHER services' names, as a
// comma-separated list (see serviceAutoAdd / serviceAutoNa / dependsOn).
const OVERRIDE_NAME_LIST_FIELDS = ['dependsOn', 'autoAdd', 'autoNa'];

// The seed metadata a service carries in the catalogue, copied onto the new
// name when a seed service is renamed to one the catalogue doesn't know, so
// its BFO tag, years and type don't vanish with the old spelling.
const SEED_FIELDS = ['bfoTag', 'region', 'years', 'productLine', 'serviceType', 'timelineDriven', 'rolloutTime'];

/**
 * A comma-separated service list (a Scope cell, a Depends On list) with
 * `from` renamed to `to`. Null when it doesn't name `from`. Where both are
 * already there the old one is dropped rather than listed twice.
 */
export function renameInNameString(value, from, to) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const names = splitServiceNames(value, [from, to]);
  const next = mergeNameList(names, from, to);
  return next ? joinServiceNames(next) : null;
}

// Exported for the stores the pass rewrites outside settings.
export { mergeNameList as renameInNameList, mergeNameMap as renameInNameMap };

// A { key: value } map keyed by the LOWERCASED service name (fee
// structures, price-check picks). Same rule: the surviving key's value wins.
export function renameInLowerKeyMap(map, from, to) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  const f = norm(from);
  const t = norm(to);
  if (!(f in map) || f === t) return null;
  const out = { ...map };
  const retired = out[f];
  delete out[f];
  if (out[t] === undefined || out[t] === null) out[t] = retired;
  return out;
}

// A list of LOWERCASED names (completed services, hidden timeline bands).
export function renameInLowerList(list, from, to) {
  if (!Array.isArray(list)) return null;
  const f = norm(from);
  const t = norm(to);
  if (!list.some(n => norm(n) === f)) return null;
  const out = [];
  for (const n of list) {
    const k = norm(n) === f ? t : n;
    if (!out.some(x => norm(x) === norm(k))) out.push(k);
  }
  return out;
}

// Rewrite `from` to `to` in a list of service names, dropping the duplicate
// if the list already carried both. Order is preserved: where both are
// present the surviving name keeps its own position, and where only the old
// one is present it is renamed in place — a service doesn't jump to the end
// of a list because its spelling was corrected.
function mergeNameList(list, from, to) {
  if (!Array.isArray(list)) return null;
  const hasFrom = list.some(n => norm(n) === norm(from));
  if (!hasFrom) return null;
  const hasTo = list.some(n => norm(n) === norm(to));
  const out = [];
  for (const n of list) {
    if (norm(n) === norm(from)) {
      if (hasTo) continue;
      out.push(to);
      continue;
    }
    out.push(n);
  }
  return out;
}

// Same for a { serviceName: value } map. The surviving name's value wins;
// the retired name's fills a blank.
function mergeNameMap(map, from, to) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  const fromKey = Object.keys(map).find(k => norm(k) === norm(from));
  if (fromKey === undefined) return null;
  const toKey = Object.keys(map).find(k => norm(k) === norm(to));
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    if (k === fromKey || k === toKey) continue;
    out[k] = v;
  }
  const kept = toKey !== undefined ? map[toKey] : undefined;
  const retired = map[fromKey];
  const survivor = kept === undefined || kept === '' || kept === null ? retired : kept;
  if (survivor !== undefined) out[to] = survivor;
  return out;
}

// Per-service metadata ({ bfoTag, region, … }) merges field by field rather
// than whole: the two spellings were filled in at different times, and the
// point of a merge is to end up with the union of what's known.
function mergeOverrides(overrides, from, to) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return null;
  const fromKey = Object.keys(overrides).find(k => norm(k) === norm(from));
  if (fromKey === undefined) return null;
  const toKey = Object.keys(overrides).find(k => norm(k) === norm(to));
  const out = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (k === fromKey || k === toKey) continue;
    out[k] = v;
  }
  const retired = overrides[fromKey] || {};
  const kept = (toKey !== undefined && overrides[toKey]) || {};
  const merged = { ...retired };
  for (const [k, v] of Object.entries(kept)) {
    if (v !== undefined && v !== '' && v !== null) merged[k] = v;
  }
  if (Object.keys(merged).length) out[to] = merged;
  return out;
}

// The board layout: [{ name, items: [serviceName] }]. Where both spellings
// are filed, the surviving name's box wins and the retired one is simply
// pulled out — the same rule the rest of the merge follows.
function mergeCategories(categories, from, to) {
  if (!Array.isArray(categories)) return null;
  const hasFrom = categories.some(c => (c?.items || []).some(i => norm(i) === norm(from)));
  if (!hasFrom) return null;
  const hasTo = categories.some(c => (c?.items || []).some(i => norm(i) === norm(to)));
  return categories.map(c => ({
    ...c,
    items: (c?.items || []).flatMap(i => {
      if (norm(i) !== norm(from)) return [i];
      return hasTo ? [] : [to];
    }),
  }));
}

/**
 * What one merge changes, as data to write.
 *
 * Returns `{ settingsPatch, prospectPatches, counts }`:
 *   settingsPatch    — the settings keys that changed, {} when none did
 *   prospectPatches  — [{ id, company, patch }] per record that changed
 *   counts           — a short read-out for the console log
 *
 * Nothing is written here, and an account that has never seen the old
 * spelling plans to an empty patch — which is what makes the pass safe to
 * run against a clean account.
 */
export function planServiceMerge({ from, to }, settings = {}, prospects = []) {
  const settingsPatch = {};

  // A board or Solutions list nobody has edited isn't stored: it is the
  // seed, which can carry the old name too (Budgets), so the seed is what
  // gets renamed and written back.
  const storedCats = settings?.customServiceCategories;
  const categories = mergeCategories(
    Array.isArray(storedCats) && storedCats.length ? storedCats : SERVICE_CATEGORIES, from, to,
  );
  if (categories) settingsPatch.customServiceCategories = categories;

  const storedSolutions = settings?.dropdownLists?.solutions;
  const solutions = mergeNameList(Array.isArray(storedSolutions) ? storedSolutions : SOLUTIONS_CATALOG, from, to);
  if (solutions) settingsPatch.dropdownLists = { ...(settings?.dropdownLists || {}), solutions };

  let overrides = mergeOverrides(settings?.serviceOverrides, from, to);
  // A seed service renamed to a name the catalogue doesn't carry takes its
  // seed metadata with it, under anything already set on the new name.
  const fromSeed = getServiceMetadata(from);
  if (fromSeed && !getServiceMetadata(to)) {
    const base = overrides || { ...(settings?.serviceOverrides || {}) };
    const toKey = Object.keys(base).find(k => norm(k) === norm(to));
    const current = toKey !== undefined ? base[toKey] : {};
    const seeded = {};
    for (const f of SEED_FIELDS) {
      if (fromSeed[f] !== undefined && fromSeed[f] !== '') seeded[f] = fromSeed[f];
    }
    const merged = { ...seeded };
    for (const [k, v] of Object.entries(current || {})) {
      if (v !== undefined && v !== '' && v !== null) merged[k] = v;
    }
    if (toKey !== undefined && toKey !== to) delete base[toKey];
    base[to] = merged;
    overrides = base;
  }
  // Other services' Depends On / Auto-add / N/A lists that name the old one.
  const src = overrides || settings?.serviceOverrides;
  if (src && typeof src === 'object') {
    let touched = null;
    for (const [svc, meta] of Object.entries(src)) {
      if (!meta || typeof meta !== 'object') continue;
      let nextMeta = null;
      for (const field of OVERRIDE_NAME_LIST_FIELDS) {
        const next = renameInNameString(meta[field], from, to);
        if (next !== null) { nextMeta = { ...(nextMeta || meta), [field]: next }; }
      }
      if (nextMeta) { touched = touched || { ...src }; touched[svc] = nextMeta; }
    }
    if (touched) overrides = touched;
  }
  if (overrides) settingsPatch.serviceOverrides = overrides;

  // Opps queued to open later carry a Scope of their own.
  if (Array.isArray(settings?.scheduledOpps)) {
    let changed = false;
    const next = settings.scheduledOpps.map(e => {
      const scope = renameInNameString(e?.scope, from, to);
      if (scope === null) return e;
      changed = true;
      return { ...e, scope };
    });
    if (changed) settingsPatch.scheduledOpps = next;
  }

  // Timelines attached to the service, working list and saved library.
  const renameTemplates = (list) => {
    let changed = false;
    const next = list.map(t => {
      const services = mergeNameList(t?.services, from, to);
      if (!services) return t;
      changed = true;
      return { ...t, services };
    });
    return changed ? next : null;
  };
  const templates = renameTemplates(getTimelineTemplates(settings));
  if (templates) settingsPatch.timelineTemplates = templates;
  if (Array.isArray(settings?.timelineLibrary)) {
    const library = renameTemplates(settings.timelineLibrary);
    if (library) settingsPatch.timelineLibrary = library;
  }

  // Efficiency Decision Tree steps tagged with the service.
  if (hasSavedTrees(settings)) {
    const retagged = renameServiceInLibrary(getTreeLibrary(settings), from, to);
    if (retagged) settingsPatch[LIBRARY_KEY] = retagged;
  }

  // The PE services report's picked services.
  const peSel = mergeNameList(settings?.peServicesReportSelection, from, to);
  if (peSel) settingsPatch.peServicesReportSelection = peSel;

  for (const key of SERVICE_KEYED_SETTINGS) {
    const next = mergeNameMap(settings?.[key], from, to);
    if (next) settingsPatch[key] = next;
  }

  // The hidden set is the one place the retired name's state is dropped
  // rather than carried: a service retired under one spelling but kept under
  // the other is one the user still wants, and hiding the survivor would
  // read as the service vanishing in the merge. Dropping the old name leaves
  // the survivor hidden only if it was already hidden in its own right.
  const hidden = Array.isArray(settings?.hiddenServices) ? settings.hiddenServices : null;
  if (hidden && hidden.some(n => norm(n) === norm(from))) {
    settingsPatch.hiddenServices = hidden.filter(n => norm(n) !== norm(from));
  }

  // Contract Services remembers an ignored row as `k:<catalogue service>`
  // (see ignoreKeyFor), so the retired spelling sits in there under its own
  // key and would go on ignoring that wording after the merge.
  const ignored = mergeNameList(settings?.contractServicesIgnored, `k:${from}`, `k:${to}`);
  if (ignored) settingsPatch.contractServicesIgnored = ignored;

  const prospectPatches = [];
  for (const p of prospects || []) {
    const patch = {};
    for (const field of SERVICE_KEYED_PROSPECT_FIELDS) {
      const next = mergeNameMap(p?.[field], from, to);
      if (next) patch[field] = next;
    }
    if (Object.keys(patch).length) prospectPatches.push({ id: p.id, company: p.company || '', patch });
  }

  return {
    settingsPatch,
    prospectPatches,
    counts: {
      settingsKeys: Object.keys(settingsPatch),
      prospects: prospectPatches.length,
    },
  };
}
