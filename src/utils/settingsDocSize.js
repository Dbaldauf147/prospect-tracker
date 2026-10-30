// How big the userSettings document is, and which key made it that way.
//
// Firestore caps a document at 1 MiB and the error it raises when you
// cross the line names only the byte count:
//
//   Document 'userSettings/…' cannot be written because its size
//   (1,060,683 bytes) exceeds the maximum allowed size of 1,048,576 bytes.
//
// That is true and useless — the settings document holds a hundred keys
// and the message says nothing about which of them to prune. This sizes
// the document the way Firestore does so a save that would not fit can be
// stopped before the round trip, with the offending keys named.

// https://firebase.google.com/docs/firestore/storage-size
const DOC_OVERHEAD = 32;
export const FIRESTORE_DOC_LIMIT = 1048576;

import { isEncodedSettingsKey, encodedFieldName } from './settingsCodec.js';

// Stop a little short of the hard cap. The sizing below is faithful but
// not byte-exact (it does not model timestamps, geo points or references,
// none of which settings uses), and a save that squeaks in at 1,048,570
// bytes leaves the document with no room for the next one.
export const SETTINGS_SIZE_BUDGET = 1000000;

// Keys that no longer live on the settings document itself, so they must
// not be counted against its budget.
const OFFLOADED_KEYS = new Set(['companySiteLists']);

const utf8 = (s) => {
  // Cheap for the ASCII that settings keys and slugs actually are.
  let bytes = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { bytes += 4; i += 1; }
    else bytes += 3;
  }
  return bytes;
};

/** Firestore's size for one value, excluding the field name. */
export function valueBytes(value) {
  if (value === null || value === undefined) return 1;
  switch (typeof value) {
    case 'boolean': return 1;
    case 'number': return 8;
    case 'string': return utf8(value) + 1;
    case 'object': {
      if (Array.isArray(value)) {
        let total = 0;
        for (const v of value) total += valueBytes(v);
        return total;
      }
      let total = 0;
      for (const [k, v] of Object.entries(value)) {
        if (v === undefined) continue;
        total += utf8(k) + 1 + valueBytes(v);
      }
      return total;
    }
    default: return 1;
  }
}

/**
 * Per-key sizes for a settings object, largest first, plus the total the
 * document would occupy. Keys stored outside the document are excluded
 * and reported separately so a report can say so rather than look wrong.
 */
export function settingsDocReport(settings) {
  const keys = [];
  let bytes = DOC_OVERHEAD;
  let offloadedBytes = 0;
  for (const [key, value] of Object.entries(settings || {})) {
    if (value === undefined) continue;
    // The big maps are stored as one JSON string each (utils/settingsCodec),
    // which is what the document actually holds for them.
    const size = isEncodedSettingsKey(key)
      ? utf8(encodedFieldName(key)) + 1 + valueBytes(JSON.stringify(value))
      : utf8(key) + 1 + valueBytes(value);
    if (OFFLOADED_KEYS.has(key)) { offloadedBytes += size; continue; }
    keys.push({ key, bytes: size });
    bytes += size;
  }
  keys.sort((a, b) => b.bytes - a.bytes);
  return { bytes, keys, offloadedBytes, limit: FIRESTORE_DOC_LIMIT, budget: SETTINGS_SIZE_BUDGET };
}

const kb = (n) => `${Math.round(n / 1024).toLocaleString()} KB`;

/**
 * The message shown when a save would not fit. Names the handful of keys
 * that account for the bulk of the document, because that is the only
 * part of this a person can act on.
 */
export function overBudgetMessage(report) {
  const top = report.keys.slice(0, 5)
    .filter(k => k.bytes > 1024)
    .map(k => `  • ${k.key} - ${kb(k.bytes)}`)
    .join('\n');
  return `This save can't be stored: your settings would come to ${kb(report.bytes)}, `
    + `over the ${kb(report.limit)} Firestore allows for one document.\n\n`
    + `Nothing was changed on the server, and a local backup of your current settings was taken.\n\n`
    + (top ? `The largest things in there are:\n${top}\n\n` : '')
    + `Clearing data you no longer need from one of those will make room.`;
}

