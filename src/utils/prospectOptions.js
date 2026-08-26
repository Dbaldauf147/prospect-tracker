import { TYPES } from '../data/enums.js';
import { getEffectiveDropdownLists } from './dropdownListsStore.js';

// The Dropdowns-tab list that owns PE investment-strategy tags. Editing
// it there is the single source of truth for what the PE firm Strategies
// dropdowns offer.
export const PE_STRATEGY_LIST_KEY = 'peStrategies';

// The Dropdowns-tab list that owns Asset Types. Editing it there drives
// the Asset Types multi-select in Table View, the company pop-up and the
// PE Overview tab.
export const ASSET_TYPES_LIST_KEY = 'assetTypes';

// The Dropdowns-tab list that owns company Types — the Classification >
// Type dropdown on the company card, and every other Type picker. Editing
// it there is the single source of truth for what they offer.
export const TYPE_LIST_KEY = 'type';

// The Dropdowns-tab list that owns CDM names. There's no built-in CDM
// list, so this resolves a user-created list either by the conventional
// key 'cdm' or by a label of "CDM" (case-insensitive) — whichever the
// user set up on the Dropdowns page. Returns null when none exists.
export const CDM_LIST_KEY = 'cdm';
export function getCdmList(settings) {
  const lists = getEffectiveDropdownLists(settings);
  return lists.find(l => l.key === CDM_LIST_KEY)
    || lists.find(l => String(l.label || '').trim().toLowerCase() === 'cdm')
    || null;
}
export function getCdmListOptions(settings) {
  const list = getCdmList(settings);
  return Array.isArray(list?.options) ? list.options : [];
}

// Shared dropdown vocabularies for prospect tables' inline editors.
// Table View and the PE › Blue Owl tab both build their Type / CDM
// dropdowns through these so every table offers exactly the same
// options.

