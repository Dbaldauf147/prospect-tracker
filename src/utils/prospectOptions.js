import { TYPES } from '../data/enums';

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
