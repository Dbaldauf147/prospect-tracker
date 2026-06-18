import { TYPES } from '../data/enums';
import { getEffectiveDropdownLists } from './dropdownListsStore';

// The Dropdowns-tab list that owns PE investment-strategy tags. Editing
// it there is the single source of truth for what the PE firm Strategies
// dropdowns offer.
export const PE_STRATEGY_LIST_KEY = 'peStrategies';

// The Dropdowns-tab list that owns Asset Types. Editing it there drives
// the Asset Types multi-select in Table View, the company pop-up and the
// PE Overview tab.
export const ASSET_TYPES_LIST_KEY = 'assetTypes';

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

// Type options union: built-in TYPES + values currently in use across
// every prospect + custom types the user has added via the dropdown.
export function buildTypeOptions(prospects, settings) {
  return dedupeSorted([
    ...TYPES,
    ...(prospects || []).map(p => p?.type),
    ...(settings?.customTypes || []),
  ]);
}

// CDM options union: every CDM currently set on a prospect + custom
// CDMs the user has added via "+ Add new CDM…". CDMs are pure
// user-defined names (no built-in list), so the dropdown is fully
// driven by data + settings.customCdms.
export function buildCdmOptions(prospects, settings) {
  return dedupeSorted([
    ...(prospects || []).map(p => p?.cdm),
    ...(settings?.customCdms || []),
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
  const fromProspects = [];
  for (const p of (prospects || [])) {
    if (Array.isArray(p?.strategies)) fromProspects.push(...p.strategies);
  }
  return dedupeOrdered([
    ...getStrategyListOptions(settings),
    ...fromProspects,
  ]);
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
  if (!name) return;
  const trimmed = name.trim();
  if (colKey === 'type') {
    const list = Array.isArray(settings?.customTypes) ? settings.customTypes : [];
    const exists = list.some(t => String(t).trim().toLowerCase() === trimmed.toLowerCase());
    const builtIn = TYPES.some(t => t.toLowerCase() === trimmed.toLowerCase());
    if (exists || builtIn) return;
    if (updateSettings) updateSettings({ customTypes: [...list, trimmed] });
    return;
  }
  if (colKey === 'cdm') {
    const list = Array.isArray(settings?.customCdms) ? settings.customCdms : [];
    const exists = list.some(t => String(t).trim().toLowerCase() === trimmed.toLowerCase());
    const inUse = (cdmOptions || []).some(t => t.toLowerCase() === trimmed.toLowerCase());
    if (exists || inUse) return;
    if (updateSettings) updateSettings({ customCdms: [...list, trimmed] });
  }
}
