// The title searches behind each contact persona.
//
// This is a transcription, and a transcription has one failure mode worth
// testing for: a term that quietly changed on the way in. These strings get
// typed into HubSpot and ZoomInfo, so "Health and saftey" spelled correctly
// here is a term that stops matching whoever it used to match, and a term
// dropped from a column is a person who stops being found.
//
// So: the counts the sheet had, the terms most likely to be "fixed", and
// the shape the page relies on - every group a kind, every search a scope.
//
// The page now edits these searches and saves the result to settings, so
// the second half of this file covers that layer: what a saved list does to
// the built-ins, and what a stored value that is missing a field, carrying a
// duplicate key or not a list at all turns into before anything renders it.
//
// Run: node scripts/contactTitleSearches.test.mjs
import {
  CONTACT_TITLE_SEARCHES, normalizeTitleSearches, resolveTitleSearches,
  searchTerms, slugifyKey, termCount, uniqueKey,
} from '../src/data/contactTitleSearches.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

const by = (key) => CONTACT_TITLE_SEARCHES.find(e => e.key === key);
const groupOf = (key, label) => by(key).groups.find(g => g.label === label);

// ---- the seven columns of the sheet, in its order ------------------------
{
  check('every column came across', CONTACT_TITLE_SEARCHES.length, 7);
  check('in the order the sheet had them',
    CONTACT_TITLE_SEARCHES.map(e => e.name).join(' | '),
    'ESG reporting | Utilities | Procurement | Engineering | Climate Risk | Private Equity | CFO');
  check('each one says who it is run against',
    CONTACT_TITLE_SEARCHES.every(e => e.scope === 'North American Contacts Only'), true);
}

// ---- nothing was dropped on the way in -----------------------------------
{
  const counts = CONTACT_TITLE_SEARCHES.map(e => `${e.key}:${termCount(e)}`).join(' ');
  check('the term counts are the sheet\'s',
    counts,
    'esg:29 utilities:15 procurement:27 engineering:12 climate-risk:8 private-equity:17 cfo:9');
  check('117 terms in all',
    CONTACT_TITLE_SEARCHES.reduce((n, e) => n + termCount(e), 0), 117);
}

// ---- the typos are the point ---------------------------------------------
{
  // Each of these is wrong as English and right as a search term: it is
  // what was typed into the box that found the people who are on the list.
  check('a misspelled exclusion is left misspelled',
    groupOf('esg', 'Not').terms.includes('Health and saftey'), true);
  check('and not silently corrected',
    groupOf('esg', 'Not').terms.includes('Health and safety'), false);
  check('the author\'s own heading survives',
    by('cfo').groups.some(g => g.label === 'Doesnt have'), true);
  check('so does the one they were unsure about',
    by('procurement').groups[0].terms.includes('Power?'), true);
}

// ---- include and exclude are kept apart ----------------------------------
{
  check('ESG reporting rules out the assistants', groupOf('esg', 'Not').kind, 'exclude');
  check('and searches for the sustainability titles', groupOf('esg', 'Include').kind, 'include');
  check('Private Equity rules out HR', groupOf('private-equity', 'Not').terms.join(', '),
    'Human resources, Talent');
  check('CFO searches two titles and rules out seven things',
    `${by('cfo').groups[0].terms.length} / ${groupOf('cfo', 'Doesnt have').terms.length}`, '2 / 7');
}

// ---- the four unheaded columns say so ------------------------------------
{
  // The sheet headed three columns and left four as a bare list of titles.
  // An unheaded list is carried as an include group with NO label, so the
  // page can say "unheaded in the source" rather than inventing "Include".
  const unheaded = CONTACT_TITLE_SEARCHES
    .filter(e => e.groups.every(g => !g.label)).map(e => e.key).join(' ');
  check('four columns came with no heading over them',
    unheaded, 'utilities procurement engineering climate-risk');
  check('and they are carried as includes, not as an unknown',
    CONTACT_TITLE_SEARCHES.every(e => e.groups.every(g => g.kind === 'include' || g.kind === 'exclude')),
    true);
}

// ---- the page can read every one of them ---------------------------------
{
  check('searchTerms flattens both halves of a search',
    searchTerms(by('cfo')).length, 9);
  check('and junk is not a search', searchTerms(null).length, 0);
  check('every term is a non-empty string',
    CONTACT_TITLE_SEARCHES.every(e => searchTerms(e).every(t => typeof t === 'string' && t.trim())),
    true);
  check('no term repeats inside one group',
    CONTACT_TITLE_SEARCHES.every(e => e.groups.every(g => new Set(g.terms).size === g.terms.length)),
    true);
  check('the keys are unique, which is what React draws them by',
    new Set(CONTACT_TITLE_SEARCHES.map(e => e.key)).size, 7);
}

