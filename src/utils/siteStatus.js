// What is happening with the building itself, per site, on the Utility
// Lookup page.
//
// The page knows a great deal about a site — its utility, its rate, what it
// spends, whether it is owned or leased — and nothing about whether it is
// still open. A portfolio file is a snapshot of an estate that moves: stores
// close, buildings get sold, a site is dark for a refit. Those rows are the
// ones a lookup quietly gets wrong, because every estimate on the page prices
// them as though the lights were on.
//
// So a site carries a status, and it is a closed list rather than free text:
// the column is scanned down a hundred rows, not read, and "Closed" /
// "closed - 2024" / "CLOSED?" defeat that. The list is the user's to change
// on Dropdowns › Lists (key `siteStatus`) — every estate words this its own
// way — so nothing in the app branches on a particular value. It is a fact
// the user records and reads back, sorts by, filters on and exports.
//
// Lives outside SitesView.jsx so the vocabulary and the header matching can
// be asserted directly — see scripts/siteStatus.test.mjs.

// The seed vocabulary, in the order the pickers offer it. Open first because
// it is the overwhelming majority of any estate and the one you reach for
// when correcting a wrong guess.
export const SITE_STATUS_OPTIONS = [
  'Open',
  'Closed',
  'Sold',
  'Under construction',
  'Vacant',
];

// The header written onto the rows when the uploaded file has no status
// column of its own — the same trick the page already plays for assumed
// tenure. A status typed on the page has to live SOMEWHERE in the row: every
// derived number, every export and the mass editor all read the uploaded
// columns, so a status held anywhere else would be invisible to all three.
export const SITE_STATUS_HEADER = 'Site Status';

// Headers that mention "status" but are about something else entirely. The
// files this page eats carry plenty of them — "Contract Status", "Ownership
// Status", "Compliance Status" — and a bare /status/ match would bind the
// site's status to whichever came first in the sheet.
const NOT_SITE_STATUS = /\b(contract|supply|supplier|lease|leased|own|owner|ownership|tenure|occupan\w*|compliance|complian\w*|savings|deal|opportunity|project|audit|data|billing|invoice|payment|account|meter|utility|rate|tariff|renewal|bid|rfp|quote|approval|verification|survey)\b/i;

/**
 * The file's site-status column, or '' when it hasn't got one.
 *
 * Most specific first, the way every other column detector on this page
 * works: an exact "Site Status" beats a "Status" that could be anything, and
 * a header naming another subject's status is never a candidate at all.
 */
export function pickSiteStatusColumn(headers) {
  const pool = (headers || []).filter(h => typeof h === 'string' && h.trim() && !NOT_SITE_STATUS.test(h));
  const patterns = [
    /^site\s*status$/i, /^location\s*status$/i, /^facility\s*status$/i,
    /^property\s*status$/i, /^building\s*status$/i, /^store\s*status$/i,
    /^operational\s*status$/i, /^operating\s*status$/i, /^status$/i,
    /\bsite\s*status\b/i, /\blocation\s*status\b/i, /\bfacility\s*status\b/i,
    /\bproperty\s*status\b/i, /\bbuilding\s*status\b/i, /\bstore\s*status\b/i,
    /\boperational\s*status\b/i, /\boperating\s*status\b/i,
    /^(site|location|facility|property|building|store)\s*(open|closed)\??$/i,
    /\bstatus\b/i,
  ];
  for (const pattern of patterns) {
    const hit = pool.find(h => pattern.test(h));
    if (hit) return hit;
  }
  return '';
}

/**
 * A typed status folded onto the vocabulary in force, or the text as typed.
 *
 * Case and stray punctuation are forgiven — a file that says "OPEN" or
 * "closed." means the option — because those arrive from somebody else's
 * spreadsheet and re-typing a hundred of them by hand is not a data-quality
 * exercise anyone should have to do. Anything that doesn't match is kept
 * exactly as it came: the vocabulary is the user's, the file is the user's,
 * and dropping a value nothing recognises would lose their data to tidy up
 * a column.
 */
export function normalizeSiteStatus(value, options = SITE_STATUS_OPTIONS) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const key = text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  for (const option of options) {
    if (String(option).toLowerCase().replace(/[^a-z0-9]+/g, '') === key) return option;
  }
  return text;
}

/**
 * How many sites sit at each status, for the line the page shows above the
 * table. A Map in vocabulary order, then anything the file carried that the
 * vocabulary doesn't have, then the count with no status at all under ''.
 *
 * Counted in that order because the answer being looked for is "what is in
 * this portfolio", and a value off the list is exactly what somebody wants
 * to see rather than have folded into an "other" bucket.
 */
export function siteStatusCounts(values, options = SITE_STATUS_OPTIONS) {
  const counts = new Map(options.map(o => [o, 0]));
  let blank = 0;
  for (const raw of values || []) {
    const value = normalizeSiteStatus(raw, options);
    if (!value) { blank += 1; continue; }
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  for (const option of options) {
    if (counts.get(option) === 0) counts.delete(option);
  }
  if (blank > 0) counts.set('', blank);
  return counts;
}
