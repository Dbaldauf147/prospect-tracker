// How the biggest userSettings maps are stored: as one JSON string each,
// under `<key>_json`, rather than as Firestore maps.
//
// Why: Firestore indexes every key of a map field and refuses a document
// past 40,000 index entries ("too many index entries for entity"). These
// maps are keyed by company or contact, so they grow an entry or two per
// company, and together they took the settings document over the line. A
// string is one field however long it is, so stored this way they cost two
// index entries apiece. This works whatever the project's index settings
// are; firestore.field-exemptions.json only helps once it has been released.
//
// Callers never see the string. Reads go through decodeSettingsDoc (the
// live subscription, the stale check, the server jobs) and every caller
// gets the maps back as plain objects; writes go through
// encodeSettingsUpdates, which turns a key's new value into its string.
//
// A tab still running the old code can write the plain map field, either a
// dotted path (`targetMap.abc`) or the whole key. Its entries are laid over
// the stored ones on read, and the next save from current code folds them
// into the string and drops the plain field, so nothing it wrote is lost.
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

const ENCODED = new Set(ENCODED_SETTINGS_KEYS);
const SUFFIX = '_json';

export const encodedFieldName = (key) => `${key}${SUFFIX}`;
export const isEncodedSettingsKey = (key) => ENCODED.has(key);

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function parse(raw, key) {
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`settings: ${encodedFieldName(key)} is not valid JSON`, err);
    return undefined;
  }
}

/**
 * A key's value out of the stored fields: the JSON string, with any plain
 * map entries an old tab wrote laid on top. undefined when neither is there.
 */
function decodeKey(stored, plain) {
  // null on the plain field is a save's "drop this field", never a value.
  if (plain === null) plain = undefined;
  if (stored === undefined) return plain;
  if (isPlainObject(stored) && isPlainObject(plain)) return { ...stored, ...plain };
  return plain !== undefined ? plain : stored;
}

/** The settings document as the app reads it: the big maps as objects again. */
export function decodeSettingsDoc(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  let out = null;
  for (const key of ENCODED_SETTINGS_KEYS) {
    const field = encodedFieldName(key);
    if (!(field in raw)) continue;
    out = out || { ...raw };
    const value = decodeKey(parse(raw[field], key), raw[key]);
    delete out[field];
    if (value === undefined) delete out[key]; else out[key] = value;
  }
  return out || raw;
}

/**
 * Whole-key updates as they are written: each big map that is set becomes
 * its JSON string, and its plain map field is dropped (null is how a save
 * spells "delete this field"). A null value deletes both. An update that
 * already carries `<key>_json` (a raw backup being restored) is decoded
 * first, so it lands the same way.
 */
export function encodeSettingsUpdates(updates) {
  if (!updates || typeof updates !== 'object') return updates;
  const decoded = decodeSettingsDoc(updates);
  let out = null;
  for (const key of ENCODED_SETTINGS_KEYS) {
    if (!(key in decoded)) continue;
    out = out || { ...decoded };
    const value = decoded[key];
    if (value === undefined) { delete out[key]; continue; }
    out[encodedFieldName(key)] = value === null ? null : JSON.stringify(value);
    out[key] = null;
  }
  return out || decoded;
}

/** The top-level key a dotted path writes under. */
export const pathRoot = (path) => String(path).split('.')[0];

/**
 * Dotted-path updates as they are written. A path into a big map can't be
 * written into a string, so every path under such a key is replaced by the
 * key's whole new value, taken from `wholeValues` (the settings with the
 * paths already applied). Other paths go through untouched.
 */
export function encodePathUpdates(pathUpdates, wholeValues) {
  const out = {};
  // root -> the value a path that IS the key sets it to, or undefined for a
  // root only reached by deeper paths.
  const roots = new Map();
  for (const [path, value] of Object.entries(pathUpdates || {})) {
    const root = pathRoot(path);
    if (!isEncodedSettingsKey(root)) { out[path] = value; continue; }
    if (path === root) roots.set(root, { direct: value });
    else if (!roots.has(root)) roots.set(root, null);
  }
  const haveWhole = !!wholeValues && typeof wholeValues === 'object';
  for (const [root, direct] of roots) {
    // The settings with every path applied are the truth when given. Without
    // them only a path that sets the key outright can be written: a deeper
    // one is refused rather than written as "nothing", which would delete
    // the whole map.
    let whole;
    if (haveWhole && root in wholeValues) whole = wholeValues[root];
    else if (direct) whole = direct.direct;
    else throw new Error(`settings: a save into ${root} needs the whole ${root} to write, and none was given`);
    out[encodedFieldName(root)] = whole == null ? null : JSON.stringify(whole);
    out[root] = null;
  }
  return out;
}

/** The big maps a stored document still holds the old way, as map fields. */
export function plainEncodedKeys(raw) {
  if (!raw || typeof raw !== 'object') return [];
  return ENCODED_SETTINGS_KEYS.filter(k => isPlainObject(raw[k]));
}
