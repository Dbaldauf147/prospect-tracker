// Where the biggest userSettings maps live: each in its own document,
// `userSettings/{uid}/settingsKeys/{key}`, as one JSON string ({ json, at }).
//
// Why: they are keyed by company or contact, so they grow with the book, and
// on the one settings document they ran into both of Firestore's per-document
// caps in turn. First the 40,000 index entries (every key of a map is
// indexed: "too many index entries for entity"), and once they were stored
// as strings, the 1 MiB size (companyOpportunities alone is ~240 KB). Each
// in a document of its own, a map has the whole 1 MiB to itself and the
// settings document goes back to holding small things, the way the per-company
// site lists (companySiteListsStore) and contract language already do.
//
// Callers never see any of this: settings arrive as one object with these
// maps on it, and a save of `targetMap` (or of a `targetMap.<id>` path) is
// routed to its document by the sync layer (userSettingsSync).
//
// What a settings document can still hold for one of these keys, all read:
//   - `<key>_json`, a string: where they were kept briefly before moving out;
//   - `<key>`, a map: where they were kept before that, and what a tab still
//     running old code writes, whole or as a dotted path.
// Its own document wins over `<key>_json`; plain map entries are laid on top,
// so an old tab's write isn't lost. The next save of the key (or the one-time
// move on load) puts the result in its document and drops both fields.
//
// Pure, so scripts/settingsCodec.test.mjs and the api jobs can use it.

export const ENCODED_SETTINGS_KEYS = [
  'targetMap',
  'tablePrefs',
  'serviceOverrides',
  'companyContactLinks',
  'companyOpportunities',
  'companyComplianceLinks',
  'divisionsMap',
  'hqRegionMap',
  'ccMap',
  'toAlsoMap',
  'ignoredTargetSuggestions',
  'marketingLeadLinks',
  'contactTagReview',
  'listMappings',
  'companyResearch',
  'contactLocalFields',
];

/** The subcollection of the settings document the maps live in. */
export const SETTINGS_KEYS_COLLECTION = 'settingsKeys';

const ENCODED = new Set(ENCODED_SETTINGS_KEYS);
const SUFFIX = '_json';

/** The settings-document field a key was briefly kept in as a string. */
export const encodedFieldName = (key) => `${key}${SUFFIX}`;
export const isEncodedSettingsKey = (key) => ENCODED.has(key);

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function parse(raw, what) {
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`settings: ${what} is not valid JSON`, err);
    return undefined;
  }
}

/** A key document's value, undefined when there is none (or it won't parse). */
export function keyDocValue(data, key = 'settings key') {
  return data ? parse(data.json, key) : undefined;
}

/** What a key document holds for a value. */
export const keyDocData = (value, at = Date.now()) => ({ json: JSON.stringify(value), at });

// Plain map entries (an old tab's) laid over a base value. null on the plain
// field is a save's "drop this field", never a value.
function overlay(base, plain) {
  if (plain === null) plain = undefined;
  if (base === undefined) return plain;
  if (isPlainObject(base) && isPlainObject(plain)) return { ...base, ...plain };
  return plain !== undefined ? plain : base;
}

/**
 * The settings as the app reads them: the settings document `raw`, with
 * each big map taken from its own document (`keyValues`: key -> value,
 * undefined for a key with no document or not read), else from where the
 * settings document still holds it.
 */
export function composeSettings(raw, keyValues = {}) {
  if (!raw || typeof raw !== 'object') {
    if (!keyValues || !Object.values(keyValues).some(v => v !== undefined)) return raw;
    raw = {};
  }
  const out = { ...raw };
  for (const key of ENCODED_SETTINGS_KEYS) {
    const field = encodedFieldName(key);
    const own = keyValues?.[key];
    const base = own !== undefined ? own : parse(raw[field], field);
    const value = overlay(base, raw[key]);
    delete out[field];
    if (value === undefined) delete out[key]; else out[key] = value;
  }
  return out;
}

/** The big maps a settings document still holds itself, due to move out. */
export function legacyKeysIn(raw) {
  if (!raw || typeof raw !== 'object') return [];
  return ENCODED_SETTINGS_KEYS.filter(k => isPlainObject(raw[k]) || typeof raw[encodedFieldName(k)] === 'string');
}

// Every field the settings document might hold a moved key in, dropped.
const dropLegacy = (main, key) => { main[key] = null; main[encodedFieldName(key)] = null; };

/**
 * Whole-key updates split by where they go: `keys` (key -> new value, null
 * to delete) for the maps' own documents, `main` for the settings document,
 * which also drops whatever it still held for those keys. An update that
 * carries `<key>_json` (a raw backup being restored) lands the same way.
 */
export function splitSettingsUpdates(updates) {
  const keys = {};
  if (!updates || typeof updates !== 'object') return { keys, main: updates };
  const touched = ENCODED_SETTINGS_KEYS.filter(k => k in updates || encodedFieldName(k) in updates);
  if (!touched.length) return { keys, main: updates };
  const decoded = composeSettings(updates);
  const main = { ...decoded };
  for (const key of touched) {
    const value = decoded[key];
    keys[key] = value === undefined ? null : value;
    dropLegacy(main, key);
  }
  return { keys, main };
}

/** The top-level key a dotted path writes under. */
export const pathRoot = (path) => String(path).split('.')[0];

/**
 * Dotted-path updates split the same way. A path into a big map is written
 * as the map's whole new value, read from `wholeValues` (the settings with
 * the paths applied); a path that IS the key sets it outright. A deeper path
 * with nothing to read the whole map from is refused rather than written as
 * "nothing", which would delete the map.
 */
export function splitPathUpdates(pathUpdates, wholeValues) {
  const keys = {};
  const main = {};
  const roots = new Map();
  for (const [path, value] of Object.entries(pathUpdates || {})) {
    const root = pathRoot(path);
    if (!isEncodedSettingsKey(root)) { main[path] = value; continue; }
    if (path === root) roots.set(root, { direct: value });
    else if (!roots.has(root)) roots.set(root, null);
  }
  const haveWhole = !!wholeValues && typeof wholeValues === 'object';
  for (const [root, direct] of roots) {
    let whole;
    if (haveWhole && root in wholeValues) whole = wholeValues[root];
    else if (direct) whole = direct.direct;
    else throw new Error(`settings: a save into ${root} needs the whole ${root} to write, and none was given`);
    keys[root] = whole == null ? null : whole;
    dropLegacy(main, root);
  }
  return { keys, main };
}
