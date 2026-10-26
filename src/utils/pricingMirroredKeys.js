// The Pricing page's hand-made mappings, given a Firestore copy so they
// follow the user to their other machine.
//
// They live in IndexedDB ('pricing-cache'), which is one browser's storage:
// a mapping made on the work laptop was simply absent at home, and a browser
// whose site data was cleared lost it outright. Each key stays exactly where
// it was; utils/localMirrorSync adds the cloud copy (newest wins, with the
// two sides merged the first time a browser that already had some meets the
// cloud copy). Hydration fires PRICING_MIRROR_EVENT when it changes one, and
// an open Pricing page re-reads them on it.
//
// What is here is what was typed or decided and outlives any one workbook:
// the Line Item -> Services mapping and its Ignore / First in scope / kept
// shared marks, the Linked To defaults (and their unit, start month and
// pass-through columns), the fee defaults, the Linked To dropdown's own
// vocabulary, the S2C tags, the saved fee structures, the services marked
// completed, the Fee Builder's saved deal scenarios, and the price check's
// picks (which cost lines are left out of a service's check, and the fee
// component each line is checked at). The workbook itself,
// column widths and other view state are not.
import { registerMirroredDbKey, mergeMirroredMaps, queueMirrorPush, dbMirrorId, pushMirrorNow } from './localMirrorSync.js';
import { dbPut } from './db.js';

export const PRICING_MIRROR_STORE = 'pricing-cache';
export const PRICING_MIRROR_EVENT = 'pricing:mirroredKeysChanged';

export const PRICING_MIRRORED_KEYS = [
  'lineItemServices',
  'lineItemPriority',
  'lineItemIgnored',
  'lineItemSharedOk',
  'linkedToDefaults',
  'linkedToUnitDefaults',
  'linkedToStartMonthDefaults',
  'linkedToPassThroughDefaults',
  'feeDefaults',
  'linkedToOptionsList',
  's2cLineItemTags',
  'serviceFeeStructures',
  'servicesCompleted',
  'feeBuilderSaved',
  'priceCheckExcluded',
  'priceCheckComponentPicks',
];

const MIRRORED = new Set(PRICING_MIRRORED_KEYS);

// The dropdown vocabulary is { custom: [], hidden: [] }: two lists, each
// unioned, rather than one map whose cloud list would replace the local one.
const mergeOptionsList = (local, remote) => ({
  ...mergeMirroredMaps(local, remote),
  custom: mergeMirroredMaps(local?.custom || [], remote?.custom || []),
  hidden: mergeMirroredMaps(local?.hidden || [], remote?.hidden || []),
});

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Fee structures are { [serviceKey]: { structures: [{ id, ... }], standardId } }.
// A service both sides have keeps every structure either side has, by id,
// the cloud's copy winning where both have the same one. The plain map
// merge took the cloud's service whole, and with it went every structure
// only this browser had built for that service.
export function mergeFeeStructures(local, remote) {
  if (!isObj(local) || !isObj(remote)) return mergeMirroredMaps(local, remote);
  const out = { ...local };
  for (const [k, r] of Object.entries(remote)) {
    const l = out[k];
    if (!isObj(l) || !Array.isArray(l.structures)) { out[k] = r; continue; }
    if (!isObj(r) || !Array.isArray(r.structures)) continue;
    const ids = new Set(r.structures.map(x => x?.id));
    out[k] = {
      ...l,
      ...r,
      structures: [...r.structures, ...l.structures.filter(x => !ids.has(x?.id))],
      standardId: r.standardId || l.standardId || null,
    };
  }
  return out;
}

// Fee Builder saved scenarios are { [entryKey]: { savedAt, ... } }: every
// scenario either side has, the later save winning where both have one.
export function mergeFeeBuilderSaved(local, remote) {
  if (!isObj(local) || !isObj(remote)) return mergeMirroredMaps(local, remote);
  const out = { ...local };
  for (const [k, r] of Object.entries(remote)) {
    const l = out[k];
    if (!isObj(l) || (isObj(r) && (Number(r.savedAt) || 0) >= (Number(l.savedAt) || 0))) out[k] = r;
  }
  return out;
}

const MERGES = {
  linkedToOptionsList: mergeOptionsList,
  serviceFeeStructures: mergeFeeStructures,
  feeBuilderSaved: mergeFeeBuilderSaved,
};

for (const key of PRICING_MIRRORED_KEYS) {
  registerMirroredDbKey(PRICING_MIRROR_STORE, key, PRICING_MIRROR_EVENT, {
    merge: MERGES[key] || mergeMirroredMaps,
  });
}

export function isPricingMirroredKey(key) {
  return MIRRORED.has(key);
}

// After a write to one of the keys, send it up (debounced).
export function queuePricingMirrorPush(key) {
  if (MIRRORED.has(key)) queueMirrorPush(dbMirrorId(PRICING_MIRROR_STORE, key));
}

// What Pricing > Linked To > Earlier versions offers, in the order a person
// looks for them: the Linked To mappings first.
export const PRICING_VERSION_CHOICES = [
  ['linkedToDefaults', 'Linked To mapping (Default Linked To)'],
  ['linkedToUnitDefaults', 'Linked To: Default Unit'],
  ['linkedToStartMonthDefaults', 'Linked To: Fee Start Month'],
  ['linkedToPassThroughDefaults', 'Linked To: Pass-through'],
  ['linkedToOptionsList', 'Linked To dropdown options'],
  ['feeDefaults', 'Fee defaults'],
  ['lineItemServices', 'Line Item to Services mapping'],
  ['lineItemIgnored', 'Line items marked Ignore'],
  ['lineItemPriority', 'Line items marked First in scope'],
  ['lineItemSharedOk', 'Line items kept shared'],
  ['s2cLineItemTags', 'S2C tags'],
  ['serviceFeeStructures', 'Saved fee structures'],
  ['servicesCompleted', 'Services marked completed'],
  ['feeBuilderSaved', 'Fee Builder saved scenarios'],
  ['priceCheckExcluded', 'Price check: lines left out'],
  ['priceCheckComponentPicks', 'Price check: fee components'],
].map(([dbKey, label]) => ({ key: dbMirrorId(PRICING_MIRROR_STORE, dbKey), dbKey, label }));

/**
 * Put an earlier version of one key back: into this browser, up to the
 * cloud (forced, as a restore is a deliberate overwrite; what it replaces
 * is kept as an earlier version, so the restore can be undone), and onto
 * an open Pricing page through its usual reload.
 */
export async function restorePricingMirroredKey(dbKey, value) {
  if (!MIRRORED.has(dbKey)) throw new Error(`Not a Pricing mapping: ${dbKey}`);
  await dbPut(PRICING_MIRROR_STORE, value, dbKey);
  await pushMirrorNow(dbMirrorId(PRICING_MIRROR_STORE, dbKey));
  try { window.dispatchEvent(new Event(PRICING_MIRROR_EVENT)); } catch { /* no window */ }
}
