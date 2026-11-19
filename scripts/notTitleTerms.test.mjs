// Assertion tests for reading the Titles page's Not lists as a filter.
// Plain Node, no test framework. Run:
//   node scripts/notTitleTerms.test.mjs
import { notTitleSources, activeNotTerms, matchedNotTerm, notTermRanges, GENERAL_NOT_SOURCE } from '../src/utils/notTitleTerms.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const settings = {
  contactTitleGeneralNot: ['Intern', ' intern ', '', 'Assistant'],
  contactTitleSearches: [
    { key: 'pe', name: 'Private Equity', groups: [
      { label: 'Not', kind: 'exclude', terms: ['Human resources', 'Talent'] },
      { label: 'Titles', kind: 'include', terms: ['Partner'] },
      { label: 'Not too', kind: 'exclude', terms: ['talent', 'Recruiter'] },
    ] },
    { key: 'eng', name: 'Engineering', groups: [{ label: '', kind: 'include', terms: ['Engineer'] }] },
  ],
};
const sources = notTitleSources(settings);
check('general list first, then searches that have Not terms', sources.map(s => s.key), [GENERAL_NOT_SOURCE, 'search:pe']);
check('general terms trimmed and de-duplicated', sources[0].terms, ['Intern', 'Assistant']);
check("a search's Not groups are one list, include terms left out", sources[1].terms, ['Human resources', 'Talent', 'Recruiter']);
check('all lists on by default', activeNotTerms(sources, new Set()), ['Intern', 'Assistant', 'Human resources', 'Talent', 'Recruiter']);
check('a list switched off drops its terms', activeNotTerms(sources, new Set(['search:pe'])), ['Intern', 'Assistant']);

// With nothing saved the page's built-in searches are what shows, so
// their Not groups are what gets pulled in.
const defaults = notTitleSources({});
check('defaults: no general list', defaults.some(s => s.key === GENERAL_NOT_SOURCE), false);
check('defaults: the built-in Not groups come through', defaults.map(s => s.key), ['search:esg', 'search:private-equity', 'search:cfo']);

const terms = activeNotTerms(sources, new Set());
check('contains, any case', matchedNotTerm('Senior TALENT Partner', terms), 'Talent');
check('no term, no match', matchedNotTerm('Chief Financial Officer', terms), '');
check('a blank title never matches', matchedNotTerm('  ', terms), '');
check('no terms, no match', matchedNotTerm('Intern', []), '');

// --- where the terms sit, for the highlight ------------------------------
check('one hit', notTermRanges('Senior TALENT Partner', ['Talent']), [[7, 13]]);
check('every occurrence of every term, in order', notTermRanges('Intern to the Tax intern', ['Tax', 'Intern']), [[0, 6], [14, 17], [18, 24]]);
check('overlapping terms merge', notTermRanges('Executive Assistant', ['Assistant', 'Executive Assistant']), [[0, 19]]);
check('no hit, no ranges', notTermRanges('Chief Financial Officer', ['Talent']), []);
check('blank title', notTermRanges(undefined, ['Talent']), []);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
