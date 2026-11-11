// Links the user has chosen NOT to track.
//
// A tracked link has to point at our redirector, so the recipient's hover
// (and Microsoft Defender's "Original URL" box) shows the tracker's address
// rather than the real destination. For a link where the real address on
// hover matters more than knowing who clicked it, the user can switch
// tracking off for that one link on the Drafts tab. The link is then left
// exactly as written, so the hover shows the real URL, and clicks on it are
// not counted. The rest of the email (other links, the open pixel) is
// tracked as before.
//
// The choice is remembered per user in settings.untrackedLinks (a list of
// link keys), so the same event link stays untracked in the next batch.
//
// This file is shared by the Drafts tab (to list the links in the email) and
// api/_lib/tracking.js (to leave the chosen ones alone), so both sides read
// an href the same way and agree on which link is which.

// Every <a ... href="..."> in a body. Same pattern the server rewrites with.
export const ANCHOR_HREF_RE = /(<a\b[^>]*?\bhref\s*=\s*)(["'])(.*?)\2/gi;

// Decode the handful of HTML entities that legitimately show up inside an
// href, so the stored URL is the real destination.
export function decodeHref(raw) {
  return String(raw ?? '')
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/g, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

/** Would the tracker rewrite this href at all? Only http(s) links. */
export function isTrackableUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

/**
 * The key a link is remembered by. The URL as written, minus surrounding
 * space and a trailing slash, so "https://x.com/" and "https://x.com" are one
 * choice. Case is kept: paths and query strings are case-sensitive.
 */
export function linkKey(url) {
  return decodeHref(url).replace(/\/+$/, '');
}

/** Distinct trackable links in an HTML body, in order of first appearance. */
export function listTrackableLinks(html) {
  const seen = new Set();
  const out = [];
  const re = new RegExp(ANCHOR_HREF_RE.source, 'gi');
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const url = decodeHref(m[3]);
    if (!isTrackableUrl(url)) continue;
    const key = linkKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url, key });
  }
  return out;
}

/** A Set of link keys from whatever list was saved (tolerates junk). */
export function untrackedKeySet(list) {
  const set = new Set();
  for (const v of Array.isArray(list) ? list : []) {
    const k = linkKey(v);
    if (k) set.add(k);
  }
  return set;
}

/** Toggle one link's key in the saved list. Returns a new array. */
export function toggleUntracked(list, url, untracked) {
  const key = linkKey(url);
  const set = untrackedKeySet(list);
  if (untracked) set.add(key); else set.delete(key);
  return [...set];
}