// ---- a saved list stands in for the built-ins ----------------------------
{
  // Nothing saved is the common case, and it must hand back the module's
  // own array rather than a copy: the page reads it on every render.
  check('no settings gives the built-ins', resolveTitleSearches(undefined), CONTACT_TITLE_SEARCHES);
  check('unedited settings gives the built-ins', resolveTitleSearches({}), CONTACT_TITLE_SEARCHES);
  check('so does a saved value that is not a list at all',
    resolveTitleSearches({ contactTitleSearches: 'nonsense' }), CONTACT_TITLE_SEARCHES);

  const saved = [{ key: 'mine', name: 'Mine', scope: 'NA', groups: [{ label: '', kind: 'include', terms: ['CFO'] }] }];
  check('a saved list replaces the built-ins rather than adding to them',
    JSON.stringify(resolveTitleSearches({ contactTitleSearches: saved })), JSON.stringify(saved));

  // Deleting every search is a state the user can reach, and it is not the
  // same as never having edited: falling back here would put the seven
  // straight back on the next render.
  check('an empty saved list stays empty',
    resolveTitleSearches({ contactTitleSearches: [] }).length, 0);
}

// ---- what a stored value turns into before it is rendered ----------------
{
  const out = normalizeTitleSearches([
    { name: '  Utilities  ', groups: [{ terms: ['  Energy  ', '', null, 'Energy'] }] },
  ]);
  check('names are trimmed', out[0].name, 'Utilities');
  check('a missing key is derived from the name', out[0].key, 'utilities');
  check('a missing kind defaults to include', out[0].groups[0].kind, 'include');
  // Duplicates are kept on purpose. A list that silently loses its second
  // "Energy" is no longer the list that gets pasted into the search box,
  // which is the one thing this page exists to be right about.
  check('blank terms go and duplicates stay',
    out[0].groups[0].terms.join(' | '), 'Energy | Energy');

  check('an exclude group keeps its kind',
    JSON.stringify(normalizeTitleSearches([{ key: 'x', groups: [{ label: ' Not ', kind: 'exclude', terms: ['Tax'] }] }])[0].groups[0]),
    JSON.stringify({ label: 'Not', kind: 'exclude', terms: ['Tax'] }));

  // Two searches sharing a key would be drawn under one React key and edit
  // each other, so the second is suffixed rather than dropped: a duplicate
  // is still a search somebody wrote.
  const dup = normalizeTitleSearches([{ key: 'cfo', name: 'CFO' }, { key: 'cfo', name: 'CFO again' }]);
  check('a duplicate key is suffixed', dup.map(e => e.key).join(' '), 'cfo cfo-2');
  check('and both searches survive it', dup.length, 2);

  const bare = normalizeTitleSearches([{ name: '', groups: [] }]);
  check('a nameless, termless search is still a search', bare.length, 1);
  check('and still gets a key to be drawn by', bare[0].key.length > 0, true);
  check('a null list normalizes to empty', normalizeTitleSearches(null).length, 0);
  check('and so does a list of junk', normalizeTitleSearches([null, 'x', 7]).length, 0);

  // Round-tripping the built-ins through the saved path must not alter a
  // single term - this is the guard that editing cannot quietly retidy the
  // transcription the first half of this file checks.
  check('the built-ins survive a round trip through settings unchanged',
    JSON.stringify(resolveTitleSearches({ contactTitleSearches: CONTACT_TITLE_SEARCHES })),
    JSON.stringify(CONTACT_TITLE_SEARCHES));
}

// ---- keys for searches the user adds -------------------------------------
{
  check('a name slugifies', slugifyKey('ESG reporting'), 'esg-reporting');
  check('punctuation collapses and the edges trim', slugifyKey('  Climate / Risk!  '), 'climate-risk');
  check('an empty name slugifies to nothing', slugifyKey(''), '');
  check('a free key is used as is', uniqueKey('cfo', new Set()), 'cfo');
  check('a taken key gets the next number', uniqueKey('cfo', new Set(['cfo'])), 'cfo-2');
  check('and keeps counting', uniqueKey('cfo', new Set(['cfo', 'cfo-2'])), 'cfo-3');
  check('an unnameable search still gets a key', uniqueKey('', new Set()), 'search');
}

console.log(`\n${failures ? `${failures} FAILED` : 'All passed'}`);
process.exit(failures ? 1 : 0);
