// Which column of an uploaded sites file fills which Utility Lookup field.
//
// Lives here rather than inside SitesView so the picking rules can be
// asserted directly — see scripts/siteColumns.test.mjs. The detection is
// all header-text pattern matching, and getting it wrong is quiet: the
// page renders, it just renders the wrong column under the right label.

export function detectColumn(headers, patterns) {
  for (const pat of patterns) {
    const hit = headers.find(h => pat.test(String(h)));
    if (hit) return hit;
  }
  return '';
}

// The file's zip column, or '' when it hasn't got one. A sites file with
// no zip is a normal case — the mapping modal marks Zip optional, and an
// all-international portfolio has nothing to put there — so there is no
// fallback guess. There used to be one (`|| headers[0]`), and on a file
// with no zip header it declared the FIRST column the zip: that column is
// almost always Site Name, so the Site column rendered the zip cell's
// "no estimate available" instead of the site, and a numeric site name
// (store numbers) was read as a zip and looked up as one.
export function pickZipColumn(headers) {
  if (!headers.length) return '';
  return detectColumn(headers, [
    /^zip\s*code$/i, /^postal\s*code$/i, /^post\s*code$/i, /^zip$/i,
    /zip/i, /postal/i, /\bpost\s*code\b/i,
  ]);
}

// A header that names an identifier rather than a label — "Site ID",
// "Location Code", "Property #". It names the same thing a site-name
// column does, so every name pattern below matches it, but what it holds
// is a key nobody can read off the page.
export const looksLikeIdColumn = (h) => /\b(id|ids|no|nos|num|number|code|key|ref)\b|#/i.test(String(h));

// Site-name patterns, most specific first — the order detectColumn walks.
export const SITE_NAME_PATTERNS = [
  /^site\s*name$/i, /^property\s*name$/i, /^location\s*name$/i,
  /^facility\s*name$/i, /^building\s*name$/i, /^store\s*name$/i, /^branch\s*name$/i,
  /\bsite\s*name\b/i, /\bproperty\s*name\b/i, /\blocation\s*name\b/i,
  /\bfacility\s*name\b/i, /\bbuilding\s*name\b/i, /\bstore\s*name\b/i,
  /^site$/i, /^property$/i, /^location$/i, /^facility$/i, /^building$/i, /^store$/i, /^name$/i,
  /\b(site|property|location|facility|building|store|name)\b/i,
];

// The file's site-name column. This used to be one `headers.find` over a
// single alternation, which takes the first header in FILE order that
// mentions any of those words — so a sheet laid out "Site ID, Parent
// Company, …, Site Name" mapped Site Name to "Site ID", because Site ID
// comes first and matches \bsite\b. Now the patterns are ranked (an exact
// "Site Name" beats a bare "Site" beats anything merely containing the
// word) and identifier columns are held back to a second pass, so they
// only win when the sheet genuinely has nothing else to offer.
export function pickSiteNameColumn(headers) {
  if (!headers.length) return '';
  const labels = headers.filter(h => !looksLikeIdColumn(h));
  return detectColumn(labels, SITE_NAME_PATTERNS)
    || detectColumn(headers, SITE_NAME_PATTERNS)
    || headers[0];
}
