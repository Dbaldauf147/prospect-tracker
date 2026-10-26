// How close each company's site list is to the size it can be saved at.
//
// A site list is one Firestore document (utils/companySiteListsStore), and
// Firestore refuses a document over 1 MiB. A list that crosses that line
// stops saving: the next "Save to <company>" or upload fails, and the
// change lives only in the open tab until it is refreshed away. So the
// Issues tab warns while there is still room ("near the limit"), and says
// plainly once a list is past it.
//
// Sized the way Firestore sizes a document (utils/settingsDocSize), from
// the copy every device already has, so the warning shows everywhere and
// costs no reads. Pure, for scripts/siteListSize.test.mjs.

import { FIRESTORE_DOC_LIMIT, valueBytes } from './settingsDocSize.js';

// The document name and Firestore's own per-document overhead, generously:
// the path is userSettings/<uid>/companySiteLists/<slug>.
const DOC_NAME_ALLOWANCE = 200;

// Warn from here: about 80% of the cap, which on a typical list is a few
// thousand rows of headroom.
export const SITE_LIST_WARN_BYTES = Math.round(FIRESTORE_DOC_LIMIT * 0.8);
export const SITE_LIST_LIMIT_BYTES = FIRESTORE_DOC_LIMIT;

/** Firestore's size for one company's site-list document. */
export function siteListBytes(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  return valueBytes(entry) + DOC_NAME_ALLOWANCE;
}

const kb = (n) => `${Math.round(n / 1024).toLocaleString()} KB`;
const slugOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '-');

/**
 * The lists at or over the warning line, as [{ slug, company, fileName,
 * rows, bytes }], biggest first. Cheap to keep around: the Issues hook
 * computes this once per change to the lists, not once per render.
 */
export function oversizedSiteLists(lists) {
  const out = [];
  for (const [slug, entry] of Object.entries(lists || {})) {
    const bytes = siteListBytes(entry);
    if (bytes < SITE_LIST_WARN_BYTES) continue;
    out.push({
      slug,
      company: String(entry?.company || '').trim(),
      fileName: String(entry?.fileName || '').trim(),
      rows: Array.isArray(entry?.rows) ? entry.rows.length : 0,
      bytes,
    });
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

/** Issues-tab rows for oversizedSiteLists' result. */
export function siteListSizeIssues(oversized, { prospects = [] } = {}) {
  const prospectBySlug = new Map();
  for (const p of (prospects || [])) {
    const k = slugOf(p?.company);
    if (k && !prospectBySlug.has(k)) prospectBySlug.set(k, p);
  }
  return (oversized || []).map((l) => {
    const prospect = prospectBySlug.get(l.slug) || null;
    const over = l.bytes >= SITE_LIST_LIMIT_BYTES;
    const what = `The site list${l.fileName ? ` ("${l.fileName}")` : ''} is ${kb(l.bytes)}`
      + `${l.rows ? `, ${l.rows.toLocaleString()} rows` : ''}, against the ${kb(SITE_LIST_LIMIT_BYTES)} one site list can hold.`;
    return {
      // Keyed by state, so a snoozed "near" row comes back when the list
      // actually goes over.
      id: `site-list-size:${l.slug}:${over ? 'over' : 'near'}`,
      source: 'Site lists',
      type: over ? 'Site list too big to save' : 'Site list near size limit',
      company: prospect?.company || l.company || l.slug,
      prospectId: prospect?.id || null,
      daysUntil: null,
      expirationDate: null,
      detail: over
        ? `${what} Saves to it will fail, and a change made now is lost on refresh. Remove columns or rows you don't need, or split the list.`
        : `${what} Once it is full, saving it will fail. Remove columns or rows you don't need before adding more.`,
    };
  });
}
