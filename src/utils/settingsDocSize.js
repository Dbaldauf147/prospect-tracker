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
    const size = utf8(key) + 1 + valueBytes(value);
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
    .map(k => `  • ${k.key} — ${kb(k.bytes)}`)
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
    console.table(report.keys.slice(0, 25).map(k => ({ key: k.key, KB: Math.round(k.bytes / 1024) })));
    return report;
  };
}
