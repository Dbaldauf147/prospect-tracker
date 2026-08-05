// Site → the utility serving it, and that utility's whole-building data terms,
// both out of the Whole Building Data By Utility table (zip code → serving
// utility).
//
// Two answers, for the two things the WBUDC section asks. Which utility serves
// a site is the reference's answer to give — it is the file that knows a zip's
// utilities and which of them hand over aggregated whole-building data, where
// the site list only carries whoever bills the building. And once a utility is
// named, the same table says whether it releases that data, in what form, and
// whether the release covers multifamily.
//
// The two sides don't spell utilities the same way. The site list carries the
// billing name ("City of Fort Collins", "Pepco of DC", "Exelon (Commonwealth
// Edison)"); the reference carries the utility's own ("Fort Collins Utilities",
// "Pepco", "Commonwealth Edison"). So matching is on a normalized key that
// drops the "City of" prefix, the trailing state tag and the industry words
// both sides pad the name with, leaving what identifies the utility — and a
// parenthetical is tried as a name in its own right, since it is regularly the
// one the reference files the utility under.
//
// Matching is scoped to the site's zip code, which keeps the normalization
// honest: a key only has to separate the two or three utilities serving one
// zip, not all 2,137 in the table.

// The columns this adds to an export row, in the reference's own order.
export const WHOLE_BUILDING_COLUMNS = [
  'Electric?', 'Gas?', 'Steam?', 'Water?',
  'Data Type', 'Aggregate Whole-Building Data?', 'Multifamily Included?',
];

// The commodities the WBUDC section resolves a utility for: the two cards, and
// water because the sites sheet carries that column alongside them. Each maps
// to the reference column that says whether a utility meters it, and to the
// field the screened site carries it in.
const COMMODITY_COLUMN = { electric: 'Electric?', gas: 'Gas?', water: 'Water?' };
export const COMMODITY_FIELD = { electric: 'electricUtility', gas: 'gasUtility', water: 'waterUtility' };

// "Yes" / "No" / "Not Available" as the reference writes them. "Not Available"
// is unknown, not "No" — most of the table is unknown, and reading it as a
// denial would rule out utilities the workbook simply says nothing about.
const meters = (v) => {
  const s = String(v || '').trim().toLowerCase();
  return s === 'yes' ? 'yes' : s === 'no' ? 'no' : '';
};

// The commodities in the order the site table shows them, with the label for
// each column head. Steam is on the reference but not here: no site field
// carries a steam utility, so there would be nothing to resolve against.
export const WB_COMMODITIES = [
  { key: 'electric', label: 'Electric' },
  { key: 'gas', label: 'Gas' },
  { key: 'water', label: 'Water' },
];

// `meters` collapses everything it doesn't recognise to '', which is right for
// deciding whether a utility carries a commodity. Displaying the answer needs
// one more distinction: the reference occasionally writes a qualified yes
// ("Yes (4/50)", "Yes(5)") or something else entirely, and flattening those to
// "unknown" would throw away the only detail on the row.
function verdictFrom(value) {
  const metered = meters(value);
  if (metered) return metered;
  const s = String(value || '').trim().toLowerCase();
  if (!s || s === 'not available' || s === 'n/a') return 'unknown';
  if (s.startsWith('y')) return 'yes';
  if (s.startsWith('n')) return 'no';
  return 'other';
}

/**
 * Whether the utilities serving one site release aggregated whole-building
 * data, per commodity — for the columns on the site-by-site table.
 *
 * Each commodity is answered by its OWN utility. Electric and gas are usually
 * different companies, and the DC sites show why that matters: Pepco says yes
 * to electric and no to gas, Washington Gas says yes to gas. A single lookup
 * per site would get half of every such row wrong.
 *
 * `lookup` is what loadWholeBuildingLookup resolves to, or null while it is
 * still loading — in which case every commodity comes back 'unknown' rather
 * than throwing, and the table renders placeholders.
 *
 * Returns { electric, gas, water } of { verdict, value, utility }, where
 * verdict is 'yes' | 'no' | 'other' | 'unknown'. 'unknown' is NOT 'no': the
 * reference says "Not Available" for 2,024 of its 2,137 utilities, and
 * rendering that as a refusal would turn an open question into a closed door.
 */
