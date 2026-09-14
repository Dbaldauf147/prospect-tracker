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

// A status that says the site is trading. Matched on the opening word, so a
// rewritten vocabulary keeps working: "Open", "Operating", "Operational",
// "Active", "Trading", "Live", "In operation" all read as running, and
// "Not operating" does not, because the test is anchored.
const OPERATING = /^(open|operat|active|trading|live|running|in\s*(use|operation|service))/i;

/**
 * Is this site one of the ones the estate actually has?
 *
 * Every count of sites on the company popup and in the Master Analysis asks
 * this. A closed store, a sold building, an empty shell and a site still
 * being built are all rows on the file, and all four are rows a reader of
 * "412 sites" would not expect to be in the number.
 *
 * Two rules:
 *
 *   No status at all counts as active. Most portfolio files have never had
 *   a status column, and a count that dropped to zero the moment this
 *   shipped would be worse than the count it replaced. A blank is "nobody
 *   has said", not "not trading".
 *
 *   A status the vocabulary doesn't know counts as NOT active, unless it
 *   opens like a trading one. Someone typed a word about this site, and
 *   every word people reach for here ("Mothballed", "Exited", "Handed
 *   back") means it is gone. The exception is the vocabulary the user
 *   rewrote to their own trading word, which OPERATING covers.
 */
export function isActiveSiteStatus(value) {
  const text = String(value ?? '').trim();
  if (!text) return true;
  return OPERATING.test(text);
}

// Where a row keeps its status. The page's derived rows carry it on
// `__siteStatus__`; a saved company site list is raw cells under the
// 'Site Status' header, so those callers pass their own reader.
const ownStatus = (row) => row?.__siteStatus__;

/** The active ones, out of rows carrying `__siteStatus__`. */
export function activeSites(rows, getStatus = ownStatus) {
  return (rows || []).filter(r => isActiveSiteStatus(getStatus(r)));
}

/** How many of these sites are active. The number every site count now shows. */
export function activeSiteCount(rows, getStatus = ownStatus) {
  let n = 0;
  for (const row of rows || []) if (isActiveSiteStatus(getStatus(row))) n += 1;
  return n;
}

/**
 * The sites left out of a count, grouped by the status that excluded them:
 * a Map of status text to how many, commonest first.
 *
 * Every count that shrinks has to be able to say why, or it reads as a bug.
 * This is what the tooltips behind those counts are built from.
 */
export function inactiveSiteBreakdown(rows, getStatus = ownStatus) {
  const counts = new Map();
  for (const row of rows || []) {
    if (isActiveSiteStatus(getStatus(row))) continue;
    const key = String(getStatus(row) ?? '').trim() || 'No status';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Map([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

/**
 * "2 sites are not counted: 1 Closed, 1 Sold." — the sentence a shrunken
 * count carries, or '' when nothing was left out.
 */
export function inactiveSiteNote(rows, getStatus = ownStatus) {
  const breakdown = inactiveSiteBreakdown(rows, getStatus);
  if (breakdown.size === 0) return '';
  let total = 0;
  for (const n of breakdown.values()) total += n;
  const parts = [...breakdown].map(([status, n]) => `${n} ${status}`);
  return `${total} site${total === 1 ? '' : 's'} not counted: ${parts.join(', ')}.`;
}
