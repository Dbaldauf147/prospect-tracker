// Which parts of a settings write belong to a company's site list, and
// which stay on the settings document.
//
// Site lists moved out of the `companySiteLists` map on the settings
// document into a document per company (see companySiteListsStore for
// why). Callers were left alone: they still write `companySiteLists` or
// `companySiteLists.<slug>` and the sync layer routes it. These are the
// rules that decide the routing.
//
// Pure — no React, no Firestore — so they can be tested directly, which
// matters because getting one wrong sends a portfolio's rows to the wrong
// place, or to nowhere.

// The settings key these documents stand in for.
export const SITE_LISTS_KEY = 'companySiteLists';

/**
 * Whether a slug can be a Firestore document id: non-empty, no '/', not
 * '.' or '..', not __surrounded_by_double_underscores__, at most 1500
 * bytes. companySlug() yields [a-z0-9-] only, so in practice this rejects
 * nothing — it exists so a malformed key becomes a skipped write with a
 * warning rather than a thrown save.
 */
export function isStorableSlug(slug) {
  const s = String(slug || '');
  if (!s || s.includes('/') || s === '.' || s === '..') return false;
  if (/^__.*__$/.test(s)) return false;
  return new TextEncoder().encode(s).length <= 1500;
}

/**
 * Split a whole-key update map (the shape saveUserSettings takes) into
 * site-list operations and what is left for the settings document.
 *
 * Writing the top-level key replaced every company's list at once, which
 * is what a settings restore counts on, so it becomes a `replaceAll`.
 */
export function splitSiteListUpdates(updates) {
  const rest = {};
  const ops = [];
  for (const [key, value] of Object.entries(updates || {})) {
    if (key !== SITE_LISTS_KEY) { rest[key] = value; continue; }
    ops.push({ replaceAll: value && typeof value === 'object' ? value : {} });
  }
  return { ops, rest };
}

/**
 * Same, for the dotted-path shape savePathUpdates takes.
 *
 *   companySiteLists.acme-inc            → replace that company's list
 *                                          (a null value deletes it)
 *   companySiteLists.acme-inc.rows       → patch one field inside it
 *   companySiteLists                     → replace the whole set
 */
export function splitSiteListPaths(pathUpdates) {
  const rest = {};
  const ops = [];
  for (const [path, value] of Object.entries(pathUpdates || {})) {
    if (path !== SITE_LISTS_KEY && !path.startsWith(`${SITE_LISTS_KEY}.`)) {
      rest[path] = value;
      continue;
    }
    if (path === SITE_LISTS_KEY) {
      ops.push({ replaceAll: value && typeof value === 'object' ? value : {} });
      continue;
    }
    const [slug, ...inner] = path.slice(SITE_LISTS_KEY.length + 1).split('.');
    if (!slug) continue;
    if (inner.length === 0) ops.push({ slug, value });
    else ops.push({ slug, paths: { [inner.join('.')]: value } });
  }
  return { ops, rest };
}

/**
 * Which companies a set of operations touches, or null when one of them
 * rewrites the whole key — the caller then has to read all of them.
 */
export function slugsForOps(ops) {
  if ((ops || []).some(op => op.replaceAll)) return null;
  return (ops || []).map(op => op.slug).filter(Boolean);
}