export function wholeBuildingForSite(lookup, site) {
  const out = {};
  const blank = { verdict: 'unknown', value: '', utility: '' };
  if (!lookup || typeof lookup.terms !== 'function' || !site) {
    for (const c of WB_COMMODITIES) out[c.key] = { ...blank };
    return out;
  }

  // One resolve per distinct utility name rather than one per commodity: a
  // site whose electric and gas are the same company is the common case, and
  // terms() walks the zip map on every call.
  const cache = new Map();
  const termsFor = (name) => {
    const k = String(name || '');
    if (!cache.has(k)) cache.set(k, lookup.terms(site.zip, k) || {});
    return cache.get(k);
  };

  for (const c of WB_COMMODITIES) {
    const utility = String(site[COMMODITY_FIELD[c.key]] || '').trim();
    // With no utility recorded for this commodity there is nothing to ask
    // about. The zip alone would answer for whichever utility happens to
    // serve it, which is a different question than the column is asking.
    if (!utility) { out[c.key] = { ...blank }; continue; }
    const value = termsFor(utility)[COMMODITY_COLUMN[c.key]] || '';
    out[c.key] = { verdict: verdictFrom(value), value, utility };
  }
  return out;
}

// Words that describe what a utility does rather than which one it is. Dropped
// from both sides before comparing — "Fort Collins Utilities" and "City of
// Fort Collins" are the same company, and only "fort collins" says so.
const NOISE = new Set([
  'utilities', 'utility', 'energy', 'electric', 'electrical', 'electricity',
  'gas', 'water', 'sewer', 'sanitation', 'power', 'light', 'steam',
  'company', 'co', 'inc', 'llc', 'lp', 'corp', 'corporation',
  'cooperative', 'coop', 'association', 'assn', 'district', 'department',
  'dept', 'municipal', 'municipality', 'service', 'services', 'authority',
  'board', 'commission', 'comm', 'system', 'systems', 'public', 'the', 'of', 'and',
]);

// States as the site list tags them on: postal code or full name, keyed the
// same way a utility name is so a tag can be spotted in the token list.
// "Pepco of DC", "National Grid of MA", "Peoples Gas IL" are the site list
// saying which service territory, not part of what the utility is called —
// the reference just says "Pepco", "National Grid", "Peoples Gas". Only a
// trailing tag is dropped: "Georgia Power" and "Florida City Gas" are named
// after their state and keep it.
const STATE_TAGS = new Set((
  'al alabama ak alaska az arizona ar arkansas ca california co colorado ct connecticut ' +
  'de delaware dc districtcolumbia fl florida ga georgia hi hawaii id idaho il illinois ' +
  'in indiana ia iowa ks kansas ky kentucky la louisiana me maine md maryland ma massachusetts ' +
  'mi michigan mn minnesota ms mississippi mo missouri mt montana ne nebraska nv nevada ' +
  'newhampshire nh nj newjersey nm newmexico ny newyork nc northcarolina nd northdakota ' +
  'oh ohio ok oklahoma or oregon pa pennsylvania ri rhodeisland sc southcarolina sd southdakota ' +
  'tn tennessee tx texas ut utah vt vermont va virginia wa washington wv westvirginia ' +
  'wi wisconsin wy wyoming'
).split(' '));

