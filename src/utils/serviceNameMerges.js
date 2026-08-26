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
// been stored: the board layout, the Solutions list, per-service metadata and
// renames, the hidden set, the Contract Services ignore list, and every
// prospect's Services Explored / notes / SME maps. The pass is planned as
// pure data here — App.jsx runs it and writes the result — so what it
// touches can be tested without a Firestore.
//
// Where both names carry a value, the surviving name's own value wins and
// the retired one only fills a blank. A merge should never overwrite what
// the user set on the name they're keeping.

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
];

// The prospect fields keyed by service name. Each is a plain
// { [serviceName]: value } map on the record.
export const SERVICE_KEYED_PROSPECT_FIELDS = ['servicesExplored', 'serviceNotes', 'serviceSMEs'];

const norm = s => String(s ?? '').trim().toLowerCase();

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

  const categories = mergeCategories(settings?.customServiceCategories, from, to);
  if (categories) settingsPatch.customServiceCategories = categories;

  const solutions = mergeNameList(settings?.dropdownLists?.solutions, from, to);
  if (solutions) settingsPatch.dropdownLists = { ...(settings?.dropdownLists || {}), solutions };

  const overrides = mergeOverrides(settings?.serviceOverrides, from, to);
  if (overrides) settingsPatch.serviceOverrides = overrides;

  const renames = mergeNameMap(settings?.serviceRenames, from, to);
  if (renames) settingsPatch.serviceRenames = renames;

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