// Console escape hatch, next to window.__settingsBackups: what is in
// there, and how big.
if (typeof window !== 'undefined') {
  window.__settingsSize = (settings) => {
    const data = settings || window.__lastSettings;
    if (!data) {
      console.warn('Pass a settings object, e.g. window.__settingsSize(window.__lastSettings)');
      return null;
    }
    const report = settingsDocReport(data);
    console.log(`settings document: ${kb(report.bytes)} of ${kb(report.limit)}`
      + (report.offloadedBytes ? ` (plus ${kb(report.offloadedBytes)} of site lists stored separately)` : ''));
    const entries = new Map(settingsIndexReport(data).keys.map(k => [k.key, k.entries]));
    console.table(report.keys.slice(0, 25).map(k => ({ key: k.key, KB: Math.round(k.bytes / 1024), 'index entries': entries.get(k.key) })));
    return report;
  };
}

// Firestore's other per-document cap: 40,000 index entries. Every field is
// indexed (ascending and descending), every key of a map included, and an
// array also gets an array-contains entry per distinct element. A settings
// map keyed by company grows an entry or two per company, and crossing the
// line is refused as "too many index entries for entity", naming no field.
// firestore.field-exemptions.json turns indexing off for the big maps; this
// estimates what each key costs so a refusal can say which keys are to blame
// and whether they are on that list.
export const FIRESTORE_INDEX_ENTRY_LIMIT = 40000;

/** Roughly how many index entries one value costs, the field itself included. */
export function valueIndexEntries(value) {
  if (value === null || value === undefined || typeof value !== 'object') return 2;
  if (Array.isArray(value)) {
    const distinct = new Set(value.map(v => (v && typeof v === 'object' ? JSON.stringify(v) : String(v))));
    return 2 + distinct.size;
  }
  let total = 2;
  for (const v of Object.values(value)) if (v !== undefined) total += valueIndexEntries(v);
  return total;
}

/**
 * Per-key index entry estimates, largest first. `exempt` is the set of
 * top-level keys Firestore is told not to index; they cost nothing once
 * that is live, so `total` leaves them out and `totalIfNoExemptions`
 * counts them, which is the document's cost while the exemption isn't live.
 */
export function settingsIndexReport(settings, exempt = new Set()) {
  const keys = [];
  let total = 0;
  let totalIfNoExemptions = 0;
  for (const [key, value] of Object.entries(settings || {})) {
    if (value === undefined || OFFLOADED_KEYS.has(key)) continue;
    // A map stored as a JSON string is one field: two entries, however big.
    const asText = isEncodedSettingsKey(key);
    const entries = asText ? 2 : valueIndexEntries(value);
    const isExempt = exempt.has(key);
    keys.push({ key, entries, exempt: isExempt, asText });
    totalIfNoExemptions += entries;
    if (!isExempt) total += entries;
  }
  keys.sort((a, b) => b.entries - a.entries);
  return { keys, total, totalIfNoExemptions, limit: FIRESTORE_INDEX_ENTRY_LIMIT };
}

export function isIndexEntryLimitError(err) {
  return /too many index entries/i.test(String(err?.message || err || ''));
}

/** The message for a save Firestore refused over index entries. */
export function indexLimitMessage(report) {
  const n = (x) => Math.round(x).toLocaleString();
  const top = report.keys.slice(0, 6)
    .map(k => `  • ${k.key} - about ${n(k.entries)}${k.asText ? ' (stored as text)' : k.exempt ? ' (on the exemption list)' : ' (NOT on the exemption list)'}`)
    .join('\n');
  const verdict = report.total > report.limit
    ? 'Even with the exemptions in place this is over the limit, so a key marked NOT on the list needs adding to firestore.field-exemptions.json.'
    : 'With the exemptions in place this fits, so the exemptions are not live on Firestore yet. They are released by the production build (look for "firestore index exemptions" in the Vercel build log); if that line says NOT RELEASED, the service account needs the Cloud Datastore Index Admin role. They can also take a few minutes to finish after a deploy.';
  return `Firestore refused this save: your settings need more search-index entries than the ${n(report.limit)} it allows for one document `
    + `(about ${n(report.totalIfNoExemptions)} counting every key, ${n(report.total)} without the exempted ones).\n\n`
    + `Nothing was changed on the server, and a local backup of your current settings was taken.\n\n`
    + `The keys that cost the most:\n${top}\n\n${verdict}`;
}