// A utility name reduced to what identifies it. Empty when the name was
// nothing but noise words, which never matches — better than every such name
// colliding on ''.
export function utilityKey(name) {
  const bare = String(name || '')
    .toLowerCase()
    // "(PSC of Colorado)", "(fka Intermountain Rural Electric Association)" —
    // an alias or regulator tag, never part of what distinguishes the utility.
    // utilityKeys() below reads them separately, since some are the name the
    // reference files the utility under.
    .replace(/\([^)]*\)/g, ' ')
    // "City of Fort Collins" -> "Fort Collins".
    .replace(/^\s*(city|town|village|county|borough)\s+of\s+/, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!bare) return '';
  const words = bare.split(' ').filter(w => w && !NOISE.has(w));
  // A trailing state tag, one or two words — "MA", "New Jersey". Never the
  // last thing left, or "Georgia Power" would key as nothing.
  for (const n of [2, 1]) {
    if (words.length > n && STATE_TAGS.has(words.slice(-n).join(''))) { words.length -= n; break; }
  }
  return words.join('');
}

// Every name one utility answers to, primary first: the name itself, and each
// parenthetical, which on this side of the join is regularly the name the
// reference actually files it under — "Exelon (Commonwealth Edison)" is the
// reference's "Commonwealth Edison", "TECO (Peoples Gas)" its "Peoples Gas".
export function utilityKeys(name) {
  const out = [];
  const push = (v) => { const k = utilityKey(v); if (k && !out.includes(k)) out.push(k); };
  push(name);
  for (const [, inner] of String(name || '').matchAll(/\(([^)]*)\)/g)) {
    // "fka Intermountain Rural Electric Association" — the alias, not the
    // word introducing it.
    push(inner.replace(/^\s*(fka|aka|dba|formerly|now|nka)\b/i, ''));
  }
  return out;
}

// Whether two utility names are the same utility. Scoped to one zip by every
// caller, which is what keeps the normalization honest — a key only has to
// separate the two or three utilities serving one zip.
export function sameUtility(a, b) {
  const keys = utilityKeys(a);
  return keys.length > 0 && utilityKeys(b).some(k => keys.includes(k));
}

