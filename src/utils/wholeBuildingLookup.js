// Site → its utility's whole-building data terms.
//
// The utility-feed export names the utility serving each site; this resolves
// that name against the Whole Building Data By Utility table (zip code →
// serving utility) so the export can also say whether that utility hands over
// aggregated whole-building data, in what form, and whether multifamily is
// included.
//
// The two sides don't spell utilities the same way. The site list carries the
// billing name ("City of Fort Collins", "Xcel Energy of CO (PSC of Colorado)",
// "CORE Electric Cooperative (fka Intermountain Rural Electric Association)");
// the reference carries the utility's own ("Fort Collins Utilities", "Xcel
// Energy", "CORE Electric Cooperative"). So matching is on a normalized key
// that drops the parenthetical, the "City of" prefix and the industry words
// both sides pad the name with, leaving what actually identifies the utility.
//
// Matching is scoped to the site's zip code, which keeps the normalization
// honest: a key only has to separate the two or three utilities serving one
// zip, not all 2,137 in the table.

// The columns this adds to an export row, in the reference's own order.
export const WHOLE_BUILDING_COLUMNS = [
  'Electric?', 'Gas?', 'Steam?', 'Water?',
  'Data Type', 'Aggregate Whole-Building Data?', 'Multifamily Included?',
];

// Words that describe what a utility does rather than which one it is. Dropped
// from both sides before comparing — "Fort Collins Utilities" and "City of
// Fort Collins" are the same company, and only "fort collins" says so.
const NOISE = new Set([
  'utilities', 'utility', 'energy', 'electric', 'electrical', 'electricity',
  'gas', 'water', 'sewer', 'sanitation', 'power', 'light', 'steam',
  'company', 'co', 'inc', 'llc', 'lp', 'corp', 'corporation',
  'cooperative', 'coop', 'association', 'assn', 'district', 'department',
  'dept', 'municipal', 'municipality', 'service', 'services', 'authority',
  'board', 'commission', 'system', 'systems', 'public', 'the', 'of', 'and',
]);

// A utility name reduced to what identifies it. Empty when the name was
// nothing but noise words, which never matches — better than every such name
// colliding on ''.
export function utilityKey(name) {
  const bare = String(name || '')
    .toLowerCase()
    // "(PSC of Colorado)", "(fka Intermountain Rural Electric Association)" —
    // an alias or regulator tag, never part of what distinguishes the utility.
    .replace(/\([^)]*\)/g, ' ')
    // "City of Fort Collins" -> "Fort Collins".
    .replace(/^\s*(city|town|village|county|borough)\s+of\s+/, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!bare) return '';
  return bare.split(' ').filter(w => w && !NOISE.has(w)).join('');
}

// Load the reference and return a resolver. The table is ~70k rows, so it is
// dynamic-imported here rather than bundled into whatever page calls this —
// only an export that actually needs the columns pays for it.
export async function loadWholeBuildingLookup() {
  const { GROUPS, UTILITIES, UTIL_COLUMNS, STATES } = await import('../data/wholeBuildingUtilities.js');
  const colIdx = new Map(UTIL_COLUMNS.map((c, i) => [c, i]));

  // zip -> the utility rows serving it.
  const byZip = new Map();
  for (const [u, s, p, zips] of GROUPS) {
    for (const zip of zips.split(' ')) {
      let list = byZip.get(zip);
      if (!list) { list = []; byZip.set(zip, list); }
      list.push({ util: UTILITIES[u], state: STATES[s], predominant: p === 1 });
    }
  }

  const values = (row) => {
    const out = {};
    for (const c of WHOLE_BUILDING_COLUMNS) {
      const i = colIdx.get(c);
      out[c] = i == null ? '' : (row.util[i] || '');
    }
    return out;
  };
  const blanks = () => Object.fromEntries(WHOLE_BUILDING_COLUMNS.map(c => [c, '']));

  // The whole-building terms for `utilityName` at `zip`.
  //
  // Deliberately narrow about what it will answer with. A named utility is
  // matched by key within its zip. Failing that, a zip served by exactly one
  // utility answers with that one — there is nothing else it could be. A zip
  // with several and no name match returns blanks rather than guessing:
  // utilities in one zip disagree (at 80525 the city's rows say multifamily is
  // included and Xcel's say it isn't), so picking one would not be a near miss,
  // it would be the wrong answer stated as fact.
  return function wholeBuildingFor(zip, utilityName) {
    const z = String(zip || '').trim().padStart(5, '0');
    const rows = byZip.get(z);
    if (!rows || !rows.length) return blanks();

    const key = utilityKey(utilityName);
    if (key) {
      const hits = rows.filter(r => utilityKey(r.util[colIdx.get('Utility Name')]) === key);
      if (hits.length) return values(hits.find(r => r.predominant) || hits[0]);
    }
    if (rows.length === 1) return values(rows[0]);
    return blanks();
  };
}
