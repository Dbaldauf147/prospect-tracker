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
// Run: node scripts/contactTitleSearches.test.mjs
import {
  CONTACT_TITLE_SEARCHES, searchTerms, termCount,
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

console.log(`\n${failures ? `${failures} FAILED` : 'All passed'}`);
process.exit(failures ? 1 : 0);
