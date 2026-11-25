// How close each company's site list is to the most this app will store
// for one company.
//
// A site list used to be one Firestore document, so the 1 MiB document cap
// was its limit and a big portfolio could not be saved at all. A list too
// big for one document is now stored in parts (utils/siteListParts), so
// Firestore no longer sets the limit. What does is that every list is
// loaded with the settings on every page load, so this is a backstop
// against a list so large it would slow every page down, well above any
// real portfolio (11,000 sites with the analysis columns is about 20 MB).
// The Issues tab warns while there is still room ("near the limit"), and
// says plainly once a list is past it.
//
// Sized the way Firestore sizes a document (utils/settingsDocSize), from
// the copy every device already has, so the warning shows everywhere and
// costs no reads. Pure, for scripts/siteListSize.test.mjs.

import { valueBytes } from './settingsDocSize.js';

// The document name and Firestore's own per-document overhead, generously:
// the path is userSettings/<uid>/companySiteLists/<slug>.
const DOC_NAME_ALLOWANCE = 200;

export const SITE_LIST_LIMIT_BYTES = 50 * 1024 * 1024;
// Warn from here: 80% of the limit.
export const SITE_LIST_WARN_BYTES = Math.round(SITE_LIST_LIMIT_BYTES * 0.8);

/** Firestore's size for one company's site list, as if it were one document. */
export function siteListBytes(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  return valueBytes(entry) + DOC_NAME_ALLOWANCE;
}

const kb = (n) => (n >= 1024 * 1024
  ? `${(n / (1024 * 1024)).toFixed(1)} MB`
  : `${Math.round(n / 1024).toLocaleString()} KB`);
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

/** "41.2 / 50 MB", for the Issues tab's Resolution cell. */
export function siteListSizeLabel(bytes) {
  const mb = (n) => n / (1024 * 1024);
  return `${mb(bytes).toFixed(1)} / ${Math.round(mb(SITE_LIST_LIMIT_BYTES))} MB`;
}

/**
 * Issues-tab rows for oversizedSiteLists' result. `ignored` is the slugs
 * whose near-the-limit warning the user chose to Ignore (Settings
 * `ignoredSiteListWarnings`); those lists drop off the tab until they go
 * over, since a list past the cap is losing saves and can't be ignored.
 */
export function siteListSizeIssues(oversized, { prospects = [], ignored = [] } = {}) {
  const ignoredSet = new Set((ignored || []).map(s => String(s || '').trim()).filter(Boolean));
  const prospectBySlug = new Map();
  for (const p of (prospects || [])) {
    const k = slugOf(p?.company);
    if (k && !prospectBySlug.has(k)) prospectBySlug.set(k, p);
  }
  const out = [];
  for (const l of (oversized || [])) {
    const prospect = prospectBySlug.get(l.slug) || null;
    const over = l.bytes >= SITE_LIST_LIMIT_BYTES;
    if (!over && ignoredSet.has(l.slug)) continue;
    const what = `The site list${l.fileName ? ` ("${l.fileName}")` : ''} is ${kb(l.bytes)}`
      + `${l.rows ? `, ${l.rows.toLocaleString()} rows` : ''}, against the ${kb(SITE_LIST_LIMIT_BYTES)} one site list can hold.`;
    out.push({
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
      // For the Resolution cell: the size readout and the Ignore button.
      siteList: { slug: l.slug, bytes: l.bytes, over },
    });
  }
  return out;
}
