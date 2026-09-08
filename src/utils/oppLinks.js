// The links saved against an opportunity — the RFP folder, the shared
// pricing sheet, the customer's sustainability page, the Granola recording
// somebody wants two clicks away rather than three.
//
// They live on the opp as `_links`, an array of { url, label } rows, the
// same shape (and the same save path) the timelines use. The label is what
// the row is called; the url is where it goes. Either can be empty while
// the user is typing, so nothing here assumes both are filled.
//
// Reads are deliberately tolerant. A row can arrive as a plain string (a
// pasted list, an older shape), as an object under any of the obvious key
// spellings, or as junk — and a screen full of links must not disappear
// because one row is malformed. Junk is dropped, everything else is
// normalized to { url, label }.
//
// Pure: no React, no Firestore, no clock (scripts/oppLinks.test.mjs).

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The links stored on an opp, as { url, label } rows in stored order.
 *
 * Never throws and never returns null — a caller can always map over it.
 */
export function readOppLinks(opp) {
  const raw = opp?._links;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw) {
    if (typeof row === 'string') {
      const url = row.trim();
      if (url) out.push({ url, label: '' });
      continue;
    }
    if (!row || typeof row !== 'object') continue;
    const url = textOf(row.url) || textOf(row.href) || textOf(row.link);
    const label = textOf(row.label) || textOf(row.name) || textOf(row.title);
    if (!url && !label) continue;
    out.push({ url, label });
  }
  return out;
}

/** A row with nothing typed into it isn't a link — it's an empty form row. */
export function isBlankLink(row) {
  return !textOf(row?.url) && !textOf(row?.label);
}

/** How many of these rows actually hold something. Drives the tab badge. */
export function countOppLinks(list) {
  return (Array.isArray(list) ? list : []).filter(r => !isBlankLink(r)).length;
}

// Only http(s) is ever turned into a clickable href. `javascript:` and
// `data:` URLs typed (or pasted) into the box would otherwise run against
// the app's own origin the moment somebody clicked the row, so they stay
// plain text — visible, editable, inert.
const SAFE_SCHEME = /^https?:\/\//i;
// Anything ahead of the "//" that isn't http(s): mailto:, javascript:,
// data:, file:, ftp:… Matched so a bare "example.com/x" can be told from
// a scheme we're refusing.
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The href for a stored url, or '' when there isn't a safe one.
 *
 * A bare host ("acme.com/docs", "www.acme.com") gets https:// put in front
 * of it: people paste addresses out of the browser bar and out of email,
 * and half of those have lost their scheme on the way. Anything carrying a
 * scheme we don't hand to the browser comes back empty.
 */
export function linkHref(url) {
  const raw = textOf(url);
  if (!raw) return '';
  if (SAFE_SCHEME.test(raw)) return raw;
  if (HAS_SCHEME.test(raw)) return '';
  // A bare host needs at least a dot to be one — "notes" is a word the user
  // typed in the wrong column, not a site.
  if (!/^[^\s/]+\.[^\s/]/.test(raw)) return '';
  return `https://${raw}`;
}