// Case-insensitive de-dupe keeping the first spelling seen, then
// sorted so a dropdown reads naturally.
function dedupeSorted(values) {
  const seen = new Set();
  const out = [];
  for (const t of values) {
    const v = String(t || '').trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

// The effective Type list off the Dropdowns tab (built-in vocabulary plus
// the user's edits there) — the canonical option order.
export function getTypeListOptions(settings) {
  const list = getEffectiveDropdownLists(settings).find(l => l.key === TYPE_LIST_KEY);
  return Array.isArray(list?.options) ? list.options : [];
}

// Type options for every Type dropdown: the Dropdowns-tab list first (its
// order wins), then any value already saved on a company, then the legacy
// customTypes setting — so editing the list controls what's offered, while a
// type removed from it never disappears off a company that still carries it.
//
// Falls back to the built-in TYPES only when the list has been hidden or
// emptied on the Dropdowns tab, which is the same rule My Accounts has always
// used: an empty picker would leave no way to set a Type at all.
export function buildTypeOptions(prospects, settings) {
  const managed = getTypeListOptions(settings);
  return dedupeOrdered([
    ...(managed.length ? managed : TYPES),
    ...(prospects || []).map(p => p?.type),
    ...(settings?.customTypes || []),
  ]);
}

// CDM options union: the Dropdowns-tab "CDM" list first (its order
// wins), then every CDM currently set on a prospect, then custom CDMs
// the user added via "+ Add new CDM…". Tying it to the managed list
// makes the Dropdowns page the single source of truth, while keeping
// in-use names so a CDM removed from the list never vanishes off a
// record that still carries it.
export function buildCdmOptions(prospects, settings) {
  const inUse = dedupeSorted([
    ...(prospects || []).map(p => p?.cdm),
    ...(settings?.customCdms || []),
  ]);
  return dedupeOrdered([
    ...getCdmListOptions(settings),
    ...inUse,
  ]);
}

// Same de-dupe as dedupeSorted but preserves the source order instead
// of sorting — used for the strategy list so the PE firm dropdowns
// honor the order the user arranged on the Dropdowns tab.
function dedupeOrdered(values) {
  const seen = new Set();
  const out = [];
  for (const t of values) {
    const v = String(t || '').trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

// The effective PE Strategies list off the Dropdowns tab (built-in
// vocabulary plus the user's edits there). This is what the user
// manages, so it's the canonical option order.
export function getStrategyListOptions(settings) {
  const list = getEffectiveDropdownLists(settings).find(l => l.key === PE_STRATEGY_LIST_KEY);
  return Array.isArray(list?.options) ? list.options : [];
}

// Strategy options for the PE firm dropdowns: the Dropdowns-tab list
// first (its order wins), then any tag already saved on a prospect that
// isn't on the list — so editing the list controls what's offered, while
// an option removed from the list never disappears from a firm that
// still carries it (you can always untag it).
export function buildStrategyOptions(prospects, settings) {
  // Offer ONLY the canonical Dropdowns-tab PE Strategies list. Legacy tags
  // still saved on individual firms are intentionally not merged in as
  // choices: a firm keeps any value it already carries and can untag it
  // (TagMultiSelect renders selected chips regardless of the options list),
  // but a retired strategy is no longer offered when tagging. `prospects`
  // stays in the signature so call sites and their memo deps are unchanged.
  void prospects;
  return dedupeOrdered(getStrategyListOptions(settings));
}

// Add a new strategy tag (from a dropdown's "+ Add") onto the Dropdowns-
// tab PE Strategies list so it sticks and shows up everywhere — same
// store the Dropdowns editor writes to. No-op if already present.
export function persistCustomStrategy(name, settings, updateSettings) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return;
  const current = getStrategyListOptions(settings);
  if (current.some(o => o.toLowerCase() === trimmed.toLowerCase())) return;
  const lists = settings?.dropdownLists || {};
  if (updateSettings) {
    updateSettings({ dropdownLists: { ...lists, [PE_STRATEGY_LIST_KEY]: [...current, trimmed] } });
  }
}

// The effective Asset Types list off the Dropdowns tab (built-in
// vocabulary plus the user's edits there) — the canonical option order.
export function getAssetTypeListOptions(settings) {
  const list = getEffectiveDropdownLists(settings).find(l => l.key === ASSET_TYPES_LIST_KEY);
  return Array.isArray(list?.options) ? list.options : [];
}

// Asset Types options for the multi-selects: the Dropdowns-tab list first
// (its order wins), then any value already saved on a prospect that isn't
// on the list — so editing the list controls what's offered, while a type
// removed from the list never disappears from a company that still carries
// it (you can always untag it).
export function buildAssetTypeOptions(prospects, settings) {
  const fromProspects = [];
  for (const p of (prospects || [])) {
    if (Array.isArray(p?.assetTypes)) fromProspects.push(...p.assetTypes);
  }
  return dedupeOrdered([
    ...getAssetTypeListOptions(settings),
    ...fromProspects,
  ]);
}

// Persist a newly-added Type / CDM to its custom-list setting so it
// sticks across reloads. Called by InlineCell consumers when the user
// picks "+ Add new …" on the dropdown. `cdmOptions` is the live CDM
// vocabulary, used to skip names some prospect already uses.
export function persistCustomOption(colKey, name, settings, updateSettings, cdmOptions) {
  // Trimmed first, and a name that's nothing but whitespace is dropped —
  // otherwise it lands on the list as a blank option nobody can pick or
  // tell apart from the next one.
  const trimmed = String(name || '').trim();
  if (!trimmed) return;
  if (colKey === 'type') {
    // The Dropdowns-tab Type list is where Types are managed, so that's
    // where a new one goes — same store the Dropdowns editor writes to, so
    // it's editable there afterwards rather than stranded in customTypes.
    const current = getTypeListOptions(settings);
    if (current.length) {
      if (current.some(o => String(o).trim().toLowerCase() === trimmed.toLowerCase())) return;
      const lists = settings?.dropdownLists || {};
      if (updateSettings) updateSettings({ dropdownLists: { ...lists, [TYPE_LIST_KEY]: [...current, trimmed] } });
      return;
    }
    // No managed list (hidden or emptied): the legacy customTypes setting
    // still carries it, so a Type added here isn't lost.
    const list = Array.isArray(settings?.customTypes) ? settings.customTypes : [];
    const exists = list.some(t => String(t).trim().toLowerCase() === trimmed.toLowerCase());
    const builtIn = TYPES.some(t => t.toLowerCase() === trimmed.toLowerCase());
    if (exists || builtIn) return;
    if (updateSettings) updateSettings({ customTypes: [...list, trimmed] });
    return;
  }
  if (colKey === 'cdm') {
    // When a "CDM" Dropdowns list exists, that list is the single source
    // of truth — add the new name there (same store the Dropdowns editor
    // writes to). Otherwise fall back to the legacy customCdms setting.
    const cdmList = getCdmList(settings);
    if (cdmList) {
      const current = Array.isArray(cdmList.options) ? cdmList.options : [];
      if (current.some(o => String(o).trim().toLowerCase() === trimmed.toLowerCase())) return;
      const lists = settings?.dropdownLists || {};
      if (updateSettings) updateSettings({ dropdownLists: { ...lists, [cdmList.key]: [...current, trimmed] } });
      return;
    }
    const list = Array.isArray(settings?.customCdms) ? settings.customCdms : [];
    const exists = list.some(t => String(t).trim().toLowerCase() === trimmed.toLowerCase());
    const inUse = (cdmOptions || []).some(t => t.toLowerCase() === trimmed.toLowerCase());
    if (exists || inUse) return;
    if (updateSettings) updateSettings({ customCdms: [...list, trimmed] });
  }
}