// Load the reference and return its two resolvers:
//
//   terms(zip, utilityName)              — the whole-building columns for a utility.
//   utility(zip, commodity, recorded)    — which utility the reference names.
//
// The table is ~70k rows, so it is dynamic-imported here rather than bundled
// into whatever page calls this — only a caller that actually needs it pays.
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

  const rowsAt = (zip) => byZip.get(String(zip || '').trim().padStart(5, '0')) || [];
  const nameOf = (row) => row.util[colIdx.get('Utility Name')] || '';

  // The whole-building terms for `utilityName` at `zip`.
  //
  // Deliberately narrow about what it will answer with. A named utility is
  // matched by key within its zip. Failing that, a zip served by exactly one
  // utility answers with that one — there is nothing else it could be. A zip
  // with several and no name match returns blanks rather than guessing:
  // utilities in one zip disagree (at 80525 the city's rows say multifamily is
  // included and Xcel's say it isn't), so picking one would not be a near miss,
  // it would be the wrong answer stated as fact.
  function terms(zip, utilityName) {
    return values2(zip, utilityName).values;
  }

  // terms(), plus how it got there. Blank whole-building columns are otherwise
  // unreadable: the reference itself writes "Not Available" all over these
  // fields, so a row of blanks could be a utility it has nothing to say about,
  // one it has never heard of, or a zip it doesn't cover — three different
  // things, only one of which is a data problem worth chasing.
  //
  // `status` is one of:
  //   'matched'   — the utility is in the file at this zip, by name.
  //   'sole'      — no name match, but the zip is served by one utility, so
  //                 that one answered. Right, but on the zip rather than the name.
  //   'no-utility'— the zip is in the file and this utility isn't one of its.
  //   'no-zip'    — the file doesn't cover this zip at all.
  //   'unnamed'   — nothing on the site to match with.
  function values2(zip, utilityName) {
    const rows = rowsAt(zip);
    if (!rows.length) return { values: blanks(), status: 'no-zip', matchedName: '' };
    if (!utilityKey(utilityName)) {
      return rows.length === 1
        ? { values: values(rows[0]), status: 'sole', matchedName: nameOf(rows[0]) }
        : { values: blanks(), status: 'unnamed', matchedName: '' };
    }
    const hits = rows.filter(r => sameUtility(utilityName, nameOf(r)));
    if (hits.length) {
      const hit = hits.find(r => r.predominant) || hits[0];
      return { values: values(hit), status: 'matched', matchedName: nameOf(hit) };
    }
    if (rows.length === 1) return { values: values(rows[0]), status: 'sole', matchedName: nameOf(rows[0]) };
    return { values: blanks(), status: 'no-utility', matchedName: '' };
  }

  // The utility serving `zip` for a commodity ('electric' | 'gas' | 'water'),
  // as the reference names it.
  //
  // `recordedName` is the utility already on the site, and it is a tie-breaker
  // rather than an override: the reference answers per zip, and a zip is often
  // served by several utilities, so the site's own utility is what says which
  // of them this building actually buys from. Order:
  //
  //   1. The recorded utility, where the reference lists it at this zip and
  //      doesn't say it skips the commodity. Same utility, the reference's own
  //      spelling — which is the point of resolving at all, since one utility
  //      reaches the site list under several billing names.
  //   2. Otherwise the reference's own answer: a utility flagged for the
  //      commodity, the predominant one first.
  //   3. Otherwise the recorded name is kept as-is.
  //
  // Returns { name, state, predominant, source } — `source` is 'reference'
  // when the name came from the table and 'record' when it couldn't answer and
  // the site's own utility stood. Keeping the recorded name matters: the
  // reference is silent on plenty of zips, and dropping those sites would
  // shrink the eligible counts for the reference's silence rather than for
  // anything true about the site. `source` is what lets a caller say which
  // figures rest on the reference. Null when neither side names a utility.
  function utility(zip, commodity, recordedName = '') {
    const recorded = String(recordedName || '').trim();
    const kept = recorded ? { name: recorded, state: '', predominant: false, source: 'record' } : null;
    const col = COMMODITY_COLUMN[commodity];
    const rows = col ? rowsAt(zip) : [];
    if (!rows.length) return kept;

    const carries = (r) => meters(r.util[colIdx.get(col)]);
    // The reference lists a utility twice at some zips — "Eversource" and
    // "Eversource (for Boston/Cambridge Reporting)" both serve 02210 — so the
    // predominant row wins on either path rather than whichever came first.
    const named = rows.filter(r => carries(r) !== 'no' && sameUtility(recorded, nameOf(r)));
    const flagged = rows.filter(r => carries(r) === 'yes');
    const pick = (list) => list.find(r => r.predominant) || list[0] || null;
    const hit = pick(named) || pick(flagged);
    if (!hit) return kept;
    return { name: nameOf(hit) || recorded, state: hit.state, predominant: hit.predominant, source: 'reference' };
  }

  return { terms, termsWithMatch: values2, utility };
}

// How a row's whole-building match reads in an export.
export const MATCH_LABEL = {
  matched: 'Matched',
  sole: 'Matched on zip — only utility there',
  'no-utility': 'Utility not in file',
  'no-zip': 'Zip not in file',
  unnamed: 'No utility on site',
};

// Re-source a screened site's utilities from the reference, for the callers
// that read them off the site rather than out of the workbook — the WBUDC
// cards, the sites behind them, and both exports of either.
//
// Returns new rows; the screened results themselves are left alone, so the
// site-by-site table below the cards still shows the utilities the portfolio
// was uploaded with. `wbSource` records where each commodity's name came from
// ('reference' | 'record'), so the cards can say how much of the count the
// reference actually named. A null `lookup` (not loaded yet) passes the rows
// straight through.
export function withWholeBuildingUtilities(results, lookup) {
  if (!lookup) return results || [];
  return (results || []).map((r) => {
    const out = { ...r, wbSource: {} };
    for (const [commodity, field] of Object.entries(COMMODITY_FIELD)) {
      const hit = lookup.utility(r.zip, commodity, r[field]);
      out[field] = hit ? hit.name : '';
      out.wbSource[commodity] = hit ? hit.source : '';
    }
    return out;
  });
}
